-- TICKET-048: Notifications inbox — canonical, complete schema.
-- One row per delivered event; no aggregation; no realtime.
-- Inserts come exclusively from service-role edge functions; recipient may
-- only flip `read_at` (enforced by trigger + RLS).
--
-- This is the squashed single migration (Fix #1 of Codex review 2026-04-28).
-- The second migration (20260507000001) was removed after repair because it
-- contained an unconditional DROP TABLE that would wipe the inbox on re-apply.
-- All objects here use IF NOT EXISTS / OR REPLACE / idempotent patterns.

CREATE TABLE IF NOT EXISTS notifications (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    kind                  text NOT NULL,
    actor_user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    subject_table_id      uuid REFERENCES tables(id)      ON DELETE CASCADE,
    subject_entry_id      uuid REFERENCES entries(id)     ON DELETE CASCADE,
    subject_restaurant_id uuid REFERENCES restaurants(id) ON DELETE CASCADE,
    subject_text          text,                         -- optional human-readable cache (e.g., city name)
    subject_meta          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- kind-specific payload
    created_at            timestamptz NOT NULL DEFAULT now(),
    read_at               timestamptz,
    CONSTRAINT notifications_kind_check CHECK (kind IN (
        'friend_logged',
        'friend_pinned',
        'top_four_swap',
        'table_invite',
        'claim_city',
        'reservation_reminder'
    )),
    CONSTRAINT notifications_actor_not_self CHECK (
        actor_user_id IS NULL OR actor_user_id <> user_id
    ),
    -- Per-kind subject shape constraints. Cheap insurance that producers
    -- populate the right denormalized fields for hydration.
    CONSTRAINT notifications_friend_logged_shape CHECK (
        kind <> 'friend_logged' OR (
            subject_entry_id IS NOT NULL AND subject_restaurant_id IS NOT NULL
        )
    ),
    CONSTRAINT notifications_table_invite_shape CHECK (
        kind <> 'table_invite' OR subject_table_id IS NOT NULL
    ),
    CONSTRAINT notifications_top_four_swap_shape CHECK (
        kind <> 'top_four_swap' OR (
            subject_table_id IS NOT NULL
            AND subject_meta ? 'added_name'
            AND subject_meta ? 'removed_name'
        )
    )
);

-- Keyset pagination index: full inbox.
CREATE INDEX IF NOT EXISTS notifications_user_created_id_idx
    ON notifications (user_id, created_at DESC, id DESC);

-- Partial index for unread-only count + bell-state queries.
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
    ON notifications (user_id, created_at DESC, id DESC)
    WHERE read_at IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'notifications' AND policyname = 'notifications_select_own'
    ) THEN
        CREATE POLICY notifications_select_own
            ON notifications FOR SELECT
            USING (auth.uid() = user_id);
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'notifications' AND policyname = 'notifications_update_own'
    ) THEN
        CREATE POLICY notifications_update_own
            ON notifications FOR UPDATE
            USING (auth.uid() = user_id)
            WITH CHECK (auth.uid() = user_id);
    END IF;
END$$;

-- No INSERT or DELETE policy — service-role edge functions bypass RLS for inserts;
-- deletes happen only via FK cascade.

-- BEFORE UPDATE trigger: reject changes to anything but `read_at`.
-- Also enforces one-way read_at transition: NULL → timestamp only.
CREATE OR REPLACE FUNCTION notifications_lock_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.id              IS DISTINCT FROM OLD.id              OR
       NEW.user_id         IS DISTINCT FROM OLD.user_id         OR
       NEW.kind            IS DISTINCT FROM OLD.kind            OR
       NEW.actor_user_id   IS DISTINCT FROM OLD.actor_user_id   OR
       NEW.subject_table_id      IS DISTINCT FROM OLD.subject_table_id      OR
       NEW.subject_entry_id      IS DISTINCT FROM OLD.subject_entry_id      OR
       NEW.subject_restaurant_id IS DISTINCT FROM OLD.subject_restaurant_id OR
       NEW.subject_text    IS DISTINCT FROM OLD.subject_text    OR
       NEW.subject_meta    IS DISTINCT FROM OLD.subject_meta    OR
       NEW.created_at      IS DISTINCT FROM OLD.created_at
    THEN
        RAISE EXCEPTION 'notifications: only read_at may be updated';
    END IF;
    -- read_at transitions are one-way: NULL -> timestamp only.
    -- Once read, stays read; cannot be cleared, cannot be re-stamped.
    IF OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at THEN
        RAISE EXCEPTION 'notifications: read_at is immutable once set';
    END IF;
    RETURN NEW;
END;
$$;

-- Drop trigger first so OR REPLACE on the function takes effect cleanly.
DROP TRIGGER IF EXISTS notifications_lock_columns_trg ON notifications;
CREATE TRIGGER notifications_lock_columns_trg
    BEFORE UPDATE ON notifications
    FOR EACH ROW
    EXECUTE FUNCTION notifications_lock_columns();

