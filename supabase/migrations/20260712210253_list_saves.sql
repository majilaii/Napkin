-- First-class list bookmarks.
--
-- A saved list is intentionally NOT a wishlist import: it preserves the
-- collection, its author, its ordering and future edits. Individual places
-- still enter the caller's wishlist one at a time.

CREATE TABLE public.list_saves (
    list_id     uuid        NOT NULL REFERENCES public.lists(id) ON DELETE CASCADE,
    user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (list_id, user_id)
);

COMMENT ON TABLE public.list_saves IS
    'Viewer bookmarks of authored public lists. Never expands into wishlist_items.';

CREATE INDEX list_saves_user_created_idx
    ON public.list_saves (user_id, created_at DESC, list_id DESC);

-- The mobile app reaches this table only through the lists Edge Function. That
-- function owns the public-account, Table/private-list and both-direction block
-- gates; keeping direct Data API access closed prevents clients from bypassing
-- those checks or manufacturing save counts.
ALTER TABLE public.list_saves ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.list_saves FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.list_saves TO service_role;

-- One bounded projection for the Saved Lists rail. Keeping the joins, counts and
-- cover lookup in one SQL statement avoids the Edge Function issuing three
-- network queries per card. The keyset is stable even when two saves share an
-- identical created_at because list_id is the deterministic tiebreaker.
--
-- SECURITY INVOKER is deliberate: the lists Edge Function calls this with its
-- service-role client after authenticating the viewer. Direct Data API execution
-- is revoked below, so clients cannot supply an arbitrary p_viewer_id.
CREATE OR REPLACE FUNCTION public.fn_saved_list_cards(
    p_viewer_id       uuid,
    p_limit           integer DEFAULT 40,
    p_before_saved_at timestamptz DEFAULT NULL,
    p_before_list_id  uuid DEFAULT NULL
)
RETURNS TABLE (
    id                   uuid,
    owner_id             uuid,
    title                text,
    description          text,
    ranked               boolean,
    privacy              text,
    emoji                text,
    created_at           timestamptz,
    updated_at           timestamptz,
    saved_at             timestamptz,
    entry_count          bigint,
    cover_photo_url      text,
    save_count           bigint,
    owner_display_name   text,
    owner_avatar_url     text,
    owner_username       text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT
        l.id,
        l.owner_id,
        l.title,
        l.description,
        l.ranked,
        l.privacy,
        l.emoji,
        l.created_at,
        l.updated_at,
        s.created_at AS saved_at,
        (
            SELECT count(*)::bigint
            FROM public.list_entries le
            WHERE le.list_id = l.id
        ) AS entry_count,
        (
            SELECT r.photo_url
            FROM public.list_entries le
            JOIN public.restaurants r ON r.id = le.restaurant_id
            WHERE le.list_id = l.id
            ORDER BY
                CASE WHEN l.ranked THEN le.position END ASC NULLS LAST,
                CASE WHEN NOT l.ranked THEN le.created_at END DESC NULLS LAST,
                le.id ASC
            LIMIT 1
        ) AS cover_photo_url,
        (
            SELECT count(*)::bigint
            FROM public.list_saves aggregate_save
            WHERE aggregate_save.list_id = l.id
        ) AS save_count,
        p.display_name AS owner_display_name,
        p.avatar_url AS owner_avatar_url,
        p.username AS owner_username
    FROM public.list_saves s
    JOIN public.lists l ON l.id = s.list_id
    JOIN public.profiles p ON p.user_id = l.owner_id
    WHERE s.user_id = p_viewer_id
      AND l.owner_id <> p_viewer_id
      AND l.privacy = 'public'
      AND l.table_id IS NULL
      AND p.account_privacy = 'public'
      AND NOT EXISTS (
          SELECT 1
          FROM public.blocked_users b
          WHERE (b.blocker_id = p_viewer_id AND b.blocked_id = l.owner_id)
             OR (b.blocker_id = l.owner_id AND b.blocked_id = p_viewer_id)
      )
      AND (
          p_before_saved_at IS NULL
          OR s.created_at < p_before_saved_at
          OR (
              s.created_at = p_before_saved_at
              AND p_before_list_id IS NOT NULL
              AND s.list_id < p_before_list_id
          )
      )
    ORDER BY s.created_at DESC, s.list_id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 40), 1), 50);
$$;

COMMENT ON FUNCTION public.fn_saved_list_cards(uuid, integer, timestamptz, uuid) IS
    'Service-only, privacy-gated saved-list cards with stable keyset pagination.';

REVOKE ALL ON FUNCTION public.fn_saved_list_cards(uuid, integer, timestamptz, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_saved_list_cards(uuid, integer, timestamptz, uuid)
    TO service_role;
