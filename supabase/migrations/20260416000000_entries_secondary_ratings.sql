-- Add secondary rating axes to entries (matching table_night_participants)
-- Solo diners and group entry creators both get full rating support.

ALTER TABLE public.entries
  ADD COLUMN IF NOT EXISTS vibe_rating    DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS flavor_rating  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS service_rating DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS value_rating   DOUBLE PRECISION;

-- Constraints: same 0.5–5.0 range as overall rating
ALTER TABLE public.entries
  ADD CONSTRAINT chk_entries_vibe_rating
    CHECK (vibe_rating IS NULL OR (vibe_rating >= 0.5 AND vibe_rating <= 5.0)),
  ADD CONSTRAINT chk_entries_flavor_rating
    CHECK (flavor_rating IS NULL OR (flavor_rating >= 0.5 AND flavor_rating <= 5.0)),
  ADD CONSTRAINT chk_entries_service_rating
    CHECK (service_rating IS NULL OR (service_rating >= 0.5 AND service_rating <= 5.0)),
  ADD CONSTRAINT chk_entries_value_rating
    CHECK (value_rating IS NULL OR (value_rating >= 0.5 AND value_rating <= 5.0));
