-- Remove the "personal table" concept.
--
-- The feed IS the user's personal journal. Entries can optionally belong
-- to a Table (group), or exist feed-only (table_id = NULL).
--
-- This migration:
-- 1. Drops the prevent-delete trigger
-- 2. Removes is_personal from handle_new_user (no more auto-created journal tables)
-- 3. Reassigns entries on personal tables to feed-only (table_id → NULL)
-- 4. Deletes personal tables + their memberships
-- 5. Drops the is_personal column
-- 6. Drops the partial unique index on is_personal

-- 1. Drop the prevent-delete trigger + function
DROP TRIGGER IF EXISTS trg_prevent_personal_table_delete ON public.tables;
DROP FUNCTION IF EXISTS public.prevent_personal_table_delete();

-- 2. Drop the partial unique index (one personal table per owner)
DROP INDEX IF EXISTS idx_tables_one_personal_per_owner;

-- 3-6. Cleanup of personal-table data + column.
-- Wrapped in a column-existence guard so the migration is safe to re-run on
-- environments where the column was already dropped (a previous identically-
-- versioned file silently won the race in remote schema_migrations).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'tables'
          AND column_name = 'is_personal'
    ) THEN
        -- 3. Reassign entries on personal tables to feed-only
        UPDATE public.entries e
        SET table_id = NULL
        FROM public.tables t
        WHERE e.table_id = t.id AND t.is_personal = true;

        -- 4. Delete memberships for personal tables
        DELETE FROM public.table_members tm
        USING public.tables t
        WHERE tm.table_id = t.id AND t.is_personal = true;

        -- 5. Delete personal tables
        DELETE FROM public.tables WHERE is_personal = true;

        -- 6. Drop the column
        ALTER TABLE public.tables DROP COLUMN is_personal;
    END IF;
END $$;

-- 7. Rewrite handle_new_user to stop creating personal tables
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    -- Create profile
    INSERT INTO public.profiles (user_id, display_name)
    VALUES (new.id, COALESCE(new.raw_user_meta_data ->> 'display_name', 'New User'));

    -- Create value profile
    INSERT INTO public.value_profiles (user_id, flavor, ambience, value, service)
    VALUES (new.id, 10, 10, 10, 10);

    RETURN new;
END;
$$;
