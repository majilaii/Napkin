-- Migration: Drop deprecated reviews table
-- The reviews table was replaced by the unified entries table.
-- Data was migrated in 20251215145200_migrate_reviews_to_entries.sql
-- This migration removes the old table.

-- First drop all policies on the reviews table
DROP POLICY IF EXISTS "Allow authenticated insert reviews" ON public.reviews;
DROP POLICY IF EXISTS "Allow public read reviews" ON public.reviews;
DROP POLICY IF EXISTS "Allow users to update own reviews" ON public.reviews;
DROP POLICY IF EXISTS "Reviews are public" ON public.reviews;
DROP POLICY IF EXISTS "Reviews are publicly readable" ON public.reviews;
DROP POLICY IF EXISTS "Users can create their own reviews" ON public.reviews;
DROP POLICY IF EXISTS "Users can delete own reviews" ON public.reviews;
DROP POLICY IF EXISTS "Users can delete their own reviews" ON public.reviews;
DROP POLICY IF EXISTS "Users can insert own reviews" ON public.reviews;
DROP POLICY IF EXISTS "Users can update own reviews" ON public.reviews;
DROP POLICY IF EXISTS "Users can update their own reviews" ON public.reviews;

-- Drop the reviews table
DROP TABLE IF EXISTS public.reviews;
