-- Migration: Migrate existing reviews to entries table
-- This copies all existing reviews into the new entries table

-- Copy existing reviews to entries table
INSERT INTO "public"."entries" (
    "id",
    "user_id",
    "restaurant_id",
    "rating",
    "content",
    "value_profile",
    "visited_at",
    "created_at"
)
SELECT 
    "id",
    "user_id",
    "restaurant_id",
    "rating",
    "content",
    "value_profile",
    "visited_at",
    "created_at"
FROM "public"."reviews";

-- Note: We keep the reviews table for now as a backup
-- Can be dropped in a future migration after verifying entries works correctly
