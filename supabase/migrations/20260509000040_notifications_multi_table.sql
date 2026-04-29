-- TICKET-043 finding 6: notifications visibility re-check + CHECK tighten.
--
-- (a) can_recipient_view_entry branch (2) currently checks entries.table_id;
-- rewrite to OR over entry_tables so a B-only recipient can still see a
-- friend_logged notification for an entry whose primary is A.
--
-- (b) The existing notifications_friend_logged_shape CHECK does not require
-- subject_table_id to be NULL for friend_logged. Tighten so a friend_logged
-- row that accidentally carries a subject_table_id is rejected; this prevents
-- the inbox renderer from leaking a Table id even if a producer slips up.
--
-- Addresses [ARCH-REVIEW] finding 6.

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
    v_entry entries%ROWTYPE;
BEGIN
    SELECT * INTO v_entry FROM entries WHERE id = p_entry_id;
    IF NOT FOUND THEN RETURN false; END IF;

    -- Author always sees their own entry.
    IF v_entry.user_id = p_recipient_id THEN RETURN true; END IF;

    -- (2) Tablemate via entry_tables (REWRITE — was: e.table_id IS NOT NULL AND tm join).
    -- Covers B-only recipients for entries whose primary is A.
    IF EXISTS (
        SELECT 1 FROM public.entry_tables et
        WHERE et.entry_id = p_entry_id
          AND public.is_table_member(et.table_id, p_recipient_id)
    ) THEN RETURN true; END IF;

    -- (3) Companion (unchanged).
    IF EXISTS (
        SELECT 1 FROM public.entry_companions ec
        WHERE ec.entry_id = p_entry_id AND ec.user_id = p_recipient_id
    ) THEN RETURN true; END IF;

    -- (4) Public-eligible follow (unchanged) — note feed-only is now defined as
    -- "no entry_tables row AND e.table_id IS NULL". For (4) we keep e.table_id IS NULL
    -- as a proxy because branch (2) above already covers any tablemate path; if a
    -- public-eligible entry has been ALSO posted to a Table, branch (2) catches
    -- followers-who-are-tablemates anyway.
    IF (
        v_entry.table_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM public.entry_tables et WHERE et.entry_id = p_entry_id)
        AND public.is_entry_publicly_eligible(p_entry_id)
        AND EXISTS (
            SELECT 1 FROM public.follows f
            WHERE f.following_id = v_entry.user_id AND f.follower_id = p_recipient_id
        )
    ) THEN RETURN true; END IF;

    RETURN false;
END;
$$;

-- Existing grants from 20260507000000 still apply (service-role only).
-- Re-apply for safety to ensure the updated function has the right grants.
REVOKE ALL ON FUNCTION public.can_recipient_view_entry(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_recipient_view_entry(uuid, uuid) TO service_role;

-- Tighten CHECK constraint so friend_logged NEVER carries a subject_table_id.
-- Cannot ALTER a CHECK in place; drop + recreate.
ALTER TABLE public.notifications
    DROP CONSTRAINT IF EXISTS notifications_friend_logged_shape;

ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_friend_logged_shape CHECK (
        kind <> 'friend_logged' OR (
            subject_entry_id IS NOT NULL
            AND subject_restaurant_id IS NOT NULL
            AND subject_table_id IS NULL  -- TICKET-043: friend_logged NEVER carries a Table id
        )
    );
