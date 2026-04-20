-- 20260419000000_restaurants_places_metadata.sql
-- Adds Places metadata columns to restaurants, partial unique index for personal tables,
-- and creates the restaurant-photos storage bucket.

-- 1. Add Places metadata columns to restaurants (all nullable — existing rows are unaffected)
ALTER TABLE public.restaurants
    ADD COLUMN IF NOT EXISTS google_rating NUMERIC(2,1),
    ADD COLUMN IF NOT EXISTS google_rating_count INT,
    ADD COLUMN IF NOT EXISTS price_level SMALLINT,
    ADD COLUMN IF NOT EXISTS cuisine TEXT,
    ADD COLUMN IF NOT EXISTS places_synced_at TIMESTAMPTZ;

-- lat/lng may already exist; add only if missing
ALTER TABLE public.restaurants
    ADD COLUMN IF NOT EXISTS lat NUMERIC,
    ADD COLUMN IF NOT EXISTS lng NUMERIC;

-- 2. Tighten tables.is_personal to NOT NULL (was added nullable in an earlier migration).
UPDATE public.tables SET is_personal = false WHERE is_personal IS NULL;
ALTER TABLE public.tables
    ALTER COLUMN is_personal SET DEFAULT false,
    ALTER COLUMN is_personal SET NOT NULL;

-- 3. Pre-check: ensure no user already has more than one personal table
--    (this would prevent the unique index from being created).
DO $$
DECLARE
    dup_count INT;
BEGIN
    SELECT COUNT(*) INTO dup_count
    FROM (
        SELECT owner_id
        FROM public.tables
        WHERE is_personal = true
        GROUP BY owner_id
        HAVING COUNT(*) > 1
    ) duplicates;

    IF dup_count > 0 THEN
        RAISE EXCEPTION
            'Cannot create partial unique index: % user(s) have more than one personal table. '
            'Resolve duplicates before re-running this migration.',
            dup_count;
    END IF;
END;
$$;

-- 3. Partial unique index: one personal table per owner, ever.
--    IF NOT EXISTS guard makes this idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS tables_one_personal_per_owner_idx
    ON public.tables (owner_id)
    WHERE is_personal = true;

-- 4. Storage bucket for restaurant hero photos.
--    Insert into storage.buckets is idempotent via ON CONFLICT DO NOTHING.
INSERT INTO storage.buckets (id, name, public)
VALUES ('restaurant-photos', 'restaurant-photos', true)
ON CONFLICT (id) DO NOTHING;

-- 5. Storage policies for restaurant-photos bucket (mirror entry-photos patterns).
--    Any authenticated user can read (public bucket, but belt-and-suspenders).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'restaurant-photos select policy'
    ) THEN
        CREATE POLICY "restaurant-photos select policy"
        ON storage.objects FOR SELECT
        USING (bucket_id = 'restaurant-photos');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'restaurant-photos insert policy'
    ) THEN
        CREATE POLICY "restaurant-photos insert policy"
        ON storage.objects FOR INSERT
        WITH CHECK (
            bucket_id = 'restaurant-photos'
            AND auth.role() = 'authenticated'
        );
    END IF;
END;
$$;
