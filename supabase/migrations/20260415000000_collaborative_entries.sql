-- 20260415000000_collaborative_entries.sql
-- Adds entry_participants table, is_personal to tables,
-- updates handle_new_user trigger, and backfills existing users.

-- 1. entry_participants table
CREATE TABLE public.entry_participants (
    entry_id    UUID NOT NULL REFERENCES public.entries(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    rating      DOUBLE PRECISION CHECK (rating IS NULL OR (rating >= 0.5 AND rating <= 5.0)),
    notes       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (entry_id, user_id)
);

ALTER TABLE public.entry_participants ENABLE ROW LEVEL SECURITY;

-- RLS: service_role bypasses, but for direct client access:
CREATE POLICY "entry_participants_select" ON public.entry_participants
    FOR SELECT USING (true);
CREATE POLICY "entry_participants_insert" ON public.entry_participants
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "entry_participants_update" ON public.entry_participants
    FOR UPDATE USING (auth.uid() = user_id);

GRANT ALL ON TABLE public.entry_participants TO authenticated;
GRANT ALL ON TABLE public.entry_participants TO service_role;

CREATE INDEX idx_entry_participants_user ON public.entry_participants(user_id);
CREATE INDEX idx_entry_participants_entry ON public.entry_participants(entry_id);

-- FK to profiles so PostgREST can resolve profiles:user_id joins
ALTER TABLE public.entry_participants
    ADD CONSTRAINT entry_participants_user_id_profiles_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;

-- 2. Add is_personal to tables
ALTER TABLE public.tables ADD COLUMN IF NOT EXISTS is_personal BOOLEAN DEFAULT false;

-- 3. Update handle_new_user trigger to create personal table
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    personal_table_id UUID;
    user_display_name TEXT;
BEGIN
    -- Create profile
    INSERT INTO public.profiles (user_id, display_name)
    VALUES (new.id, COALESCE(new.raw_user_meta_data ->> 'display_name', 'New User'));

    -- Create value profile
    INSERT INTO public.value_profiles (user_id, flavor, ambience, value, service)
    VALUES (new.id, 10, 10, 10, 10);

    -- Derive display name for personal table
    user_display_name := COALESCE(new.raw_user_meta_data ->> 'display_name', 'My');

    -- Create personal table
    INSERT INTO public.tables (owner_id, name, is_personal)
    VALUES (new.id, user_display_name || '''s Journal', true)
    RETURNING id INTO personal_table_id;

    -- Add user as admin member of personal table
    INSERT INTO public.table_members (table_id, member_id, role)
    VALUES (personal_table_id, new.id, 'admin');

    RETURN new;
END;
$$;

-- 4. Prevent deletion of personal tables
CREATE OR REPLACE FUNCTION public.prevent_personal_table_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.is_personal = true THEN
        RAISE EXCEPTION 'Personal tables cannot be deleted';
    END IF;
    RETURN OLD;
END;
$$;

CREATE TRIGGER trg_prevent_personal_table_delete
    BEFORE DELETE ON public.tables
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_personal_table_delete();

-- 5. Backfill personal tables for existing users who don't have one
DO $$
DECLARE
    rec RECORD;
    new_table_id UUID;
    user_name TEXT;
BEGIN
    FOR rec IN
        SELECT p.user_id, p.display_name
        FROM public.profiles p
        WHERE NOT EXISTS (
            SELECT 1 FROM public.tables t
            WHERE t.owner_id = p.user_id AND t.is_personal = true
        )
    LOOP
        user_name := COALESCE(rec.display_name, 'My');

        INSERT INTO public.tables (owner_id, name, is_personal)
        VALUES (rec.user_id, user_name || '''s Journal', true)
        RETURNING id INTO new_table_id;

        INSERT INTO public.table_members (table_id, member_id, role)
        VALUES (new_table_id, rec.user_id, 'admin');
    END LOOP;
END;
$$;
