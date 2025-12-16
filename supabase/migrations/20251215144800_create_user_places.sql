-- Migration: Create user_places table for saved addresses
-- Home, Grandma's, Office, etc.

-- Create the user_places table
CREATE TABLE IF NOT EXISTS "public"."user_places" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL REFERENCES "public"."profiles"("user_id") ON DELETE CASCADE,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "icon" TEXT DEFAULT '🏠',
    "is_home" BOOLEAN DEFAULT FALSE,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE("user_id", "name")
);

-- Enable RLS
ALTER TABLE "public"."user_places" ENABLE ROW LEVEL SECURITY;

-- Users can only access their own places
CREATE POLICY "user_places_own_access" ON "public"."user_places"
    USING ("user_id" = auth.uid())
    WITH CHECK ("user_id" = auth.uid());

-- Grant permissions
GRANT ALL ON TABLE "public"."user_places" TO authenticated;
GRANT ALL ON TABLE "public"."user_places" TO service_role;

-- Function to auto-create "Home" place when a user signs up
CREATE OR REPLACE FUNCTION "public"."create_default_home_place"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.user_places (user_id, name, icon, is_home)
    VALUES (NEW.user_id, 'Home', '🏠', TRUE)
    ON CONFLICT (user_id, name) DO NOTHING;
    RETURN NEW;
END;
$$;

-- Trigger to create Home on profile creation
CREATE TRIGGER "on_profile_created_add_home"
AFTER INSERT ON "public"."profiles"
FOR EACH ROW
EXECUTE FUNCTION "public"."create_default_home_place"();

-- Comment
COMMENT ON TABLE "public"."user_places" IS 'User-defined saved places for meal logging (Home, Grandma''s, etc.)';
