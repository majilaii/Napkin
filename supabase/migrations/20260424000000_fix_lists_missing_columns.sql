-- Fix: lists table was created outside migrations with missing columns.
-- Add all columns that should exist.

ALTER TABLE public.lists ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.lists ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.lists ADD COLUMN IF NOT EXISTS ranked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.lists ADD COLUMN IF NOT EXISTS privacy TEXT NOT NULL DEFAULT 'public';
ALTER TABLE public.lists ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE public.lists ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.lists ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Add NOT NULL to title if it was added as nullable
DO $$
BEGIN
    -- Set a default for any existing rows missing title
    UPDATE public.lists SET title = 'Untitled' WHERE title IS NULL;
    ALTER TABLE public.lists ALTER COLUMN title SET NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;