COMMENT ON TABLE  notifications IS 'TICKET-048: in-app inbox. Inserts via service-role edge fns only.';
COMMENT ON COLUMN notifications.subject_meta IS 'Kind-specific payload. top_four_swap: {added_name, removed_name}.';
COMMENT ON COLUMN notifications.subject_restaurant_id IS 'Denormalized for friend_logged hydration: producer populates BOTH subject_entry_id AND subject_restaurant_id so the inbox renderer can join restaurants directly without a chained entry->restaurant fetch. Per-kind CHECK enforces this for friend_logged.';

-- ── Visibility re-check helper ────────────────────────────────────────────────
-- Used by the notifications hydrator to filter friend_logged rows whose
-- underlying entry is no longer visible to the recipient (privacy downgrade,
-- follow severed, etc.). SECURITY DEFINER so we don't have to spoof auth.uid()
-- or build an RLS-respecting client at hydration time.
--
-- SYNC-POINT: keep this function's predicate in lockstep with
-- can_view_entry(entries) (added in 20260502000000_can_view_entry_helper.sql).
-- Any change to one MUST update the other. Both are evaluated by callers
-- expecting identical behavior; drift is a privacy bug.
--
-- SERVICE-ROLE ONLY: clients MUST NOT call this RPC directly — it exposes
-- visibility metadata for arbitrary user/entry pairs, bypassing RLS.
-- Access is revoked from PUBLIC, anon, and authenticated below.
CREATE OR REPLACE FUNCTION public.can_recipient_view_entry(
    p_recipient_id uuid,
    p_entry_id     uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_entry  entries%ROWTYPE;
    v_actor  uuid;
BEGIN
    SELECT * INTO v_entry FROM entries WHERE id = p_entry_id;
    IF NOT FOUND THEN
        RETURN false;
    END IF;
    v_actor := v_entry.user_id;

    -- Actor's own entries are always visible to the actor (defensive; producer
    -- already excludes self).
    IF v_actor = p_recipient_id THEN
        RETURN true;
    END IF;

    -- Four-branch predicate mirroring can_view_entry(entries).
    -- All four branches are evaluated via OR so a companion on a Table-shared
    -- entry is not excluded by the table_id IS NOT NULL early-return.
    -- SYNC-POINT: if can_view_entry changes, update this too.
    RETURN EXISTS (
        SELECT 1 FROM entries e WHERE e.id = p_entry_id AND (
            -- (1) Author
            e.user_id = p_recipient_id
            -- (2) Table-shared: recipient is a member of the entry's table
            OR (e.table_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM table_members tm
                WHERE tm.table_id = e.table_id AND tm.member_id = p_recipient_id
            ))
            -- (3) Companion-tagged: recipient is in entry_companions
            OR EXISTS (
                SELECT 1 FROM entry_companions ec
                WHERE ec.entry_id = e.id AND ec.user_id = p_recipient_id
            )
            -- (4) Public-eligible solo + recipient follows the author
            -- NOTE: follows schema uses `following_id` (not followee_id).
            OR (
                e.table_id IS NULL
                AND public.is_entry_publicly_eligible(e.id)
                AND EXISTS (
                    SELECT 1 FROM follows f
                    WHERE f.following_id = e.user_id AND f.follower_id = p_recipient_id
                )
            )
        )
    );
END;
$$;

COMMENT ON FUNCTION public.can_recipient_view_entry(uuid, uuid) IS
    'TICKET-048 hydrator: visibility re-check for friend_logged rows. '
    'SECURITY DEFINER, service-role only — MUST NOT be called directly by clients. '
    'SYNC-POINT with can_view_entry(entries): if that function changes, update this too.';

-- Fix #2 (Codex review 2026-04-28): lock down to service_role only.
-- Clients calling this RPC directly could probe visibility for arbitrary user/entry pairs.
REVOKE ALL ON FUNCTION public.can_recipient_view_entry(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_recipient_view_entry(uuid, uuid) TO service_role;

-- ── unread_notification_count_for ────────────────────────────────────────────
-- Fix #4 (Codex review 2026-04-28): move the visibility-filtered unread count
-- to the DB so it works correctly at any scale. The edge function's 100-row cap
-- was returning 0 incorrectly when > 100 unread rows existed with stale
-- friend_logged entries.
--
-- SERVICE-ROLE ONLY: same reasoning as can_recipient_view_entry.
CREATE OR REPLACE FUNCTION public.unread_notification_count_for(p_recipient_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT count(*)::int
    FROM notifications n
    WHERE n.user_id = p_recipient_id
      AND n.read_at IS NULL
      AND (
          n.kind <> 'friend_logged'
          OR (
              n.subject_entry_id IS NOT NULL
              AND public.can_recipient_view_entry(p_recipient_id, n.subject_entry_id)
          )
      )
$$;

COMMENT ON FUNCTION public.unread_notification_count_for(uuid) IS
    'TICKET-048: visibility-filtered unread count for the notifications bell. '
    'SECURITY DEFINER, service-role only.';

REVOKE ALL ON FUNCTION public.unread_notification_count_for(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unread_notification_count_for(uuid) TO service_role;
