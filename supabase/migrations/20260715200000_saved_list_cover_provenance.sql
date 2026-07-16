-- TICKET-200: a saved-list cover must leave SQL with the exact restaurant
-- provenance selected by the same ranked/unranked ordering as the cover URL.
-- Joining attribution back by photo_url is unsafe because URLs are not unique
-- restaurant identities.
CREATE OR REPLACE FUNCTION public.fn_saved_list_cards_with_cover_credit(
    p_viewer_id       uuid,
    p_limit           integer DEFAULT 40,
    p_before_saved_at timestamptz DEFAULT NULL,
    p_before_list_id  uuid DEFAULT NULL
)
RETURNS TABLE (
    id                     uuid,
    owner_id               uuid,
    title                  text,
    description            text,
    ranked                 boolean,
    privacy                text,
    emoji                  text,
    created_at             timestamptz,
    updated_at             timestamptz,
    saved_at               timestamptz,
    entry_count            bigint,
    cover_photo_url        text,
    cover_photo_source     text,
    cover_attribution_html text,
    cover_restaurant_name  text,
    save_count             bigint,
    owner_display_name     text,
    owner_avatar_url       text,
    owner_username         text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT
        card.id,
        card.owner_id,
        card.title,
        card.description,
        card.ranked,
        card.privacy,
        card.emoji,
        card.created_at,
        card.updated_at,
        card.saved_at,
        card.entry_count,
        cover.photo_url AS cover_photo_url,
        cover.photo_source AS cover_photo_source,
        cover.places_photo_attribution_html AS cover_attribution_html,
        cover.name AS cover_restaurant_name,
        card.save_count,
        card.owner_display_name,
        card.owner_avatar_url,
        card.owner_username
    FROM public.fn_saved_list_cards(
        p_viewer_id,
        p_limit,
        p_before_saved_at,
        p_before_list_id
    ) AS card
    LEFT JOIN LATERAL (
        SELECT
            r.photo_url,
            r.photo_source,
            r.places_photo_attribution_html,
            r.name
        FROM public.list_entries le
        JOIN public.restaurants r ON r.id = le.restaurant_id
        WHERE le.list_id = card.id
        ORDER BY
            CASE WHEN card.ranked THEN le.position END ASC NULLS LAST,
            CASE WHEN NOT card.ranked THEN le.created_at END DESC NULLS LAST,
            le.id ASC
        LIMIT 1
    ) AS cover ON TRUE
    ORDER BY card.saved_at DESC, card.id DESC;
$$;

COMMENT ON FUNCTION public.fn_saved_list_cards_with_cover_credit(uuid, integer, timestamptz, uuid) IS
    'Service-only saved-list cards with cover URL, provenance, author attribution, and restaurant name selected atomically.';

REVOKE ALL ON FUNCTION public.fn_saved_list_cards_with_cover_credit(uuid, integer, timestamptz, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_saved_list_cards_with_cover_credit(uuid, integer, timestamptz, uuid)
    TO service_role;

-- Public-feed covers need the same exact cover identity so an author label
-- equal to the restaurant name can be minimized without dropping compliance.
CREATE OR REPLACE FUNCTION public.fn_browse_public_lists_with_cover_credit(
    p_viewer uuid,
    p_limit  integer DEFAULT 6
)
RETURNS TABLE (
    id                     uuid,
    owner_id               uuid,
    title                  text,
    description            text,
    ranked                 boolean,
    emoji                  text,
    entry_count            bigint,
    updated_at             timestamptz,
    owner_display_name     text,
    owner_avatar_url       text,
    owner_username         text,
    cover_photo_url        text,
    cover_photo_source     text,
    cover_attribution_html text,
    cover_restaurant_name  text
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
        l.emoji,
        (SELECT count(*) FROM public.list_entries counted WHERE counted.list_id = l.id),
        l.updated_at,
        p.display_name,
        p.avatar_url,
        p.username,
        CASE WHEN cover.photo_source = 'places'
                  AND cover.places_photo_attribution_html IS NOT NULL
             THEN cover.photo_url ELSE NULL END,
        CASE WHEN cover.photo_source = 'places'
                  AND cover.places_photo_attribution_html IS NOT NULL
             THEN cover.photo_source ELSE NULL END,
        CASE WHEN cover.photo_source = 'places'
                  AND cover.places_photo_attribution_html IS NOT NULL
             THEN cover.places_photo_attribution_html ELSE NULL END,
        CASE WHEN cover.photo_source = 'places'
                  AND cover.places_photo_attribution_html IS NOT NULL
             THEN cover.name ELSE NULL END
    FROM public.lists l
    JOIN public.profiles p ON p.user_id = l.owner_id
    LEFT JOIN LATERAL (
        SELECT
            r.name,
            r.photo_url,
            r.photo_source,
            r.places_photo_attribution_html
        FROM public.list_entries le
        JOIN public.restaurants r ON r.id = le.restaurant_id
        WHERE le.list_id = l.id
        ORDER BY
            CASE WHEN l.ranked THEN le.position END ASC NULLS LAST,
            CASE WHEN NOT l.ranked THEN le.created_at END DESC NULLS LAST,
            le.id ASC
        LIMIT 1
    ) AS cover ON TRUE
    WHERE l.privacy = 'public'
      AND l.table_id IS NULL
      AND p.account_privacy = 'public'
      AND l.owner_id <> p_viewer
    ORDER BY l.updated_at DESC, l.id DESC
    LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.fn_browse_public_lists_with_cover_credit(uuid, integer) IS
    'Service-only public-list browse with an atomically paired attributed Places cover and restaurant name.';

REVOKE ALL ON FUNCTION public.fn_browse_public_lists_with_cover_credit(uuid, integer)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_browse_public_lists_with_cover_credit(uuid, integer)
    TO service_role;
