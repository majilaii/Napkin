-- Drop two double-seeded Padella logs.
--
-- scripts/seed/demo-accounts.ts was run against prod more than once. Each run
-- created its own Table and re-logged the same meal for the same user, so two
-- users ended up carrying the identical review twice, ~90 seconds apart:
--   aadbefb1…  4be8d58b (10:21:18) and 36937885 (10:22:50)
--   865970fe…  c6fa01b5 (13:04:40) and f6eee124 (13:05:10)
-- After 20260907130000 merged the duplicate Padella rows, both copies of each
-- pair landed on the canonical restaurant, so its page repeated one sentence six
-- times and pushed two users past the "regular" visit threshold on doubles.
--
-- This removes the EARLIER copy of each pair. That choice is load-bearing: the
-- `friend_logged` notifications point at the LATER copies (8a17fd6f → 36937885,
-- 17ca68ce → f6eee124), and notifications.subject_entry_id is ON DELETE CASCADE,
-- so removing the later ones would silently destroy a user's inbox rows.
--
-- Verified against prod before writing: these two rows carry zero photos, zero
-- notifications, zero comments, zero likes, zero companions and zero round_entries
-- between them — only one entry_tables and one entry_participants row each, both
-- of which cascade. Every entries FK is ON DELETE CASCADE, and the delete triggers
-- (photo GC, hero GC, post-interaction cascade) exist for exactly this path.
--
-- NOT touched: the two "Smoke fixture" entries on the same restaurant. That
-- restaurant is PROD_SMOKE_TEST_RESTAURANT_ID and those rows are load-bearing for
-- CI, which is why this names two ids explicitly and never matches on text.
--
-- ROLLBACK: this is a DATA migration. If smoke fails, do NOT merge the auto-revert
-- PR — reverting the file does not restore the rows and strands the version in
-- schema_migrations. The deleted rows are reconstructable from
-- .kanban/evidence/padella-merge-prestate-2026-09-07.md, which records both ids
-- with their user, rating, visited_at and review text.
--
-- Replay-from-zero: these ids do not exist on an empty database, so this removes
-- nothing there.
do $drop_double_seed$
declare
    v_doomed constant uuid[] := array[
        '4be8d58b-7501-4912-bae1-5dfcac5221bc'::uuid,
        'c6fa01b5-c0eb-49c6-a863-b6c9bc5c622e'::uuid
    ];
    v_keep constant uuid[] := array[
        '36937885-59c8-4afc-82d6-4e5a8c2de5e0'::uuid,
        'f6eee124-bbb3-4c49-9e9c-a9f969f955cf'::uuid
    ];
    v_removed integer;
begin
    -- Refuse to run if a copy we depend on keeping has already gone: that means
    -- prod is not in the state this migration was written against.
    if exists (select 1 from public.entries where id = v_doomed[1])
       and not exists (select 1 from public.entries where id = v_keep[1]) then
        raise exception using
            errcode = '55000',
            message = 'double-seed cleanup: surviving copy 36937885 is missing — investigate';
    end if;
    if exists (select 1 from public.entries where id = v_doomed[2])
       and not exists (select 1 from public.entries where id = v_keep[2]) then
        raise exception using
            errcode = '55000',
            message = 'double-seed cleanup: surviving copy f6eee124 is missing — investigate';
    end if;

    delete from public.entries where id = any(v_doomed);
    get diagnostics v_removed = row_count;

    if v_removed = 0 then
        raise notice 'double-seed cleanup: nothing to remove (fresh database or already applied)';
    else
        raise notice 'double-seed cleanup: removed % duplicate Padella row(s)', v_removed;
    end if;
end;
$drop_double_seed$;
