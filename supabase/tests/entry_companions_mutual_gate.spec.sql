-- TICKET-233: an entry owner cannot bypass the edge gate by inserting a
-- non-mutual companion directly through PostgREST/RLS.
--
-- Run:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/entry_companions_mutual_gate.spec.sql

begin;

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '23300000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'author@entry-companion-gate.invalid',
    now(),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Gate Author"}'
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '23300000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'stranger@entry-companion-gate.invalid',
    now(),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Gate Stranger"}'
  )
on conflict (id) do nothing;

insert into public.entries (id, user_id, content, visibility)
values (
  '23300000-0000-0000-0000-000000000010',
  '23300000-0000-0000-0000-000000000001',
  'RLS mutual companion gate fixture',
  'private'
)
on conflict (id) do nothing;

do $test$
declare
  rejected boolean := false;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"23300000-0000-0000-0000-000000000001"}',
    true
  );
  set local role authenticated;

  begin
    insert into public.entry_companions (entry_id, user_id)
    values (
      '23300000-0000-0000-0000-000000000010',
      '23300000-0000-0000-0000-000000000002'
    );
  exception
    when insufficient_privilege then
      rejected := true;
  end;

  reset role;

  assert rejected,
    'FAIL: an entry owner inserted a non-mutual companion through RLS';
  assert not exists (
    select 1
    from public.entry_companions
    where entry_id = '23300000-0000-0000-0000-000000000010'
      and user_id = '23300000-0000-0000-0000-000000000002'
  ), 'FAIL: rejected non-mutual companion row persisted';

  raise notice 'PASS entry_companions_mutual_gate: non-mutual owner insert rejected';
end;
$test$;

rollback;
