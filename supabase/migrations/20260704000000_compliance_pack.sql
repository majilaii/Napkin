-- TICKET-090: App Review compliance — account deletion + UGC report/block.
--
-- Part 1 — delete-rule normalization so `auth.admin.deleteUser()` cascades
-- cleanly. Audited every public-schema FK referencing auth.users(id) or
-- profiles(user_id) (schema dump 2026-07-04); the ones below were NO ACTION
-- and would abort user deletion. Rules chosen:
--   • rows that ARE the user's own data/participation → CASCADE
--   • attribution columns on shared/group rows (nullable) → SET NULL
--   • tables.owner_id stays NO ACTION on purpose — the `account` edge fn
--     transfers ownership (or deletes sole-member tables) BEFORE deleteUser,
--     because the right outcome depends on whether other members remain.
--
-- Part 2 — dissolving a table (sole-member case in the account fn) previously
-- blocked on entries.table_id / entries.table_night_id / round_entries.table_id.
-- Entries revert to feed-only journal entries (SET NULL) — the author's data
-- outlives the group, per the individual-first doctrine.
--
-- Part 3 — content_reports + blocked_users for UGC guideline 1.2.

-- ── Part 1: user-owned rows → CASCADE ────────────────────────────────────────

alter table public.lists
    drop constraint lists_owner_id_fkey,
    add constraint lists_owner_id_fkey
        foreign key (owner_id) references public.profiles(user_id) on delete cascade;

-- Hosted suppers die with the host; other members' entries survive because
-- entries.supper_id is already ON DELETE SET NULL and supper_members cascades.
alter table public.suppers
    drop constraint suppers_host_user_id_fkey,
    add constraint suppers_host_user_id_fkey
        foreign key (host_user_id) references public.profiles(user_id) on delete cascade;

alter table public.table_activity_comments
    drop constraint table_activity_comments_user_id_fkey,
    add constraint table_activity_comments_user_id_fkey
        foreign key (user_id) references public.profiles(user_id) on delete cascade;

alter table public.table_activity_likes
    drop constraint table_activity_likes_user_id_fkey,
    add constraint table_activity_likes_user_id_fkey
        foreign key (user_id) references public.profiles(user_id) on delete cascade;

alter table public.table_night_participants
    drop constraint table_night_participants_user_id_fkey,
    add constraint table_night_participants_user_id_fkey
        foreign key (user_id) references public.profiles(user_id) on delete cascade;

alter table public.table_night_photos
    drop constraint table_night_photos_user_id_fkey,
    add constraint table_night_photos_user_id_fkey
        foreign key (user_id) references public.profiles(user_id) on delete cascade;

alter table public.table_night_photo_likes
    drop constraint table_night_photo_likes_user_id_fkey,
    add constraint table_night_photo_likes_user_id_fkey
        foreign key (user_id) references public.profiles(user_id) on delete cascade;

alter table public.table_night_dish_ratings
    drop constraint table_night_dish_ratings_user_id_fkey,
    add constraint table_night_dish_ratings_user_id_fkey
        foreign key (user_id) references public.profiles(user_id) on delete cascade;

alter table public.table_night_predictions
    drop constraint table_night_predictions_predictor_user_id_fkey,
    add constraint table_night_predictions_predictor_user_id_fkey
        foreign key (predictor_user_id) references public.profiles(user_id) on delete cascade;

alter table public.table_night_predictions
    drop constraint table_night_predictions_target_user_id_fkey,
    add constraint table_night_predictions_target_user_id_fkey
        foreign key (target_user_id) references public.profiles(user_id) on delete cascade;

alter table public.visit_companions
    drop constraint visit_companions_companion_user_fkey,
    add constraint visit_companions_companion_user_fkey
        foreign key (companion_user) references public.profiles(user_id) on delete cascade;

-- Audit trail rows where the deleted user was the actor (NOT NULL column).
alter table public.table_top_4_history
    drop constraint table_top_4_history_actor_id_fkey,
    add constraint table_top_4_history_actor_id_fkey
        foreign key (actor_id) references auth.users(id) on delete cascade;

-- ── Part 1b: attribution columns on shared rows → SET NULL (all nullable) ────

