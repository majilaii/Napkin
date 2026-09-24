-- Keep profiles.is_internal out of client hands (TICKET-251 review).
--
-- `authenticated` holds table-wide write grants on public.profiles and the
-- "profiles self access" policy lets a user write their own row, so a user
-- could PATCH is_internal = true on themselves through PostgREST and then
-- read what only internal viewers see (the CI smoke accounts' test saves).
-- Column privileges cannot carve one column out of a table-wide grant, so a
-- trigger pins the flag instead: for the client roles (anon, authenticated)
-- an INSERT stores false and an UPDATE keeps the stored value. Migrations
-- (postgres), service_role code and SECURITY DEFINER functions owned by
-- postgres (handle_new_user) are unaffected.
--
-- SECURITY INVOKER on purpose: current_user must be the caller's role.
-- Contract: supabase/tests/internal_accounts.spec.sql, "is_internal is not
-- client-writable".

CREATE OR REPLACE FUNCTION public.tg_profiles_protect_is_internal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
    IF current_user IN ('anon', 'authenticated') THEN
        IF TG_OP = 'INSERT' THEN
            NEW.is_internal := false;
        ELSE
            NEW.is_internal := OLD.is_internal;
        END IF;
    END IF;
    RETURN NEW;
END;
$fn$;

-- No REVOKE: like every other trigger function here, it needs no direct
-- callers (Postgres refuses to call a trigger function outside a trigger).

DROP TRIGGER IF EXISTS profiles_protect_is_internal ON public.profiles;
CREATE TRIGGER profiles_protect_is_internal
    BEFORE INSERT OR UPDATE OF is_internal ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.tg_profiles_protect_is_internal();
