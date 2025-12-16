-- Migration: Consolidate external IDs into single external_id column
-- This column stores the external place ID (Google Places, or any other provider)

-- 1. Rename foursquare_id to external_id
ALTER TABLE "public"."restaurants" 
RENAME COLUMN "foursquare_id" TO "external_id";

-- 2. Drop the old foursquare constraint
ALTER TABLE "public"."restaurants"
DROP CONSTRAINT IF EXISTS "restaurants_foursquare_id_key";

-- 3. Add new unique constraint for external_id
ALTER TABLE "public"."restaurants"
ADD CONSTRAINT "restaurants_external_id_key" UNIQUE ("external_id");

-- 4. Drop the google_place_id column (no longer needed, we use external_id for all APIs)
ALTER TABLE "public"."restaurants"
DROP CONSTRAINT IF EXISTS "restaurants_google_place_id_key";

ALTER TABLE "public"."restaurants"
DROP COLUMN IF EXISTS "google_place_id";

-- 5. Add a comment for documentation
COMMENT ON COLUMN "public"."restaurants"."external_id" IS 'Unique identifier from external API (Google Places, etc.)';
