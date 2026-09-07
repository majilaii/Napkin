-- Merge the duplicate Padella row into its canonical row.
--
-- Prod carried two `restaurants` rows for one venue at 6 Southwark St, London:
--   ghost      fa1f67f4-ad4d-482b-9600-699589ed8aa9  'Padella'
--              external_id ChIJy8yepQkbdkgRb-jkyrEa1Ns, no place_types, no rating
--              count, but 6 entries / 4 notifications / 4 user_restaurant_status
--              rows logged against it.
--   canonical  1c8e28f0-c6a3-442c-8187-884fa6fb48e1  'Padella Borough Market'
--              external_id ChIJdZ6paFcDdkgRpPUHPngIeq8, full Places metadata.
--
-- ROOT CAUSE: scripts/seed/demo-accounts.ts hardcoded the ghost's place id, which
-- Google never resolved (its place_attestations row has fetched_at null), so every
-- demo re-seed minted a second metadata-less Padella and logged onto it. The
-- seeder is repointed at the canonical id in the same PR; without that, the next
-- seed run would recreate this duplicate and THIS migration could not repair it
-- again (it would already be recorded, and guard 1 would no-op).
--
-- This delegates to fn_canonicalize_ghost (TICKET-195) rather than hand-rolling
-- UPDATEs. This particular ghost only holds rows in three tables, but the
-- primitive is still the right vehicle: it fails closed with UNMAPPED_RESTAURANT_FK
-- if a restaurant FK ever appears outside its allowlist, it owns the per-table
-- collision policies (boolean union on user_restaurant_status, live-beats-deleted
-- on wishlist_items, older-wins on list_entries), and it writes the
-- restaurant_merges audit row that keeps alias chains flat. Note its FK guard
-- covers DECLARED foreign keys only.
--
-- The ghost is tombstoned, never deleted — 12 of the 26 restaurant FKs are
-- ON DELETE CASCADE, so deleting it would destroy real rows. fn_resolve_canonical
-- follows merged_into, so existing deep links and cached query keys on the ghost
-- id keep resolving to the canonical page.
--
-- ROLLBACK — READ BEFORE REACTING TO A RED SMOKE RUN: this is a DATA migration.
-- Do NOT merge the auto-revert PR. Reverting this file does not un-merge the rows,
-- and it strands version 20260907130000 in prod's schema_migrations with no local
-- file (the TICKET-159 desync). Close the auto-revert PR with rationale and fix
-- forward with a new migration. The pre-merge state is captured in
-- .kanban/evidence/padella-merge-prestate-2026-09-07.md, including the ghost's
-- original external_id, which this migration overwrites with 'merged_<uuid>'.
--
-- Replay-from-zero: guard 1 matches zero rows on an empty database and returns,
-- so this is a clean no-op there. The whole migration is a single DO block, hence
-- atomic even though `supabase db push` does not wrap files in a transaction.
do $padella_merge$
declare
    v_ghost    constant uuid := 'fa1f67f4-ad4d-482b-9600-699589ed8aa9';
    v_ext      constant text := 'ChIJdZ6paFcDdkgRpPUHPngIeq8';
    v_version  integer;
    v_merged   uuid;
begin
    -- Guard 1: the ghost must still exist and be unmerged. Absent on a fresh
    -- replay DB, and already-merged if this somehow runs twice — both are
    -- legitimate no-ops. Deliberately NOT `for update`: fn_canonicalize_ghost
    -- locks both rows in ascending-uuid order, and the ghost sorts AFTER the
    -- canonical, so pre-locking it here would invert that protocol. The CAS
    -- below is what actually makes the read-then-merge safe.
    select completeness_version
      into v_version
      from public.restaurants
     where id = v_ghost
       and merged_into is null;

    if not found then
        raise notice 'padella merge: ghost row absent or already merged; no-op';
        return;
    end if;

    -- Guard 2: the canonical row must exist, else fn_canonicalize_ghost takes its
    -- promote-in-place branch and rewrites the GHOST's external_id instead of
    -- merging. This raises rather than returning quietly: guard 1 already covers
    -- the empty-database case, so reaching here with no canonical row means a live
    -- database is in a state nobody predicted, and a silent skip would look like
    -- success while leaving the duplicate in place.
    if not exists (
        select 1
          from public.restaurants
         where external_id = v_ext
           and merged_into is null
    ) then
        raise exception using
            errcode = '55000',
            message = 'padella merge: ghost is live but canonical ' || v_ext
                      || ' is absent or already tombstoned — investigate, do not skip';
    end if;

    perform public.fn_canonicalize_ghost(
        v_ghost,
        v_ext,
        v_version,
        'padella-duplicate-2026-09-07'
    );

    -- Post-condition: make a green run mean something.
    select merged_into into v_merged from public.restaurants where id = v_ghost;
    if v_merged is null then
        raise exception using
            errcode = '55000',
            message = 'padella merge: fn_canonicalize_ghost returned but the ghost is not tombstoned';
    end if;

    raise notice 'padella merge: ghost % merged into %', v_ghost, v_merged;
end;
$padella_merge$;
