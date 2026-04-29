-- TICKET-043 cycle-3 review-fix: properly revoke entries.table_id from authenticated.
--
-- Codex Review 3 (CRITICAL): the prior migration 20260509000005 only ran
-- `REVOKE SELECT (table_id) ON public.entries FROM authenticated`, but
-- PostgreSQL has no DENY privilege — a column-level revoke is overridden by
-- a still-present table-level SELECT grant. The initial schema granted SELECT
-- on public.entries to authenticated, so the prior migration was a no-op for
-- the privacy invariant: a B-only viewer admitted by can_view_entry via the
-- entry_tables join could still direct-read entries.table_id = A.
--
-- Correct sequence:
--   1) REVOKE the table-level SELECT (broad grant from initial schema).
--   2) GRANT column-level SELECT only on the allowed columns.
--
-- Service-role retains GRANT ALL from initial schema (untouched here).

-- 1. Drop the broad table-level SELECT first.
REVOKE SELECT ON TABLE public.entries FROM authenticated;

-- 2. Re-grant SELECT for every column EXCEPT table_id.
-- (Schema-drift safety: if a new column is added later, it won't be readable
--  until explicitly listed here. That's intentional — privacy by default.)
GRANT SELECT (
    id,
    user_id,
    restaurant_id,
    place_id,
    user_place_id,
    rating,
    content,
    dish_description,
    cooked_by,
    value_profile,
    visited_at,
    created_at,
    updated_at,
    table_night_id,
    visibility,
    vibe_rating,
    flavor_rating,
    service_rating,
    value_rating,
    photo_url,
    client_nonce,
    reaction_count,
    comment_count,
    top_emojis,
    public_reaction_count,
    public_reply_count,
    public_top_emojis
) ON public.entries TO authenticated;

-- 3. Re-revoke the column-level SELECT on table_id explicitly. Idempotent —
-- after step 1+2 it's already excluded, but this makes the intent obvious in
-- pg_class_acl and in psql \z output.
REVOKE SELECT (table_id) ON public.entries FROM authenticated;

-- DML grants (INSERT/UPDATE/DELETE) on public.entries are governed by RLS only
-- since the initial schema's GRANT ALL is replaced where needed. Confirm RLS
-- policies (entries_insert_own, entries_update_own, entries_delete_own from
-- earlier migrations) still apply — they DO, because RLS gates DML regardless
-- of column grants.

-- Re-grant INSERT, UPDATE, DELETE at the table level so DML still works for
-- authenticated callers (RLS will enforce row-level access).
GRANT INSERT, UPDATE, DELETE ON public.entries TO authenticated;

COMMENT ON COLUMN public.entries.table_id IS
    'TICKET-043: legacy primary Table reference. Table-level SELECT revoked from '
    'authenticated; only column-level grants for allowed columns remain. Source of '
    'truth for "which Tables is this entry in" is entry_tables. Drop scheduled in '
    'follow-up ticket once all readers consume entry_tables.';
