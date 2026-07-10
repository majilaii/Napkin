-- TICKET-156 — On Socials rail: durable cover-frame cache for social clippings.
--
-- clip_thumbs is the content-keyed store of cached cover frames for the videos a
-- saver clipped a restaurant from (TikTok / Instagram-web). The rail NEVER
-- renders the provider's own thumbnail_url (a signed CDN path that expires in
-- hours — TICKET-155 header calls it ephemeral); it renders only the durable
-- copy keyed here.
--
-- ── Why a separate table, not a key in wishlist_items.source ──────────────────
-- The durable copy is shared across EVERY saver of the same video (dedupe for
-- free), needs a 'gone' skip-marker for 404'd videos (a per-save source field
-- can't hold a shared skip state), and stays out of the wishlist_items source
-- CHECK churn. content_key = SHA-256 of the canonical video URL
-- (_shared/videoUrlKey.ts — the SINGLE authority, imported by the read action,
-- the capture action, and the backfill script so the key never diverges).
--
-- ── Access model ─────────────────────────────────────────────────────────────
-- RLS ENABLED with NO policies: every access (rail read, capture upsert,
-- backfill upsert) is service-role, which bypasses RLS. Nothing client-facing
-- touches this table directly. The ONLY public surface is the storage bucket
-- below — its bytes are public-video cover frames content-keyed with NO saver
-- linkage in the path, so a public bucket leaks nothing about who saved. The
-- sensitive fact (who saved) stays behind TICKET-155's gated read.
--
-- ── Replay-from-zero safety ──────────────────────────────────────────────────
-- No dependency on any object added after this timestamp; storage.buckets /
-- storage.objects are Supabase-managed and predate every migration. Replays from
-- zero with no check_function_bodies toggle. Timestamp …150000 is after
-- TICKET-155's …140000 (duplicate-timestamp guard verifies ordering).

CREATE TABLE IF NOT EXISTS public.clip_thumbs (
    content_key text PRIMARY KEY,
    storage_path text,
    status text NOT NULL DEFAULT 'cached' CHECK (status IN ('cached', 'gone')),
    source_type text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.clip_thumbs IS
    'TICKET-156: content-keyed cache of social-clipping cover frames. '
    'content_key = SHA-256(canonical video url). status ''gone'' = deleted/404 '
    'video, a permanent skip-marker (never re-fetched → typographic fallback '
    'forever). Service-role only (RLS on, no policies); the public surface is '
    'the clip-thumbs storage bucket, whose bytes carry no saver linkage.';

ALTER TABLE public.clip_thumbs ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: all access is service-role (bypasses RLS).

-- ── Public-read storage bucket (mirrors the entry-photos precedent) ──────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('clip-thumbs', 'clip-thumbs', true)
ON CONFLICT (id) DO NOTHING;

-- Public read: anyone can view a cached cover frame (public-video bytes, no PII).
-- NO authenticated INSERT/UPDATE/DELETE policy — service-role uploads bypass RLS,
-- so the bucket is public-read / service-role-write only (deletes the entire
-- authenticated-write RLS attack surface; the capture edge action is the sole
-- write path).
DROP POLICY IF EXISTS "Public read clip-thumbs" ON storage.objects;
CREATE POLICY "Public read clip-thumbs"
    ON storage.objects
    FOR SELECT
    USING (bucket_id = 'clip-thumbs');
