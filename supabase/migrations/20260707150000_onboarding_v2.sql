-- Onboarding v2 (TICKET-126): profile photo + compliance marker.
--
-- Two additive changes, no data migration, replayable from zero:
--   1. profiles.terms_accepted_at — the 13+ / Terms-EULA acceptance marker.
--      Version-less v1 (timestamp only); stamped by complete_onboarding for
--      every new user (every signup passes through the onboarding stack).
--   2. avatars storage bucket — public read, own-folder write. Mirrors the
--      entry-photos posture (20260416100000) but a SEPARATE bucket: avatars are
--      a different visibility model from meal photos and must not share a folder
--      namespace. Path convention: avatars/{user_id}/{ts}.jpg (client upsert:false,
--      unique per write → no UPDATE policy needed).
--
-- No account_privacy default change (locked #2): the column default stays
-- 'private' (safe for rows that never complete onboarding); complete_onboarding
-- writes 'public' explicitly.

-- ── 1. terms acceptance marker ─────────────────────────────────────────────
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz;

-- ── 2. avatars bucket (idempotent) ─────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- ── 3. storage.objects policies for avatars (guarded → replay-safe) ─────────
-- Distinct policy names from entry-photos so both buckets' policies coexist.
DO $do$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'Public read avatars'
    ) THEN
        CREATE POLICY "Public read avatars"
            ON storage.objects
            FOR SELECT
            USING (bucket_id = 'avatars');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'Authenticated upload own folder avatars'
    ) THEN
        CREATE POLICY "Authenticated upload own folder avatars"
            ON storage.objects
            FOR INSERT
            TO authenticated
            WITH CHECK (
                bucket_id = 'avatars'
                AND (storage.foldername(name))[1] = auth.uid()::text
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'Authenticated delete own files avatars'
    ) THEN
        CREATE POLICY "Authenticated delete own files avatars"
            ON storage.objects
            FOR DELETE
            TO authenticated
            USING (
                bucket_id = 'avatars'
                AND (storage.foldername(name))[1] = auth.uid()::text
            );
    END IF;
END;
$do$;
