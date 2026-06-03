-- TICKET-060: extraction_cache table.
-- [H1/H5/R13/B2] Content-keyed global cache for extraction results.
-- Stores ONLY content-derived fields (name, city, cuisine, address, booking_url, hours,
-- confidence, google_place_id). NO restaurant_id, NO already_wishlisted — those are
-- recomputed per-request to avoid cross-user data leaks.
--
-- Service-role ONLY (RLS ON, no policies). B2: cache-hit responses use the same
-- response envelope as cache-miss (no timing/shape oracle).
--
-- hash_version: allows invalidating a cache generation on normalization change.
-- See _shared/contentHash.ts for HASH_VERSION constant.

CREATE TABLE IF NOT EXISTS public.extraction_cache (
  content_hash  text PRIMARY KEY,
  hash_version  int  NOT NULL DEFAULT 1,
  source_url    text,
  extracted     jsonb NOT NULL,           -- { name, city, cuisine?, address?, booking_url?, hours?, confidence, google_place_id? }
  model         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.extraction_cache IS
  'Global content-keyed extraction cache. Stores ONLY content-derived fields; user-specific fields (already_wishlisted, restaurant_id) recomputed per-request. Service-role only. [TICKET-060 H1/H5/R13]';

COMMENT ON COLUMN public.extraction_cache.extracted IS
  'Content-derived extraction: { name, city, cuisine?, address?, booking_url?, hours?, confidence, google_place_id? }. NEVER stores restaurant_id or already_wishlisted. [TICKET-060 H1]';

-- RLS ON, no policies (service-role only). Defense-in-depth B2.
ALTER TABLE public.extraction_cache ENABLE ROW LEVEL SECURITY;

-- No RLS policies — only service_role can access this table.
-- The ENABLE ROW LEVEL SECURITY with no policies means anon/auth keys get
-- zero rows on SELECT and cannot INSERT/UPDATE/DELETE. Service-role bypasses RLS.
