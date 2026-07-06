-- TICKET-110 — Google + Apple sign-in: widen handle_new_user's display_name.
--
-- OAuth signups carry the human name under different metadata keys than
-- email/password signups:
--   • Apple  → raw_user_meta_data->>'full_name' (only on FIRST authorization)
--   • Google → 'full_name' AND 'name'
--   • email  → 'display_name' (unchanged)
-- Coalesce covers all three provider shapes in one trigger; nullif(trim(...),'')
-- guards the "key present but empty string" case (Google occasionally sends '').
--
-- CONTENT EDIT ONLY. Same signature; PRESERVES the value_profiles seed and the
-- onboarded_at-defaults-NULL gate verbatim from 20260706130000_onboarding.sql
-- (a dropped value_profiles insert breaks EVERY signup). Only the display_name
-- expression changes. Forward-dated after Set 4's 20260706170000. Replayable
-- from zero — pure create-or-replace, no dependency on later objects.

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
    values (
        new.id,
        coalesce(
            nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
            nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
            nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
            'New User'
        )
    );

    -- Create value profile (table still live — signups seed it).
    insert into public.value_profiles (user_id, flavor, ambience, value, service)
    values (new.id, 10, 10, 10, 10);

    return new;
end;
$$;
