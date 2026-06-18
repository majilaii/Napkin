-- supabase/migrations/20260618000000_lists_name_drop_notnull.sql
--
-- Fix: "null value in column name of relation lists violates not-null constraint"
-- on every list create.
--
-- The legacy remote_schema `lists` table (20251201) declared `name TEXT NOT NULL`.
-- The Lists primitive (TICKET-018, 20260421) used CREATE TABLE IF NOT EXISTS, a
-- no-op against the pre-existing table, then added `title` (20260424). So the live
-- table carries BOTH the dead legacy `name NOT NULL` and the real `title`. The
-- create path inserts only `title`, leaving `name` NULL → 23502.
--
-- `name` (and the legacy `is_public`) are unreferenced in all code, RLS, views,
-- and functions (grep-verified). Drop the NOT NULL so creates succeed. The dead
-- columns are left in place (no read path) to keep this change minimal/reversible.

ALTER TABLE public.lists ALTER COLUMN name DROP NOT NULL;
