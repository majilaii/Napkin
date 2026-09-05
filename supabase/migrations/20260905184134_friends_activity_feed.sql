-- Additive activity contract. Legacy fn_friends_feed remains unchanged for older apps.
-- The edge authenticates the viewer; only service_role can execute this invoker.
CREATE FUNCTION public.fn_friends_activity(
    p_viewer uuid, p_cursor_date timestamptz, p_cursor_key text, p_limit int
)
RETURNS TABLE (activity_key text, kind text, sort_date timestamptz, payload jsonb)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
    WITH actors AS MATERIALIZED (
        SELECT p.user_id, p.account_privacy
        FROM public.profiles p
        WHERE p_viewer IS NOT NULL AND (
            p.user_id = p_viewer OR (
                EXISTS (SELECT 1 FROM public.follows f
                    WHERE f.follower_id = p_viewer AND f.following_id = p.user_id)
                AND p.account_privacy = 'public'
                AND NOT EXISTS (SELECT 1 FROM public.blocked_users b
                    WHERE (b.blocker_id = p_viewer AND b.blocked_id = p.user_id)
                       OR (b.blocker_id = p.user_id AND b.blocked_id = p_viewer))
            )
        )
    ), candidates AS (
        SELECT 'entry:' || e.id AS activity_key, 'entry'::text AS kind,
               e.created_at AS sort_date, e.id AS source_id, e.user_id
        FROM public.entries e JOIN actors a ON a.user_id = e.user_id
        WHERE e.restaurant_id IS NOT NULL
          AND (e.user_id = p_viewer OR (
              e.visibility <> 'private' AND e.rating IS NOT NULL
              AND char_length(trim(COALESCE(e.content, ''))) >= 20
          ))
        UNION ALL
        SELECT 'pin:' || w.id, 'pin', w.created_at, w.id, w.user_id
        FROM public.wishlist_items w JOIN actors a ON a.user_id = w.user_id
        WHERE w.deleted_at IS NULL AND w.restaurant_id IS NOT NULL
        UNION ALL
        SELECT 'list:' || l.id, 'list', l.updated_at, l.id, l.owner_id
        FROM public.lists l JOIN actors a ON a.user_id = l.owner_id
        WHERE l.table_id IS NULL AND (l.owner_id = p_viewer OR l.privacy = 'public')
    ), page AS MATERIALIZED (
        SELECT c.* FROM candidates c
        WHERE p_cursor_date IS NULL
           OR (c.sort_date, c.activity_key COLLATE "C") < (p_cursor_date, p_cursor_key COLLATE "C")
        ORDER BY c.sort_date DESC, c.activity_key COLLATE "C" DESC
        LIMIT greatest(1, least(COALESCE(p_limit, 31), 51))
    )
    SELECT c.activity_key, c.kind, c.sort_date,
        jsonb_build_object(
            'id', CASE WHEN c.kind = 'entry' THEN c.source_id::text ELSE c.activity_key END,
            'user_id', c.user_id,
            'author', jsonb_build_object('user_id', p.user_id, 'username', p.username,
                'display_name', p.display_name, 'avatar_url', p.avatar_url)
        ) || CASE c.kind
        WHEN 'entry' THEN (
            SELECT jsonb_build_object(
                'restaurant_id', e.restaurant_id, 'rating', e.rating, 'content', e.content,
                'visited_at', e.visited_at, 'created_at', e.created_at,
                'photos', ph.photos, 'photo_count', jsonb_array_length(ph.photos),
                'reaction_count', COALESCE(e.public_reaction_count, 0),
                'comment_count', COALESCE(e.public_reply_count, 0),
                'top_emojis', COALESCE(e.public_top_emojis, '[]'::jsonb),
                'my_reactions', (SELECT COALESCE(jsonb_agg(pr.emoji ORDER BY pr.emoji), '[]'::jsonb)
                    FROM public.post_reactions pr WHERE pr.target_type = 'entry'
                    AND pr.target_id = e.id AND pr.user_id = p_viewer AND pr.scope = 'public'),
                'restaurant', jsonb_build_object('id', r.id, 'name', r.name, 'photo_url', r.photo_url)
            ) FROM public.entries e JOIN public.restaurants r ON r.id = e.restaurant_id
            CROSS JOIN LATERAL (
                SELECT (CASE WHEN e.photo_url IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(e.photo_url) END)
                    || (SELECT COALESCE(jsonb_agg(ep.photo_url ORDER BY ep.sort_order, ep.id), '[]'::jsonb)
                        FROM public.entry_photos ep WHERE ep.entry_id = e.id) AS photos
            ) ph WHERE e.id = c.source_id
        )
        WHEN 'pin' THEN (
            SELECT jsonb_build_object('restaurant_id', w.restaurant_id, 'created_at', w.created_at,
                'restaurant', jsonb_build_object('id', r.id, 'name', r.name, 'photo_url', r.photo_url))
            FROM public.wishlist_items w JOIN public.restaurants r ON r.id = w.restaurant_id
            WHERE w.id = c.source_id
        )
        WHEN 'list' THEN (
            SELECT jsonb_build_object('list_id', l.id, 'title', l.title, 'emoji', l.emoji,
                'created_at', l.created_at, 'updated_at', l.updated_at,
                'action', CASE WHEN l.created_at = l.updated_at THEN 'created' ELSE 'updated' END)
            FROM public.lists l WHERE l.id = c.source_id
        ) END
    FROM page c JOIN public.profiles p ON p.user_id = c.user_id
    ORDER BY c.sort_date DESC, c.activity_key COLLATE "C" DESC;
$$;
REVOKE ALL ON FUNCTION public.fn_friends_activity(uuid, timestamptz, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_friends_activity(uuid, timestamptz, text, int) TO service_role;
COMMENT ON FUNCTION public.fn_friends_activity(uuid, timestamptz, text, int) IS
    'Viewer and followed public accounts: entries, resolved active pins, latest personal list updates. '
    'All privacy and block gates precede pagination. No Table context. Verified viewer from edge only.';
