-- TICKET-123: Import-done inbox rows.
-- Extend notifications.kind to carry the import lifecycle row.
--
-- A CHECK constraint cannot be ALTERed in place — drop + recreate. Precedent:
-- 20260509000040 (which recreated notifications_friend_logged_shape the same way).
--
-- Replayability (locked doctrine): this migration is NOT a rename of any applied
-- version. On prod, `db push` alters the live constraint. On a fresh replay, the
-- table is created at 6 kinds (20260507000000) then relaxed to 7 here. Adding a
-- value to an IN-list is a relaxation, so validation over existing rows is
-- trivially true. No dollar-quoted blocks are used, so there is nothing to tag.

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
    'friend_logged',
    'friend_pinned',
    'top_four_swap',
    'table_invite',
    'claim_city',
    'reservation_reminder',
    'import_done'
));

-- Shape hygiene: import_done is self-directed. Its actor is NULL (allowed by the
-- pre-existing notifications_actor_not_self CHECK — "it's your import that
-- finished", not "someone did X to you") and it must carry an outcome so the
-- client can render + route without a join. Constrains ONLY import_done rows
-- (none exist yet), so this ADD validates trivially.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_import_done_shape;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_import_done_shape CHECK (
    kind <> 'import_done' OR (
        actor_user_id IS NULL
        AND subject_meta ? 'outcome'
    )
);

COMMENT ON CONSTRAINT notifications_import_done_shape ON public.notifications IS
    'TICKET-123: import_done rows are self-directed (null actor) and carry {job_id, count, outcome} in subject_meta.';
