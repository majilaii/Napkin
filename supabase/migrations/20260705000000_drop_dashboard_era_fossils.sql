-- TICKET-100: drop the 39 dashboard-era fossil objects no migration creates.
-- Source: PR #122 migration-replayability audit (2026-07-04), re-verified same day against a
-- fresh `supabase db dump --linked`: zero references in napkin-app/, supabase/functions/,
-- scripts/, and supabase/migrations/; no inbound FKs; no trigger on any live table calls the
-- functions below; no view/function/policy outside these objects references them.
-- entry_comments, entry_likes and table_wishlist were confirmed EMPTY (0 rows) via a
-- data-only dump before writing this migration — nothing to archive.
--
-- On a fresh replay every statement is a no-op (the objects never existed); against prod this
-- brings the live schema in line with the migration chain. Deliberately RESTRICT (no CASCADE):
-- if anything unexpectedly depends on one of these at apply time, fail loudly instead of
-- silently dropping a live object.

-- Fail fast instead of queueing behind a conflicting lock: every statement is catalog-only
-- (milliseconds), but DROP takes ACCESS EXCLUSIVE on the FK-referenced live relations
-- (entries, restaurants, tables, auth.users) and on the live tables losing stray indexes.
-- If anything holds a conflicting lock at deploy time, error out and let CI go red rather
-- than stall traffic behind the queue.
set local lock_timeout = '5s';

-- 1) Fossil tables (pre-rebuild December likes/comments + the abandoned direct table-wishlist
--    experiment; superseded by post_comments/post_comment_likes/reactions and the emergent
--    wishlist-overlap model). Dropping the tables also drops their 9 RLS policies, the
--    4 triggers (on_comment_notify, on_entry_comment_change, on_entry_like_change,
--    on_like_notify) and their 6 indexes (idx_entry_comments_entry_id, idx_entry_likes_entry_id,
--    idx_entry_likes_user_id, idx_table_wishlist_added_by, idx_table_wishlist_restaurant_id,
--    idx_table_wishlist_table_id).
drop table if exists public.entry_comments;
drop table if exists public.entry_likes;
drop table if exists public.table_wishlist;

-- 2) Orphan trigger functions. The only triggers that ever executed the first four lived on the
--    tables dropped above; notify_on_follow and update_follow_counts have no trigger anywhere.
drop function if exists public.notify_on_comment();
drop function if exists public.notify_on_like();
drop function if exists public.notify_on_follow();
drop function if exists public.update_entry_comment_count();
drop function if exists public.update_entry_like_count();
drop function if exists public.update_follow_counts();

-- 3) Orphan RPCs — abandoned experiments with zero rpc() call sites. Signatures match the
--    2026-07-04 prod dump exactly.
drop function if exists public.fn_user_stats(uuid, boolean);
drop function if exists public.fn_user_regulars(uuid, boolean, integer, integer);
drop function if exists public.fn_user_top_restaurants(uuid, boolean, numeric, integer);
drop function if exists public.fn_recent_companions(uuid, integer);
drop function if exists public.fn_compact_list_positions(uuid);

-- 4) Stray indexes on live tables. idx_follows_following duplicates follows_following_idx
--    (same columns, same order); idx_profiles_username_lower duplicates the UNIQUE
--    profiles_username_lower_idx (same expression + predicate — uniqueness survives);
--    idx_entries_table_visited_partial is superseded by idx_entries_table_solo_sort (the actual
--    keyset sort); idx_entries_user_visited serves no live query — the diary sorts by
--    COALESCE(visited_at, created_at) via fn_user_diary_page, which a raw visited_at index
--    cannot serve, and plain user_id lookups use entries_user_id_idx; idx_entry_companions_user
--    is covered by the (entry_id, user_id) PK plus entry_companions_user_idx; idx_tnp_user only
--    serves member-profile's user_id filter on table_night_participants — a tiny,
--    Rounds-curtained table where a seq scan is acceptable.
drop index if exists public.idx_entries_table_visited_partial;
drop index if exists public.idx_entries_user_visited;
drop index if exists public.idx_entry_companions_user;
drop index if exists public.idx_follows_following;
drop index if exists public.idx_profiles_username_lower;
drop index if exists public.idx_tnp_user;
