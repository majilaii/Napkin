-- ────────────────────────────────────────────────────────────────────────────
-- TICKET-020: Public profile — add public-facing columns to profiles
--
-- New columns:
--   account_privacy  — master switch, 'private' (default) | 'public'
--   allow_public_replies — pre-create for TICKET-021; enforced there
--   avatar_url       — plain URL; upload flow deferred
--   username         — vanity handle; nullable until user goes public
--
-- Username format: 3–24 chars, starts with a letter, lowercase [a-z0-9_].
-- Case-insensitive unique index (partial — only for non-null usernames).
-- ────────────────────────────────────────────────────────────────────────────

-- ── New columns ───────────────────────────────────────────────────────────

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS account_privacy TEXT NOT NULL DEFAULT 'private'
        CHECK (account_privacy IN ('private', 'public')),
    ADD COLUMN IF NOT EXISTS allow_public_replies BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS avatar_url TEXT,
    ADD COLUMN IF NOT EXISTS username TEXT
        CHECK (username IS NULL OR username ~ '^[a-z][a-z0-9_]{2,23}$');

-- ── Case-insensitive unique index (partial: only non-null usernames) ──────

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_idx
    ON public.profiles (lower(username))
    WHERE username IS NOT NULL;

-- ── Additive RLS policy: public profiles readable by anyone authenticated ─
-- Existing policies ("profiles self access" + "profiles read table mates")
-- are untouched. This third policy ORs with them.

CREATE POLICY "profiles read public"
ON public.profiles
FOR SELECT
USING (account_privacy = 'public');

-- ── Grants ────────────────────────────────────────────────────────────────
-- The new columns need to be readable by authenticated; writes go through
-- the edge function (service role), but SELECT must work for RLS joins.

GRANT SELECT ON public.profiles TO authenticated;
-- UPDATE is granted to service_role only (edge function writes); authenticated
-- users write through the edge function. No direct authenticated UPDATE needed.
GRANT ALL ON public.profiles TO service_role;
