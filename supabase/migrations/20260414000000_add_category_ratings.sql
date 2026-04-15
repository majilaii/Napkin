-- Add per-category ratings to table_night_participants
-- These are independent from the overall "rating" column which becomes
-- the participant's independent star rating.

ALTER TABLE public.table_night_participants
  ADD COLUMN IF NOT EXISTS vibe_rating numeric(2,1),
  ADD COLUMN IF NOT EXISTS flavor_rating numeric(2,1),
  ADD COLUMN IF NOT EXISTS service_rating numeric(2,1),
  ADD COLUMN IF NOT EXISTS value_rating numeric(2,1);

-- Add check constraints for valid range (0.5 to 5.0)
ALTER TABLE public.table_night_participants
  ADD CONSTRAINT chk_vibe_rating CHECK (vibe_rating IS NULL OR (vibe_rating >= 0.5 AND vibe_rating <= 5.0)),
  ADD CONSTRAINT chk_flavor_rating CHECK (flavor_rating IS NULL OR (flavor_rating >= 0.5 AND flavor_rating <= 5.0)),
  ADD CONSTRAINT chk_service_rating CHECK (service_rating IS NULL OR (service_rating >= 0.5 AND service_rating <= 5.0)),
  ADD CONSTRAINT chk_value_rating CHECK (value_rating IS NULL OR (value_rating >= 0.5 AND value_rating <= 5.0));
