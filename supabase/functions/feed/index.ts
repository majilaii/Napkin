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
 * Response shape:
 *   {
 *     data: {
 *       entries: FeedEntry[],       // chronological, newest first
 *       trending: TrendingPoster[], // top 5, ranked
 *       windowDays: number,
 *     }
 *   }
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

const DEFAULT_WINDOW_DAYS = 14;

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

        if (req.method !== 'GET') {
            return new Response(
                JSON.stringify({ error: 'Method not allowed' }),
                { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        const url = new URL(req.url);
        const windowDays = parseInt(url.searchParams.get('window_days') || String(DEFAULT_WINDOW_DAYS));
        const sinceIso = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

        // 1. Find all tables the caller belongs to
        const { data: memberships, error: memErr } = await supabase
            .from('table_members')
            .select('table_id')
            .eq('member_id', user.id);

        if (memErr) throw memErr;
        const tableIds = (memberships ?? []).map((m: { table_id: string }) => m.table_id);

        if (tableIds.length === 0) {
            return new Response(
                JSON.stringify({ data: { entries: [], trending: [], windowDays } }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        // 2. Pull entries across all those tables in the window
        const { data: entries, error: entriesErr } = await supabase
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
            .limit(200);

        if (entriesErr) throw entriesErr;

        const entryList = (entries ?? []) as Array<{
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
        const authorIds = [...new Set(entryList.map((e) => e.user_id))];
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

        // 4. Photo counts
        const entryIds = entryList.map((e) => e.id);
        const { data: photoRows } = entryIds.length > 0
            ? await supabase
                .from('entry_photos')
                .select('entry_id, photo_url')
                .in('entry_id', entryIds)
            : { data: [] };
        const photosByEntry = new Map<string, string[]>();
        for (const p of (photoRows ?? []) as { entry_id: string; photo_url: string }[]) {
            const list = photosByEntry.get(p.entry_id) ?? [];
            list.push(p.photo_url);
            photosByEntry.set(p.entry_id, list);
        }

        // 4b. Caller's reactions on these entries (powers tap-to-react state)
        const myReactionsByEntry = new Map<string, string[]>();
        if (entryIds.length > 0) {
            const { data: reactRows } = await supabase
                .from('post_reactions')
                .select('target_id, emoji')
                .eq('target_type', 'entry')
                .eq('user_id', user.id)
                .eq('scope', 'table')
                .in('target_id', entryIds);
            for (const r of (reactRows ?? []) as { target_id: string; emoji: string }[]) {
                const list = myReactionsByEntry.get(r.target_id) ?? [];
                list.push(r.emoji);
                myReactionsByEntry.set(r.target_id, list);
            }
        }

        // 4c. prior_visit — for the caller's own entries, fetch prior visit count + last rating.
        // Only runs for entries where user_id === caller's id (avoids privacy leak).
        // "Prior" = strictly earlier than the target entry's visited_at — future visits
        // must not be counted for older entries.
        const myOwnEntries = entryList.filter((e) => e.user_id === user.id && e.restaurant_id != null);
        const priorVisitMap = new Map<string, { count: number; last_rating: number | null }>();

        if (myOwnEntries.length > 0) {
            const myRestaurantIds = [...new Set(myOwnEntries.map((e) => e.restaurant_id as string))];

            const { data: priorRows } = await supabase
                .from('entries')
                .select('id, restaurant_id, rating, visited_at')
                .eq('user_id', user.id)
                .in('restaurant_id', myRestaurantIds)
                .order('visited_at', { ascending: false });

            // Group all the caller's entries by restaurant (sorted desc by visited_at).
            const byRestaurant = new Map<string, { id: string; rating: number | null; visited_at: string | null }[]>();
            for (const row of (priorRows ?? []) as { id: string; restaurant_id: string | null; rating: number | null; visited_at: string | null }[]) {
                if (!row.restaurant_id) continue;
                const list = byRestaurant.get(row.restaurant_id) ?? [];
                list.push({ id: row.id, rating: row.rating, visited_at: row.visited_at });
                byRestaurant.set(row.restaurant_id, list);
            }

            // Per target entry, filter strictly-earlier rows.
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

        // 5. Shape response
        const shaped = entryList.map((e) => {
            const extraPhotos = photosByEntry.get(e.id) ?? [];
            const photos = [
                ...(e.photo_url ? [e.photo_url] : []),
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
                reaction_count: e.reaction_count ?? 0,
                comment_count: e.comment_count ?? 0,
                top_emojis: e.top_emojis ?? [],
                my_reactions: myReactionsByEntry.get(e.id) ?? [],
                restaurant: e.restaurants
                    ? {
                        id: e.restaurants.id,
                        name: e.restaurants.name,
                        photo_url: e.restaurants.photo_url,
                    }
                    : null,
                author: profileMap.get(e.user_id) ?? { display_name: 'Someone', avatar_url: null },
                sort_date: e.visited_at || e.created_at,
                // prior_visit: nullable — only present for caller's own entries with prior history
                prior_visit: priorVisitMap.get(e.id) ?? null,
            };
        });

        // 6. Trending rail — count distinct loggers per restaurant in the window
        const byRestaurant = new Map<string, {
            restaurant_id: string;
            restaurant: { id: string; name: string; photo_url: string | null };
            loggers: Set<string>;
            sumRating: number;
            countRating: number;
            latest: string;
        }>();

        for (const e of shaped) {
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

        const trending = [...byRestaurant.values()]
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

        return new Response(
            JSON.stringify({ data: { entries: shaped, trending, windowDays } }),
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
