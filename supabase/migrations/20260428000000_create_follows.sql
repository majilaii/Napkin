-- TICKET-028 — follows table for directional follow graph
-- Creates a directional, instant follow relationship between users.
-- No pending-accept inbox — follows are accepted immediately.

create table follows (
    follower_id  uuid not null references auth.users(id) on delete cascade,
    following_id uuid not null references auth.users(id) on delete cascade,
    created_at   timestamptz not null default now(),
    primary key (follower_id, following_id),
    check (follower_id <> following_id)
);

-- Index for "who follows user X" queries (profile page, feed ranking)
create index follows_following_idx on follows(following_id, created_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────

alter table follows enable row level security;

-- Read: a caller can see rows where they are the follower OR the following
create policy "follows_read_own"
    on follows for select
    using (follower_id = auth.uid() or following_id = auth.uid());

-- Insert: caller can only insert rows where they are the follower
create policy "follows_insert_own"
    on follows for insert
    with check (follower_id = auth.uid());

-- Delete: caller can only delete rows where they are the follower (unfollow)
create policy "follows_delete_own"
    on follows for delete
    using (follower_id = auth.uid());
