-- TICKET-060 Fix Pass 3 — addresses cycle-3 review blockers B1–B4.
--
-- B1  — [HIGH security] Drop the two INSERT policies on restaurants that survived
--        pass-2 (exact names from the baseline 20251201113055_remote_schema.sql).
--        Pass-2 (000800) already dropped "Allow authenticated insert restaurants"
--        and "Authenticated users can update restaurants", but missed:
--          line 441: "Authenticated users can insert restaurants"
--          line 501: "restaurants insert/update by owners"
--        Both are WITH CHECK(true) / CHECK(auth.uid() IS NOT NULL) — any
--        authenticated client can INSERT verification='verified' directly,
--        defeating the ghost quarantine (H4/R3).
--
-- B4  — [MEDIUM] restaurant-history by-id reads (table_history + page paths)
--        read restaurants under service-role with no verification predicate
--        → a known unverified-ghost id returns to non-owners.
--        This migration does NOT fix the TypeScript reads; those are in the edge
--        function files (fixed in the code changes below).

-- ─── [B1] Drop the two surviving INSERT policies ─────────────────────────────
--
-- Grep the exact names from the baseline before dropping.
-- "Authenticated users can insert restaurants" — line 441 of remote_schema.sql
-- "restaurants insert/update by owners"        — line 501 of remote_schema.sql
--
-- DROP POLICY IF EXISTS silently no-ops if the name doesn't match — that is
-- exactly how pass-2 failed. Verify by searching the baseline for both names.

DROP POLICY IF EXISTS "Authenticated users can insert restaurants" ON public.restaurants;
DROP POLICY IF EXISTS "restaurants insert/update by owners"        ON public.restaurants;

-- Confirmation: after these drops, the only remaining policies on restaurants are:
--   1. restaurants_verified_or_owner_select (SELECT, added fix_pass1)
-- No INSERT or UPDATE policies remain for authenticated or public roles.
-- Service-role edge functions (upsertRestaurant) bypass RLS and can still write.

-- ─── Invariant assertion comment ─────────────────────────────────────────────
-- After this migration runs, an authenticated client (non-service-role) that
-- attempts INSERT INTO restaurants (..., verification='verified') will be rejected
-- by RLS (no INSERT policy allows it). See SQL regression test in fixPass3.test.ts.
