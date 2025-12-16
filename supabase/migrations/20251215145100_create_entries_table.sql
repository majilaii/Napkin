-- Migration: Create unified entries table and places table
-- This replaces the reviews table with a unified meal log

-- Create places table (non-restaurant Google Places like parks, etc.)
CREATE TABLE IF NOT EXISTS "public"."places" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "external_id" TEXT UNIQUE,  -- Google place_id
    "name" TEXT NOT NULL,
    "address" TEXT,
    "types" TEXT[],             -- Google types array for detection
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on places
ALTER TABLE "public"."places" ENABLE ROW LEVEL SECURITY;

-- Places are publicly readable
CREATE POLICY "places_readable" ON "public"."places"
    FOR SELECT USING (true);

-- Authenticated users can insert places
CREATE POLICY "places_insert" ON "public"."places"
    FOR INSERT TO authenticated WITH CHECK (true);

-- Grant permissions
GRANT ALL ON TABLE "public"."places" TO authenticated;
GRANT ALL ON TABLE "public"."places" TO service_role;

-- Create unified entries table
CREATE TABLE IF NOT EXISTS "public"."entries" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL REFERENCES "auth"."users"("id") ON DELETE CASCADE,
    
    -- Location references (one or none)
    "restaurant_id" UUID REFERENCES "public"."restaurants"("id"),
    "place_id" UUID REFERENCES "public"."places"("id"),
    "user_place_id" UUID REFERENCES "public"."user_places"("id"),
    
    -- Entry data
    "rating" DOUBLE PRECISION CHECK ("rating" IS NULL OR ("rating" >= 0 AND "rating" <= 5)),
    "content" TEXT,
    "dish_description" TEXT,
    "cooked_by" TEXT,
    "value_profile" JSONB,
    "visited_at" TIMESTAMPTZ DEFAULT NOW(),
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on entries
ALTER TABLE "public"."entries" ENABLE ROW LEVEL SECURITY;

-- Users can read all entries (for feed)
CREATE POLICY "entries_readable" ON "public"."entries"
    FOR SELECT USING (true);

-- Users can only insert their own entries
CREATE POLICY "entries_insert_own" ON "public"."entries"
    FOR INSERT WITH CHECK (auth.uid() = "user_id");

-- Users can only update their own entries
CREATE POLICY "entries_update_own" ON "public"."entries"
    FOR UPDATE USING (auth.uid() = "user_id");

-- Users can only delete their own entries
CREATE POLICY "entries_delete_own" ON "public"."entries"
    FOR DELETE USING (auth.uid() = "user_id");

-- Grant permissions
GRANT ALL ON TABLE "public"."entries" TO authenticated;
GRANT ALL ON TABLE "public"."entries" TO service_role;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS "entries_user_id_idx" ON "public"."entries"("user_id");
CREATE INDEX IF NOT EXISTS "entries_restaurant_id_idx" ON "public"."entries"("restaurant_id");
CREATE INDEX IF NOT EXISTS "entries_place_id_idx" ON "public"."entries"("place_id");
CREATE INDEX IF NOT EXISTS "entries_user_place_id_idx" ON "public"."entries"("user_place_id");
CREATE INDEX IF NOT EXISTS "entries_visited_at_idx" ON "public"."entries"("visited_at" DESC);

-- Comments
COMMENT ON TABLE "public"."places" IS 'Non-restaurant Google Places (parks, etc.)';
COMMENT ON TABLE "public"."entries" IS 'Unified meal log - every entry is a meal, location is optional context';
