/**
 * Feed Edge Function
 * Cross-Table chronological feed for the Feed tab.
 *
 * Returns entries authored by anyone in any Table the caller is a member of,
 * within a rolling window (default 14 days). Also returns a trending rail
 * computed over the same window: top restaurants by distinct-logger count.
 *
 * The caller's own entries are INCLUDED — the feed is "what's happening across
 * my Tables" which includes my own activity.
 *
 * Response shape (Page envelope):
 *   {
 *     data: {
 *       rows: FeedEntry[],          // chronological, newest first
 *       next_cursor: string | null,
 *       has_more: boolean,
 *       trending: TrendingPoster[], // top 5, ranked — ONLY on page 0 (null on pages 1+)
 *       window_days: number,
 *     }
 *   }
 *
 * Cursor: base64(sort_date_iso|entry_id)  — sort_date = visited_at ?? created_at
 * Default page size: 30. Hard cap: 50.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { buildPage, decodeCursor, applyKeysetFilter } from '../_shared/pagination.ts';

const DEFAULT_WINDOW_DAYS = 14;
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 50;

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get('Authorization');
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: 'Missing Authorization header' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        const token = authHeader.replace('Bearer ', '');
        const supabase = createClient(supabaseUrl ?? '', supabaseServiceKey ?? '');

        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        // Accept both GET (legacy) and POST (new pagination path)
        let windowDays = DEFAULT_WINDOW_DAYS;
        let cursor: string | null = null;
        let limit = DEFAULT_PAGE_SIZE;

        if (req.method === 'POST') {
            const body = await req.json().catch(() => ({}));
            windowDays = parseInt(body.window_days ?? String(DEFAULT_WINDOW_DAYS));
            cursor = body.cursor ?? null;
            limit = Math.min(Math.max(parseInt(body.limit ?? String(DEFAULT_PAGE_SIZE)), 1), MAX_PAGE_SIZE);
        } else if (req.method === 'GET') {
            const url = new URL(req.url);
            windowDays = parseInt(url.searchParams.get('window_days') || String(DEFAULT_WINDOW_DAYS));
            cursor = url.searchParams.get('cursor') ?? null;
            limit = Math.min(
                Math.max(parseInt(url.searchParams.get('limit') || String(DEFAULT_PAGE_SIZE)), 1),
                MAX_PAGE_SIZE,
            );
        } else {
            return new Response(
                JSON.stringify({ error: 'Method not allowed' }),
                { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        const sinceIso = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
        const decoded = decodeCursor(cursor);
        const isFirstPage = !decoded;

        // 1. Find all tables the caller belongs to
        const { data: memberships, error: memErr } = await supabase
            .from('table_members')
            .select('table_id')
            .eq('member_id', user.id);

        if (memErr) throw memErr;
        const tableIds = (memberships ?? []).map((m: { table_id: string }) => m.table_id);

        if (tableIds.length === 0) {
            return new Response(
                JSON.stringify({
                    data: {
                        rows: [],
                        next_cursor: null,
                        has_more: false,
                        trending: isFirstPage ? [] : null,
                        window_days: windowDays,
                    },
                }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        // 2. Pull entries across all those tables in the window, with cursor keyset
        let entriesQuery = supabase
            .from('entries')
            .select(`
                id,
                user_id,
                table_id,
                restaurant_id,
                rating,
                content,
                dish_description,
                visited_at,
                created_at,
                table_night_id,
                photo_url,
                reaction_count,
                comment_count,
                top_emojis,
                restaurants (
                    id,
                    name,
                    address,
                    city,
                    photo_url
                )
            `)
            .in('table_id', tableIds)
            .is('table_night_id', null)
            .gte('visited_at', sinceIso)
            .order('visited_at', { ascending: false })
            .order('id', { ascending: false })
            .limit(limit + 1);

        if (decoded) {
            entriesQuery = applyKeysetFilter(entriesQuery, { sort_date: decoded.sort_date, id: decoded.id });
        }

        const { data: entries, error: entriesErr } = await entriesQuery;
        if (entriesErr) throw entriesErr;

        const rawEntries = (entries ?? []) as Array<{
            id: string;
            user_id: string;
            restaurant_id: string | null;
            rating: number | null;
            content: string | null;
            visited_at: string | null;
            created_at: string;
            photo_url: string | null;
            restaurants: { id: string; name: string; photo_url: string | null } | null;
            [k: string]: unknown;
        }>;

        // 3. Hydrate profiles for authors
        const authorIds = [...new Set(rawEntries.map((e) => e.user_id))];
        const { data: profiles } = authorIds.length > 0
            ? await supabase
                .from('profiles')
                .select('user_id, display_name, avatar_url')
                .in('user_id', authorIds)
            : { data: [] };
        const profileMap = new Map(
            (profiles ?? []).map((p: { user_id: string; display_name: string; avatar_url: string | null }) =>
                [p.user_id, p],
            ),
        );

        // 4. Photo counts (only for the page rows)
        const entryIdsForPhotos = rawEntries.map((e) => e.id);
        const { data: photoRows } = entryIdsForPhotos.length > 0
            ? await supabase
                .from('entry_photos')
                .select('entry_id, photo_url')
                .in('entry_id', entryIdsForPhotos)
            : { data: [] };
        const photosByEntry = new Map<string, string[]>();
        for (const p of (photoRows ?? []) as { entry_id: string; photo_url: string }[]) {
            const list = photosByEntry.get(p.entry_id) ?? [];
            list.push(p.photo_url);
            photosByEntry.set(p.entry_id, list);
        }

        // 4b. Caller's reactions on these entries
        const myReactionsByEntry = new Map<string, string[]>();
        if (entryIdsForPhotos.length > 0) {
            const { data: reactRows } = await supabase
                .from('post_reactions')
                .select('target_id, emoji')
                .eq('target_type', 'entry')
                .eq('user_id', user.id)
                .eq('scope', 'table')
                .in('target_id', entryIdsForPhotos);
            for (const r of (reactRows ?? []) as { target_id: string; emoji: string }[]) {
                const list = myReactionsByEntry.get(r.target_id) ?? [];
                list.push(r.emoji);
                myReactionsByEntry.set(r.target_id, list);
            }
        }

        // 4c. prior_visit — for the caller's own entries on this page
        const myOwnEntries = rawEntries.filter((e) => e.user_id === user.id && e.restaurant_id != null);
        const priorVisitMap = new Map<string, { count: number; last_rating: number | null }>();

        if (myOwnEntries.length > 0) {
            const myRestaurantIds = [...new Set(myOwnEntries.map((e) => e.restaurant_id as string))];
            const { data: priorRows } = await supabase
                .from('entries')
                .select('id, restaurant_id, rating, visited_at')
                .eq('user_id', user.id)
                .in('restaurant_id', myRestaurantIds)
                .order('visited_at', { ascending: false });

            const byRestaurant = new Map<string, { id: string; rating: number | null; visited_at: string | null }[]>();
            for (const row of (priorRows ?? []) as { id: string; restaurant_id: string | null; rating: number | null; visited_at: string | null }[]) {
                if (!row.restaurant_id) continue;
                const list = byRestaurant.get(row.restaurant_id) ?? [];
                list.push({ id: row.id, rating: row.rating, visited_at: row.visited_at });
                byRestaurant.set(row.restaurant_id, list);
            }

            for (const e of myOwnEntries) {
                const rows = byRestaurant.get(e.restaurant_id as string) ?? [];
                const targetVisitedAt = e.visited_at ?? '';
                const earlier = rows.filter((r) =>
                    r.id !== e.id && r.visited_at != null && targetVisitedAt !== '' && r.visited_at < targetVisitedAt,
                );
                if (earlier.length > 0) {
                    const lastRated = earlier.find((r) => r.rating != null);
                    priorVisitMap.set(e.id, {
                        count: earlier.length,
                        last_rating: lastRated?.rating ?? null,
                    });
                }
            }
        }

        // 5. Shape entries
        const shaped = rawEntries.map((e) => {
            const extraPhotos = photosByEntry.get(e.id) ?? [];
            const photos = [
                ...(e.photo_url ? [e.photo_url as string] : []),
                ...extraPhotos,
            ];
            return {
                id: e.id,
                user_id: e.user_id,
                restaurant_id: e.restaurant_id,
                rating: e.rating,
                content: e.content,
                visited_at: e.visited_at,
                created_at: e.created_at,
                photos,
                photo_count: photos.length,
                reaction_count: (e.reaction_count as number) ?? 0,
                comment_count: (e.comment_count as number) ?? 0,
                top_emojis: (e.top_emojis as unknown[]) ?? [],
                my_reactions: myReactionsByEntry.get(e.id) ?? [],
                restaurant: e.restaurants
                    ? {
                        id: (e.restaurants as any).id,
                        name: (e.restaurants as any).name,
                        photo_url: (e.restaurants as any).photo_url,
                    }
                    : null,
                author: profileMap.get(e.user_id) ?? { display_name: 'Someone', avatar_url: null },
                sort_date: e.visited_at || e.created_at,
                prior_visit: priorVisitMap.get(e.id) ?? null,
            };
        });

        // Build the Page envelope
        const page = buildPage(shaped, limit, (e) => ({
            sort_date: e.sort_date,
            id: e.id,
        }));

        // 6. Trending rail — only compute on first page
        let trending: unknown[] | null = null;
        if (isFirstPage) {
            const byRestaurant = new Map<string, {
                restaurant_id: string;
                restaurant: { id: string; name: string; photo_url: string | null };
                loggers: Set<string>;
                sumRating: number;
                countRating: number;
                latest: string;
            }>();

            for (const e of page.rows) {
                if (!e.restaurant || !e.restaurant_id) continue;
                const key = e.restaurant_id;
                const cur = byRestaurant.get(key) ?? {
                    restaurant_id: e.restaurant_id,
                    restaurant: e.restaurant,
                    loggers: new Set<string>(),
                    sumRating: 0,
                    countRating: 0,
                    latest: e.sort_date,
                };
                cur.loggers.add(e.user_id);
                if (typeof e.rating === 'number') {
                    cur.sumRating += e.rating;
                    cur.countRating += 1;
                }
                if (e.sort_date > cur.latest) cur.latest = e.sort_date;
                byRestaurant.set(key, cur);
            }

            trending = [...byRestaurant.values()]
                .sort((a, b) => {
                    if (b.loggers.size !== a.loggers.size) return b.loggers.size - a.loggers.size;
                    return a.latest < b.latest ? 1 : -1;
                })
                .slice(0, 5)
                .map((r, i) => ({
                    rank: i + 1,
                    restaurant: r.restaurant,
                    logger_count: r.loggers.size,
                    average_rating: r.countRating > 0 ? r.sumRating / r.countRating : null,
                }));
        }

        return new Response(
            JSON.stringify({
                data: {
                    rows: page.rows,
                    next_cursor: page.next_cursor,
                    has_more: page.has_more,
                    trending,
                    window_days: windowDays,
                },
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    } catch (error) {
        console.error('feed error:', error);
        const details = error instanceof Error ? error.message : JSON.stringify(error);
        return new Response(
            JSON.stringify({ error: 'Internal Server Error', details }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    }
});
