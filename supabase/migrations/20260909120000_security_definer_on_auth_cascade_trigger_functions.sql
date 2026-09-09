-- Account deletion is STILL broken after 20260907190000 pinned search_path.
--
-- Prod, 2026-09-09 10:32 UTC (the App Review recording's delete step):
--   auth_logs:     user_deleted ... error: "permission denied for table post_reactions (SQLSTATE 42501)"
--   postgres_logs: user_name=supabase_auth_admin
--                  query:   DELETE FROM "users" AS users WHERE users.id = $1
--                  context: SQL statement "DELETE FROM public.post_reactions WHERE target_type = 'entry' AND target_id = OLD.id"
--                           PL/pgSQL function cascade_delete_post_interactions_extended() line 7 at SQL statement
--
-- Why: GoTrue deletes `auth.users` as `supabase_auth_admin`. The row cascades
-- (ON DELETE CASCADE) into `public.entries`, whose AFTER DELETE trigger runs
-- `cascade_delete_post_interactions_extended()`. That function is SECURITY
-- INVOKER, so its body executes with the privileges of the role that started
-- the statement. `supabase_auth_admin` holds no grant on any `public` table
-- (`post_reactions` ACL: postgres, anon, authenticated, service_role only), so
-- the very first DELETE inside the trigger raises 42501 and the whole auth
-- delete aborts. The saga is left in `account_deletions.state = 'purging'`,
-- the client has already signed out, and the account silently survives. The
-- 09-07 fix moved the failure from "relation does not exist" (name
-- resolution) to "permission denied" (privileges); this migration closes the
-- second half.
--
-- Fix: make every SECURITY INVOKER trigger function that touches ANOTHER table
-- and sits on the auth.users delete cascade SECURITY DEFINER. They are owned by
-- `postgres`, which owns the tables, so the bodies run with the owner's
-- privileges (and, RLS being enabled but not forced, without RLS filtering)
-- regardless of whether the statement was started by GoTrue, PostgREST, or the
-- service role. That is the standard Supabase guidance for anything reachable
-- from `auth.users`, and it is what the SECURITY DEFINER `trg_entries_*_gc`
-- triggers on the same cascade already do.
--
-- Which functions, and why each is on the path (verified against prod pg_trigger
-- and a recursive walk of ON DELETE CASCADE / SET NULL FKs from auth.users):
--   cascade_delete_post_interactions_extended  AFTER DELETE on entries / table_nights / table_shares
--                                              -> DELETE post_reactions, post_comments        (the observed failure)
--   sync_post_counts_and_top_emojis            AFTER INSERT/DELETE on post_reactions / post_comments
--                                              -> SELECT post_reactions, post_comments; UPDATE entries / table_nights / table_shares
--                                              (fires from the DELETE above AND from post_reactions.user_id / post_comments.user_id cascading directly)
--   sync_comment_like_count                    AFTER INSERT/DELETE on post_comment_likes
--                                              -> SELECT post_comment_likes; UPDATE post_comments
--                                              (post_comment_likes.user_id cascades directly from auth.users)
--   touch_list_updated_at                      AFTER INSERT/UPDATE/DELETE on list_entries (+ BEFORE UPDATE on lists)
--                                              -> UPDATE lists
--                                              (list_entries.added_by is ON DELETE SET NULL from auth.users: the SET NULL is an UPDATE)
--   fn_entries_mirror_table_id_to_join         AFTER INSERT/UPDATE on entries
--                                              -> INSERT entry_tables ... ON CONFLICT DO NOTHING
--                                              (entries.supper_id is ON DELETE SET NULL from suppers, which cascades from the deleted host;
--                                               a Table-shared entry by ANOTHER user at that supper is UPDATEd, the trigger fires, and even
--                                               a DO NOTHING insert needs INSERT privilege)
--   cascade_delete_post_interactions           legacy twin of the _extended function; not attached to any trigger today,
--                                              flipped so re-attaching it can never reintroduce the defect
--
-- Deliberately NOT changed:
--   set_post_interaction_table_id  BEFORE INSERT only; never on a delete path. It reads entries / entry_tables
--                                  under the caller's RLS to fill table_id, and widening that read is a
--                                  visibility change this fix does not need.
--   the BEFORE guards (notifications_lock_columns, enforce_table_list_private, tg_critic_reviews_touch_updated_at,
--   restaurants_bump_completeness_version, restaurant_completeness_*): they only inspect NEW/OLD and RAISE; no
--   table access, so no privilege is needed. The two append-only guards already let FK cascades through at
--   pg_trigger_depth() > 1.
--   sync_post_counts: dead legacy function, no trigger, left as is.
--
-- Behaviour change for non-GoTrue callers: a trigger body now runs as the
-- table owner instead of `authenticated`. For these six that is strictly the
-- intended semantics (an entry's reactions and replies from OTHER users must
-- be swept when the entry goes, whoever deletes it); today an RLS-filtered
-- caller could leave orphans behind. None of them takes arguments or returns
-- data, and a function returning `trigger` cannot be called directly
-- ("trigger functions can only be called as triggers"), so SECURITY DEFINER
-- adds no callable surface. search_path stays pinned to `public, pg_temp`
-- from 20260907190000; ALTER ... SECURITY DEFINER does not touch it.
--
-- Replay-from-zero: pure DDL against functions created earlier in the chain,
-- guarded with to_regprocedure (TYPES ONLY in the signature) so a chain that
-- drops one of them still replays clean. Regression spec:
-- supabase/tests/account_deletion_cascade.spec.sql deletes a seeded user AS
-- supabase_auth_admin and proves both the failure under SECURITY INVOKER and
-- the clean sweep under this migration.

do $secdef$
declare
    v_target text;
    v_targets constant text[] := array[
        'public.cascade_delete_post_interactions_extended()',
        'public.cascade_delete_post_interactions()',
        'public.sync_post_counts_and_top_emojis()',
        'public.sync_comment_like_count()',
        'public.touch_list_updated_at()',
        'public.fn_entries_mirror_table_id_to_join()'
    ];
    v_flipped integer := 0;
begin
    foreach v_target in array v_targets loop
        if to_regprocedure(v_target) is not null then
            execute format('alter function %s security definer', v_target);
            -- Belt and braces: a definer body must never resolve names through
            -- the caller's path. Re-pin in case a future CREATE OR REPLACE of
            -- one of these bodies drops the config.
            execute format('alter function %s set search_path = public, pg_temp', v_target);
            v_flipped := v_flipped + 1;
        else
            raise notice 'security definer: % not present; skipped', v_target;
        end if;
    end loop;

    raise notice 'security definer: flipped % trigger function(s)', v_flipped;
end;
$secdef$;
