-- Allow reviews with NULL rating (user has been but chose not to rate)
-- This represents "I've been here but don't want to rate" vs "0/5 rating"

-- First drop the old constraint
ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_rating_check;

-- Change rating column to allow NULL
ALTER TABLE public.reviews ALTER COLUMN rating DROP NOT NULL;

-- Add new constraint: if rating is provided, it must be between 0.5 and 5.0
ALTER TABLE public.reviews 
ADD CONSTRAINT reviews_rating_check 
CHECK (rating IS NULL OR (rating >= 0.5 AND rating <= 5.0));

-- Add comment to explain the logic
COMMENT ON COLUMN public.reviews.rating IS 'Rating 0.5-5.0, or NULL if user visited but chose not to rate';
