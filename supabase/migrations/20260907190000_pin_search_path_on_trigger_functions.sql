-- Pin search_path on every trigger / RLS-reachable function that lacked one.
--
-- ACCOUNT DELETION WAS BROKEN. Deleting an account failed with
--   auth delete: Database error deleting user
-- and the auth log carried the real cause:
--   ERROR: relation "entries" does not exist
--
-- Why: these functions were SECURITY INVOKER with no `SET search_path`, so they
-- resolved unqualified table names using the CALLER's search_path. Under the app
-- (PostgREST / service role) that path contains `public`, so they worked. Account
-- deletion is different: GoTrue deletes `auth.users` as `supabase_auth_admin`,
-- whose search_path does NOT contain `public`. The delete cascades into
-- `public.entries`, its AFTER DELETE trigger deletes from `public.post_reactions`,
-- and that fires `sync_post_counts_and_top_emojis`, whose body reads
-- `from post_reactions` / `from post_comments` UNQUALIFIED. Under auth_admin those
-- names do not resolve and the whole delete aborts, leaving the account stranded
-- in `account_deletions.state = 'purging'`.
--
-- App Store Guideline 5.1.1(v) requires account deletion to work, so this is a
-- release blocker, not a nicety.
--
-- The fix is applied to the whole CLASS rather than the single function that
-- happened to fire, because every one of these is reachable from a cascade or an
-- RLS predicate and carries the same latent defect. Pinning the path also clears
-- Supabase's "function_search_path_mutable" advisory, which flags exactly this.
--
-- ALTER FUNCTION ... SET search_path only attaches a config to the existing
-- function: no body is rewritten, no signature changes, and no dependent view,
-- policy or trigger is invalidated. Every one of these bodies touches only
-- `public` objects, so pinning `public, pg_temp` is behaviour-preserving for the
-- paths that already worked. `pg_temp` is listed last, deliberately: it must
-- never shadow a real table.
--
-- Replay-from-zero: pure DDL against functions created by earlier migrations in
-- the chain. Each statement is guarded so a future chain that drops one of these
-- functions still replays clean.

do $pin_search_path$
declare
    v_target text;
    v_targets constant text[] := array[
        'public.can_view_entry(entries)',
        'public.cascade_delete_post_interactions()',
        'public.cascade_delete_post_interactions_extended()',
        'public.enforce_table_list_private()',
        'public.fn_entries_mirror_table_id_to_join()',
        'public.is_entry_publicly_eligible(uuid)',
        'public.is_table_admin(uuid, uuid)',
        'public.is_table_member(uuid, uuid)',
        'public.notifications_lock_columns()',
        'public.set_post_interaction_table_id()',
        'public.sync_comment_like_count()',
        'public.sync_post_counts_and_top_emojis()',
        'public.tg_critic_reviews_touch_updated_at()',
        'public.touch_list_updated_at()'
    ];
    v_pinned integer := 0;
begin
    foreach v_target in array v_targets loop
        -- Signatures are TYPES ONLY: to_regprocedure does not accept parameter
        -- names and raises 42601 on them (the CI replay guard caught exactly that).
        -- It returns null rather than raising for an absent function, which keeps a
        -- fresh replay and any future drop a clean no-op.
        if to_regprocedure(v_target) is not null then
            execute format('alter function %s set search_path = public, pg_temp', v_target);
            v_pinned := v_pinned + 1;
        else
            raise notice 'pin search_path: % not present; skipped', v_target;
        end if;
    end loop;

    raise notice 'pin search_path: pinned % function(s)', v_pinned;
end;
$pin_search_path$;