alter table public.table_nights
    drop constraint table_nights_host_user_id_fkey,
    add constraint table_nights_host_user_id_fkey
        foreign key (host_user_id) references public.profiles(user_id) on delete set null;

alter table public.table_night_dishes
    drop constraint table_night_dishes_created_by_fkey,
    add constraint table_night_dishes_created_by_fkey
        foreign key (created_by) references public.profiles(user_id) on delete set null;

alter table public.table_top_4
    drop constraint table_top_4_updated_by_fkey,
    add constraint table_top_4_updated_by_fkey
        foreign key (updated_by) references public.profiles(user_id) on delete set null;

alter table public.professional_critic_reviews
    drop constraint professional_critic_reviews_suppressed_by_fkey,
    add constraint professional_critic_reviews_suppressed_by_fkey
        foreign key (suppressed_by) references auth.users(id) on delete set null;

-- ── Part 2: table dissolution unblocked — entries outlive their table ────────

alter table public.entries
    drop constraint entries_table_id_fkey,
    add constraint entries_table_id_fkey
        foreign key (table_id) references public.tables(id) on delete set null;

alter table public.entries
    drop constraint entries_table_night_id_fkey,
    add constraint entries_table_night_id_fkey
        foreign key (table_night_id) references public.table_nights(id) on delete set null;

alter table public.round_entries
    drop constraint round_entries_table_id_fkey,
    add constraint round_entries_table_id_fkey
        foreign key (table_id) references public.tables(id) on delete cascade;

-- ── Part 3: UGC report + block (guideline 1.2) ───────────────────────────────

create table public.content_reports (
    id           uuid primary key default gen_random_uuid(),
    reporter_id  uuid not null references auth.users(id) on delete cascade,
    target_type  text not null check (target_type in ('entry', 'comment', 'profile', 'share', 'supper', 'photo')),
    target_id    uuid not null,
    reason       text not null check (char_length(reason) between 1 and 500),
    created_at   timestamptz not null default now(),
    resolved_at  timestamptz,
    resolved_by  uuid references auth.users(id) on delete set null
);

alter table public.content_reports enable row level security;

-- Users can file reports; only service role (operator) reads them.
create policy content_reports_insert_own on public.content_reports
    for insert to authenticated
    with check (reporter_id = auth.uid());

create index content_reports_unresolved_idx
    on public.content_reports (created_at desc)
    where resolved_at is null;

create table public.blocked_users (
    blocker_id  uuid not null references auth.users(id) on delete cascade,
    blocked_id  uuid not null references auth.users(id) on delete cascade,
    created_at  timestamptz not null default now(),
    primary key (blocker_id, blocked_id),
    check (blocker_id <> blocked_id)
);

alter table public.blocked_users enable row level security;

create policy blocked_users_select_own on public.blocked_users
    for select to authenticated
    using (blocker_id = auth.uid());

create policy blocked_users_insert_own on public.blocked_users
    for insert to authenticated
    with check (blocker_id = auth.uid());

create policy blocked_users_delete_own on public.blocked_users
    for delete to authenticated
    using (blocker_id = auth.uid());

-- Reverse lookups ("who blocked X") used by edge-side enforcement.
create index blocked_users_blocked_idx on public.blocked_users (blocked_id);

-- ── Part 3b: unread badge respects blocks ────────────────────────────────────
-- The inbox pager (notifications fn) drops rows from blocked actors at
-- hydration; without this the SECURITY DEFINER count would still tally them,
-- leaving a phantom unread badge the user can never clear by reading.
create or replace function public.unread_notification_count_for(p_recipient_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
    select count(*)::int
    from notifications n
    where n.user_id = p_recipient_id
      and n.read_at is null
      and (
          n.kind <> 'friend_logged'
          or (
              n.subject_entry_id is not null
              and public.can_recipient_view_entry(p_recipient_id, n.subject_entry_id)
          )
      )
      and (
          n.actor_user_id is null
          or not exists (
              select 1 from public.blocked_users b
              where (b.blocker_id = p_recipient_id and b.blocked_id = n.actor_user_id)
                 or (b.blocker_id = n.actor_user_id and b.blocked_id = p_recipient_id)
          )
      )
$$;
