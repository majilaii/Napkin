-- TICKET-060: Add verification column and created_by (owner) to restaurants.
-- [H4/R3] Model ghosts quarantined AND owned per-save, never shared/deduped.
--
-- verification: 'verified' (default, all existing + Places-matched) vs 'unverified'
--   (model-created ghost from low-confidence extraction — scoped to owner only).
-- created_by: the user who created an unverified ghost. NULL for shared/verified restaurants.
--
-- Canonical reads (restaurant page, Table wishlist, places-search local merge,
-- float, who's-been) all filter verification='verified'. Unverified rows are
-- reachable ONLY via their owner's own wishlist/job rows.
--
-- On confirm (EditMatchPanel → real Places match), the ghost is re-pointed via
-- external_id upsert to a verified row (handled in resolve-url / table-shares).

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS verification text NOT NULL DEFAULT 'verified'
    CHECK (verification IN ('verified', 'unverified'));

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL;

-- Partial index: only unverified rows need to be scoped by owner.
CREATE INDEX IF NOT EXISTS restaurants_unverified_owner_idx
  ON public.restaurants (created_by)
  WHERE verification = 'unverified';

-- Backfill: all pre-existing restaurants are verified canonical entries.
UPDATE public.restaurants SET verification = 'verified' WHERE verification IS DISTINCT FROM 'verified';

COMMENT ON COLUMN public.restaurants.verification IS
  'verified = canonical (Places-matched or confirmed); unverified = model-created ghost, owned per-save by created_by. [TICKET-060 H4/R3]';

COMMENT ON COLUMN public.restaurants.created_by IS
  'Owning user for unverified model-created ghosts. NULL for all verified/shared restaurants. [TICKET-060 R3]';
