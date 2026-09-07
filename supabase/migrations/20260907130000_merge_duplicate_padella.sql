-- Merge the duplicate Padella row into its canonical row.
--
-- Prod carried two `restaurants` rows for one venue at 6 Southwark St, London:
--   ghost      fa1f67f4-ad4d-482b-9600-699589ed8aa9  'Padella'
--              external_id ChIJy8yepQkbdkgRb-jkyrEa1Ns, no place_types, no rating
--              count, but 6 entries / 4 notifications / 4 user_restaurant_status
--              rows logged against it.
--   canonical  1c8e28f0-c6a3-442c-8187-884fa6fb48e1  'Padella Borough Market'
--              external_id ChIJdZ6paFcDdkgRpPUHPngIeq8, full Places metadata.
-- An import resolved the same venue under a second Google place id, so real
-- meal logs ended up split across both.
--
-- This delegates to fn_canonicalize_ghost (TICKET-195) rather than hand-rolling
-- UPDATEs. That function owns the exhaustive FK inventory — it raises
-- UNMAPPED_RESTAURANT_FK if any restaurant FK is not in its allowlist — plus the
-- per-table collision policies (boolean union on user_restaurant_status,
-- live-beats-deleted on wishlist_items, older-wins on list_entries, and so on),
-- the tombstone write, and the restaurant_merges audit row. Hand-written UPDATEs
-- would miss 20+ FK sites, and DELETEing the ghost would cascade real user data
-- away through the 13 ON DELETE CASCADE references.
--
-- The ghost is tombstoned, never deleted: fn_resolve_canonical follows
-- merged_into, so existing deep links and cached query keys on the ghost id keep
-- resolving to the canonical page.
--
-- Replay-from-zero: both guards match zero rows on an empty database, so this is
-- a 0-row no-op there. The whole migration is a single DO block, hence atomic
-- even though `supabase db push` does not wrap files in a transaction.
do $padella_merge$
declare
    v_ghost    constant uuid := 'fa1f67f4-ad4d-482b-9600-699589ed8aa9';
    v_ext      constant text := 'ChIJdZ6paFcDdkgRpPUHPngIeq8';
    v_version  integer;
begin
    -- Guard 1: the ghost must still exist and be unmerged. Absent on a fresh
    -- replay DB, and already-merged if this migration somehow runs twice.
    select completeness_version
      into v_version
      from public.restaurants
     where id = v_ghost
       and merged_into is null
       for update;

    if not found then
        raise notice 'padella merge: ghost row absent or already merged; no-op';
        return;
    end if;

    -- Guard 2: the canonical row must exist. Without this, fn_canonicalize_ghost
    -- takes its promote-in-place branch and would overwrite the GHOST's own
    -- external_id instead of merging — silently wrong on a partially seeded DB.
    if not exists (
        select 1
          from public.restaurants
         where external_id = v_ext
           and merged_into is null
    ) then
        raise notice 'padella merge: canonical row absent; no-op';
        return;
    end if;

    perform public.fn_canonicalize_ghost(
        v_ghost,
        v_ext,
        v_version,
        'padella-duplicate-2026-09-07'
    );

    raise notice 'padella merge: ghost % merged into external_id %', v_ghost, v_ext;
end;
$padella_merge$;
