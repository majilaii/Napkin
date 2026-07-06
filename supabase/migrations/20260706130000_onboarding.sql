-- TICKET-107 — onboarding gate.
-- 1. Add nullable onboarded_at. 2. Backfill existing rows to created_at so no
-- existing user ever sees onboarding. 3. Rewrite handle_new_user to leave
-- onboarded_at NULL for new signups (the gate). value_profiles insert PRESERVED
-- (that table was NOT dropped by the 20260705 fossil migration — signups still
-- seed it; verified in 20260427000010_remove_personal_tables.sql).
--
-- profiles cols (verified 20251201113055_remote_schema.sql): user_id,
--   display_name, bio, home_city (free text — onboarding writes this DIRECTLY,
--   NOT set_user_home_city / user_claimed_cities), created_at, updated_at.

alter table public.profiles
    add column if not exists onboarded_at timestamptz;

-- Existing users: treat as already-onboarded.
update public.profiles
    set onboarded_at = coalesce(created_at, now())
    where onboarded_at is null;

-- New signups: profile row created with onboarded_at = NULL (the gate).
-- Rewrite must preserve the value_profiles seed from 20260427000010.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
    -- Create profile; onboarded_at defaults to NULL —
    -- RootLayoutNav routes NULL → /onboarding.
    insert into public.profiles (user_id, display_name)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', 'New User'));

    -- Create value profile (table still live — signups seed it).
    insert into public.value_profiles (user_id, flavor, ambience, value, service)
    values (new.id, 10, 10, 10, 10);

    return new;
end;
$$;
