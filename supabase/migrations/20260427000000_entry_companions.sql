-- TICKET-027: Companion tagging join table
--
-- entry_companions = tagged presence on a meal log
-- This is DISTINCT from entry_participants (which carries per-participant
-- ratings/notes tied to Rounds). Do NOT conflate or overload entry_participants.
--
-- Doctrine: the companion relationship grants the tagged user read access to
-- the entry even if visibility='private' (they were part of the meal). This is
-- intentional and documented here. Do not silently remove that read path.

create table if not exists entry_companions (
  entry_id   uuid not null references entries(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (entry_id, user_id)
);

-- Index for "entries where I am a companion" look-up
create index entry_companions_user_idx on entry_companions(user_id, created_at desc);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table entry_companions enable row level security;

-- Read: entry owner OR the companion themselves OR any member of the entry's table
create policy "entry_companions_read" on entry_companions
  for select using (
    -- entry owner
    exists (
      select 1 from entries e
      where e.id = entry_companions.entry_id
        and e.user_id = auth.uid()
    )
    -- the companion themselves
    or user_id = auth.uid()
    -- any member of the entry's table
    or exists (
      select 1 from entries e
      join table_members tm on tm.table_id = e.table_id
      where e.id = entry_companions.entry_id
        and tm.member_id = auth.uid()
    )
  );

-- Write (insert): entry owner only — edge function uses service role, but policy
-- documents intent for any direct client writes
create policy "entry_companions_insert" on entry_companions
  for insert with check (
    exists (
      select 1 from entries e
      where e.id = entry_companions.entry_id
        and e.user_id = auth.uid()
    )
  );

-- Delete: entry owner only
create policy "entry_companions_delete" on entry_companions
  for delete using (
    exists (
      select 1 from entries e
      where e.id = entry_companions.entry_id
        and e.user_id = auth.uid()
    )
  );
