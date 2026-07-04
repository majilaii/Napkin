/**
 * feed-friends edge function — TICKET-098 Phase A.
 *
 * Friends-only reviews feed: reverse-chronological, public-eligible entries
 * authored by the viewer's follow set (follows.follower_id = viewer —
 * asymmetric; mutual follow NOT required). Self excluded. Authors with an
 * either-direction blocked_users row vs the viewer excluded. Chronology only —
 * no ranking.
 *
 * Eligibility lives in ONE shared SQL helper (fn_public_eligible_entries,
 * called via fn_friends_feed) so it can never drift from the profile diary:
 *   restaurant_id IS NOT NULL AND visibility <> 'private'
 *   AND author account public AND no either-direction block.
 * Table-shared entries are eligible (TICKET-093 decision a) and render as
 * PLAIN entries — no table_id, Table name, Round context, or thread data is
 * read or returned here. Engagement fields are the PUBLIC scope counters
 * (public_reaction_count / public_reply_count / public_top_emojis) — never the
 * Table-scope ones (TICKET-085 scope isolation).
 *
 * POST only (cursor in body, per pagination doctrine). Response:
 *   { data: { rows: FriendFeedRow[], next_cursor, has_more } }
 * Cursor: base64(sort_date_iso|entry_id), sort_date = COALESCE(visited_at, created_at).
 *
 * This fn is the TICKET-098 replacement for the deleted legacy `feed` fn
 * (cross-Table aggregate + logger-count trending). Contract is NOT compatible:
 * own entries never appear here, and there is no `trending` sibling field.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { buildPage, decodeCursor } from '../_shared/pagination.ts';

const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 50;

interface RpcRow {
    id: string;
    user_id: string;
    restaurant_id: string | null;
    rating: number | null;
    content: string | null;
    visited_at: string | null;
    created_at: string;
    photo_url: string | null;
    public_reaction_count: number | null;
    public_reply_count: number | null;
    public_top_emojis: unknown[] | null;
    sort_date: string;
}

function fail(code: string, message: string, status = 400) {
    return new Response(
        JSON.stringify({ error: { code, message } }),
        { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        if (req.method !== 'POST') {
            return fail('METHOD_NOT_ALLOWED', 'POST only', 405);
        }

        const authHeader = req.headers.get('Authorization');
        if (!authHeader) return fail('UNAUTHORIZED', 'Missing Authorization header', 401);

        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        );

        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) return fail('UNAUTHORIZED', 'Unauthorized', 401);

        const body = await req.json().catch(() => ({}));
        const cursor: string | null = body.cursor ?? null;
        const limit = Math.min(
            Math.max(parseInt(body.limit ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE, 1),
            MAX_PAGE_SIZE,
        );

        // 1. Page of eligible entries — follow set, eligibility, blocks, and the
        //    keyset cursor are ALL applied in SQL before LIMIT [ARCH-REVIEW-4].
        const decoded = decodeCursor(cursor);
        const { data: rpcRows, error: rpcError } = await supabase.rpc('fn_friends_feed', {
            p_viewer: user.id,
            p_cursor_date: decoded?.sort_date ?? null,
            p_cursor_id: decoded?.id ?? null,
            p_limit: limit + 1,
        });
        if (rpcError) throw rpcError;
        const rows = (rpcRows ?? []) as RpcRow[];

        // buildPage slices limit+1 → limit and derives has_more/next_cursor.
        // No JS-side filtering happens after the RPC (blocks are in SQL), so the
        // envelope math is exact.
        const page = buildPage(rows, limit, (r) => ({ sort_date: r.sort_date, id: r.id }));
        const pageRows = page.rows;

        // 2. Hydrate restaurants.
        const restaurantIds = [
            ...new Set(pageRows.map((e) => e.restaurant_id).filter((id): id is string => !!id)),
        ];
        const { data: restaurantRows, error: restErr } = restaurantIds.length > 0
            ? await supabase
                .from('restaurants')
                .select('id, name, photo_url')
                .in('id', restaurantIds)
            : { data: [], error: null };
        if (restErr) throw restErr;
        const restaurantMap = new Map(
            ((restaurantRows ?? []) as { id: string; name: string; photo_url: string | null }[])
                .map((r) => [r.id, r]),
        );

        // 3. Hydrate author profiles.
        const authorIds = [...new Set(pageRows.map((e) => e.user_id))];
        const { data: profileRows, error: profErr } = authorIds.length > 0
            ? await supabase
                .from('profiles')
                .select('user_id, username, display_name, avatar_url')
                .in('user_id', authorIds)
            : { data: [], error: null };
        if (profErr) throw profErr;
        const profileMap = new Map(
            ((profileRows ?? []) as { user_id: string; username: string | null; display_name: string; avatar_url: string | null }[])
                .map((p) => [p.user_id, p]),
        );

        // 4. Extra entry photos.
        const entryIds = pageRows.map((e) => e.id);
        const photosByEntry = new Map<string, string[]>();
        if (entryIds.length > 0) {
            const { data: photoRows, error: photoErr } = await supabase
                .from('entry_photos')
                .select('entry_id, photo_url')
                .in('entry_id', entryIds)
                .order('sort_order', { ascending: true });
            if (photoErr) throw photoErr;
            for (const p of (photoRows ?? []) as { entry_id: string; photo_url: string }[]) {
                const list = photosByEntry.get(p.entry_id) ?? [];
                list.push(p.photo_url);
                photosByEntry.set(p.entry_id, list);
            }
        }

        // 5. Viewer's own PUBLIC-scope reactions on these entries (for the
        //    my_reactions toggle state — public scope only, never table).
        const myReactionsByEntry = new Map<string, string[]>();
        if (entryIds.length > 0) {
            const { data: reactRows, error: reactErr } = await supabase
                .from('post_reactions')
                .select('target_id, emoji')
                .eq('target_type', 'entry')
                .eq('user_id', user.id)
                .eq('scope', 'public')
                .in('target_id', entryIds);
            if (reactErr) throw reactErr;
            for (const r of (reactRows ?? []) as { target_id: string; emoji: string }[]) {
                const list = myReactionsByEntry.get(r.target_id) ?? [];
                list.push(r.emoji);
                myReactionsByEntry.set(r.target_id, list);
            }
        }

        // 6. Shape rows. Engagement field NAMES intentionally match the legacy
        //    FeedEntry (reaction_count / comment_count / top_emojis / my_reactions)
        //    so the shared optimistic patches in usePostInteractions keep working
        //    — but the VALUES are public-scope counters.
        const shaped = pageRows.map((e) => {
            const extraPhotos = photosByEntry.get(e.id) ?? [];
            const photos = [
                ...(e.photo_url ? [e.photo_url] : []),
                ...extraPhotos,
            ];
            const profile = profileMap.get(e.user_id);
            return {
                id: e.id,
                user_id: e.user_id,
                restaurant_id: e.restaurant_id,
                rating: e.rating,
                content: e.content,
                visited_at: e.visited_at,
                created_at: e.created_at,
                sort_date: e.sort_date,
                photos,
                photo_count: photos.length,
                reaction_count: e.public_reaction_count ?? 0,
                comment_count: e.public_reply_count ?? 0,
                top_emojis: e.public_top_emojis ?? [],
                my_reactions: myReactionsByEntry.get(e.id) ?? [],
                restaurant: e.restaurant_id
                    ? (restaurantMap.get(e.restaurant_id) ?? null)
                    : null,
                author: profile
                    ? {
                        user_id: profile.user_id,
                        username: profile.username,
                        display_name: profile.display_name,
                        avatar_url: profile.avatar_url,
                    }
                    : { user_id: e.user_id, username: null, display_name: 'Someone', avatar_url: null },
            };
        });

        return new Response(
            JSON.stringify({
                data: {
                    rows: shaped,
                    next_cursor: page.next_cursor,
                    has_more: page.has_more,
                },
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    } catch (error) {
        console.error('feed-friends error:', error);
        const details = error instanceof Error ? error.message : JSON.stringify(error);
        return new Response(
            JSON.stringify({ error: { code: 'INTERNAL', message: 'Internal Server Error', details } }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    }
});
