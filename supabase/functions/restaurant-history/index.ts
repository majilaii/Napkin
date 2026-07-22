/**
 * Restaurant History Edge Function
 *
 * Returns the Table's (or a user's) accumulated memory at a given restaurant:
 * previous Rounds, previous solo entries, and aggregate averages.
 *
 * This powers:
 *   - "Previously here" banner on Round detail (table-scoped)
 *   - Delta chip on Round hero (previous group average vs current)
 *   - "Previously here" banner on Entry detail (user-scoped, cross-table)
 *   - /restaurant/[id] screen (table-scoped list of all visits)
 *
 * Actions:
 *   GET  ?action=table_history&restaurant_id=X&table_id=Y[&exclude_night_id=Z]
 *   GET  ?action=user_history&restaurant_id=X[&exclude_entry_id=Z]
 *   GET  ?action=page&restaurant_id=X[&table_id=Y]
 *   GET  ?action=reserve_link&restaurant_id=X   (TICKET-149 booking-page resolver)
 *   POST ?action=reviews  { restaurant_id, cursor?, limit? }   (TICKET-154 all-reviews page)
 *   POST ?action=featured_lists  { restaurant_id }
 *
 * Both filter to data the requesting user is entitled to see. Table history
 * verifies the caller is a member of the table; user history is trivially
 * scoped to the caller's own entries.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { reportError } from '../_shared/report.ts';
import { resolveReserveUrl } from '../_shared/reserveLink.ts';
import { buildPage, decodeCursor, encodeCursor } from '../_shared/pagination.ts';
import { computeCalibrations, type Calibration } from '../_shared/calibration.ts';
import { projectRound } from '../_shared/round_projection.ts';
import { resolveRestaurantLookupId } from '../_shared/canonicalRestaurant.ts';
// TICKET-156: the single content-key authority for the On Socials rail — the
// TICKET-189: exact-hostname IG predicate (TS copy of fn_is_instagram_url) —
// replaced the inline /instagram\.com|instagr\.am/ substring regex, closing
// the notinstagram.com / query-string deception gap in this rail too.
import { isInstagramUrl } from '../_shared/socialHost.ts';
// SAME normalizer the capture action and backfill import, so read/capture/
// backfill keys never diverge.
import { contentKey } from '../_shared/videoUrlKey.ts';
import { isPeekCardContext, loadPeekCard } from './peekCard.ts';

type Visit = {
    kind: 'round' | 'solo';
    id: string; // table_night_id for rounds, entry_id for solos
    rating: number | null;
    date: string; // ISO
    user_display_names: string[]; // participants (rounds) or single author (solo)
    entry_id?: string; // for solos — convenient for navigation
    table_night_id?: string; // for rounds
    // Extended fields for action=page
    user_id?: string;
    avatar_url?: string | null;
    note?: string | null;
    is_self?: boolean;
    is_tablemate?: boolean;
};

type WhosBeenEntry = {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    personal_average: number;
    visit_count: number;
};

type PublicReviewCard = {
    entry_id: string;
    user_id: string;
    display_name: string;
    username: string | null;
    avatar_url: string | null;
    rating: number;
    note_excerpt: string;
    photo_url: string | null;
    created_at: string;
    public_reaction_count: number;
    public_reply_count: number;
    calibration: Calibration | null;
    is_followee: boolean;
};

type PhotoItem = {
    url: string;
    author_display_name: string;
    author_handle: string;
    is_tablemate: boolean;
    is_self: boolean;
    entry_id: string;
};

type PlaceDetails = {
    hours_today: string | null;
    open_now: boolean | null;
    hours_week: Array<{ day_range: string; range: string }> | null;
    website: string | null;
    phone: string | null;
    menu_url: string | null;
    lat: number | null;
    lng: number | null;
};

type ProfessionalCritic = {
    id: string;
    publication: string;
    kind: 'stars' | 'score' | 'essential' | 'feature';
    score: string | null;
    score_out_of: string | null;
    author: string | null;
    published_date: string | null;
    excerpt: string | null;  // server-blanked when scrape_confidence < 70
    source_url: string | null;
};

type RestaurantPageData = {
    restaurant: {
        id: string;
        name: string;
        address: string | null;
        city: string | null;
        country: string | null;
        cuisine: string | null;
        price_level: number | null;
        photo_url: string | null;
        google_rating: number | null;
        google_rating_count: number | null;
        external_id: string | null;
        // TICKET-057: photo provenance and attribution for Places-sourced heroes.
        photo_source: 'user' | 'table' | 'places' | 'none' | null;
        places_photo_attribution_html: string | null;
        // TICKET-081: restaurant-page metadata (phone · directions · website · hours).
        phone: string | null;
        website: string | null;
        google_maps_uri: string | null;
        hours: { weekdayDescriptions: string[] } | null;
        // TICKET-081 fix-pass: durable Places-sync sentinel. The page gates its lazy
        // backfill on this freshness (NOT on metadata-presence), so a place that
        // legitimately has no phone/hours stops re-hitting Google after one sync.
        places_synced_at: string | null;
        // TICKET-149: direct booking-page URL resolved from the venue's website
        // (action=reserve_link writes it; found URLs sticky, nulls recheck at 30d).
        reserve_url: string | null;
        reserve_url_checked_at: string | null;
    } | null;
    personal: { average: number | null; visit_count: number };
    table_chip: { table_id: string; table_name: string; average: number; visit_count: number } | null;
    whos_been: WhosBeenEntry[];
    visits: Visit[];
    visit_count: number;
    public_reviews: PublicReviewCard[];
    public_reviews_total: number;
    // v3 additions
    distributions: {
        you: number[];
        your_table: number[] | null;
        napkin: number[];
    };
    /** TICKET-154: 10 half-star bins [0.5 … 5.0]. The legacy 5-bucket field
     * above is frozen for old clients. */
    distributions_half: {
        you: number[];
        your_table: number[] | null;
        napkin: number[];
    };
    napkin_aggregate: {
        average: number | null;
        count: number;
    };
    photos: {
        from_your_table: PhotoItem[];
        from_others: PhotoItem[];
    };
    place_details: PlaceDetails;
    tables_count_with_logs: number;
    first_logged_at_by_your_table: string | null;
    // TICKET-026: professional critic reviews
    professional_critics: ProfessionalCritic[];
};

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

function fail(message: string, status = 400): Response {
    return json({ error: message }, status);
}

async function fetchProfiles(
    supabase: any,
    userIds: string[],
): Promise<Map<string, { display_name: string; avatar_url: string | null; username: string | null }>> {
    const map = new Map<string, { display_name: string; avatar_url: string | null; username: string | null }>();
    if (userIds.length === 0) return map;
    const unique = [...new Set(userIds)];
    const { data, error } = await supabase
        .from('profiles')
        .select('user_id, display_name, avatar_url, username')
        .in('user_id', unique);
    if (error) throw error;
    for (const p of (data ?? []) as any[]) {
        map.set(p.user_id, {
            display_name: p.display_name ?? 'Member',
            avatar_url: p.avatar_url ?? null,
            username: p.username ?? null,
        });
    }
    return map;
}

/**
 * Build a 5-element distribution array [1★ count, …, 5★ count].
 * LEGACY (whole-star, Math.round — 4.5 lands in the 5 bucket): kept only so
 * clients predating distributions_half keep rendering. New clients use
 * buildHalfDistribution below. Do not add consumers.
 */
function buildDistribution(ratings: number[]): number[] {
    const dist = [0, 0, 0, 0, 0];
    for (const r of ratings) {
        const bucket = Math.round(Math.max(1, Math.min(5, r))) - 1;
        dist[bucket]++;
    }
    return dist;
}

/**
 * TICKET-154: 10 half-star bins [0.5, 1.0, …, 5.0] so a 4.5 is a 4.5 —
 * ratings are DOUBLE PRECISION 0.5–5.0 and the logger records halves;
 * rounding them into whole stars misrepresented the histogram.
 */
function buildHalfDistribution(ratings: number[]): number[] {
    const dist = new Array(10).fill(0);
    for (const r of ratings) {
        const bin = Math.round(Math.max(0.5, Math.min(5, r)) * 2); // 1..10
        dist[bin - 1]++;
    }
    return dist;
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get('Authorization');
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        if (!authHeader) return fail('Missing Authorization header', 401);

        const token = authHeader.replace('Bearer ', '');
        const supabase = createClient(supabaseUrl ?? '', supabaseServiceKey ?? '');

        const {
            data: { user },
            error: userError,
        } = await supabase.auth.getUser(token);
        if (userError || !user) return fail('Unauthorized', 401);

        const url = new URL(req.url);
        const action = url.searchParams.get('action');
        let restaurantId = url.searchParams.get('restaurant_id');

        // GET for the classic read actions; POST only for body-routed actions
        // (paginated — cursor strings don't belong in query params).
        if (req.method !== 'GET' && req.method !== 'POST') {
            return fail('Method not allowed', 405);
        }
        if (
            req.method === 'POST'
            && action !== 'reviews'
            && action !== 'social_clippings'
            && action !== 'featured_lists'
            && action !== 'peek_card'
        ) {
            return fail('Method not allowed', 405);
        }

        // ── Restaurant search ─────────────────────────────────────────────
        if (action === 'search') {
            const q = url.searchParams.get('q')?.trim();
            if (!q || q.length < 2) return fail('q must be at least 2 characters', 400);

            const { data: memberships, error: memberErr } = await supabase
                .from('table_members')
                .select('table_id, tables(id, name)')
                .eq('member_id', user.id);
            if (memberErr) throw memberErr;

            const tableIds = (memberships ?? []).map((m: any) => m.table_id as string);

            let visitedRestaurants: any[] = [];
            if (tableIds.length > 0) {
                // TICKET-043: disambiguate FK after entry_tables join was added.
                // Two relationships now exist between entries and tables: legacy entries.table_id
                // and entry_tables. PostgREST throws PGRST201 unless we name the FK explicitly.
                const { data: entryRestaurants, error: entryErr } = await supabase
                    .from('entries')
                    .select('restaurant_id, table_id, created_at, tables!entries_table_id_fkey(name)')
                    .in('table_id', tableIds)
                    .not('restaurant_id', 'is', null)
                    .order('created_at', { ascending: false });
                if (entryErr) throw entryErr;

                const { data: nightRestaurants, error: nightErr } = await supabase
                    .from('table_nights')
                    .select('restaurant_id, table_id, created_at, tables(name)')
                    .in('table_id', tableIds)
                    .eq('status', 'revealed')
                    .not('restaurant_id', 'is', null)
                    .order('created_at', { ascending: false });
                if (nightErr) throw nightErr;

                const restaurantTableMap = new Map<string, { table_name: string; most_recent_activity_at: string }>();
                for (const e of (entryRestaurants ?? [])) {
                    const rid = e.restaurant_id as string;
                    const tableName = (e as any).tables?.name as string ?? 'your Table';
                    const existing = restaurantTableMap.get(rid);
                    if (!existing || e.created_at > existing.most_recent_activity_at) {
                        restaurantTableMap.set(rid, { table_name: tableName, most_recent_activity_at: e.created_at });
                    }
                }
                for (const n of (nightRestaurants ?? [])) {
                    const rid = n.restaurant_id as string;
                    const tableName = (n as any).tables?.name as string ?? 'your Table';
                    const existing = restaurantTableMap.get(rid);
                    if (!existing || n.created_at > existing.most_recent_activity_at) {
                        restaurantTableMap.set(rid, { table_name: tableName, most_recent_activity_at: n.created_at });
                    }
                }

                if (restaurantTableMap.size > 0) {
                    const visitedIds = Array.from(restaurantTableMap.keys());
                    // [N4] Filter verification='verified' — service-role bypasses RLS,
                    // so the verified filter must be explicit to avoid leaking other
                    // users' unverified ghost restaurants.
                    const { data: restaurants, error: restErr } = await supabase
                        .from('restaurants')
                        // TICKET-167: address disambiguates same-name venues in the
                        // unified search list (shown on every row).
                        .select('id, name, city, cuisine, address, photo_url, photo_source, places_photo_attribution_html, external_id')
                        .in('id', visitedIds)
                        .ilike('name', `%${q}%`)
                        .eq('verification', 'verified')
                        .limit(10);
                    if (restErr) throw restErr;

                    visitedRestaurants = (restaurants ?? []).map((r: any) => ({
                        ...r,
                        table_name: restaurantTableMap.get(r.id)?.table_name ?? 'your Table',
                        most_recent_activity_at: restaurantTableMap.get(r.id)?.most_recent_activity_at ?? null,
                    }));
                }
            }

            const visitedIds = visitedRestaurants.map((r: any) => r.id as string);
            const visitedSet = new Set(visitedIds);
            // TICKET-037 (P2-16): fetch unfiltered, then JS-filter to avoid string-injection
            // risk from building a raw `NOT IN (uuid, uuid, ...)` SQL string.
            // [N4] Filter verification='verified' — service-role bypasses RLS; the filter
            // prevents unverified model-hallucinated ghosts from appearing in the global search.
            const { data: onNapkinRaw, error: onNapkinErr } = await supabase
                .from('restaurants')
                // TICKET-167: address disambiguates same-name venues in the
                // unified search list (shown on every row).
                .select('id, name, city, cuisine, address, photo_url, photo_source, places_photo_attribution_html, external_id')
                .ilike('name', `%${q}%`)
                .eq('verification', 'verified')
                .limit(30); // fetch extra to account for JS-side filter
            const onNapkin = onNapkinRaw
                ? onNapkinRaw.filter((r: any) => !visitedSet.has(r.id)).slice(0, 10)
                : [];
            if (onNapkinErr) throw onNapkinErr;

            return json({
                data: {
                    visitedByMyTables: visitedRestaurants,
                    onNapkin: (onNapkin ?? []).slice(0, 10),
                },
            });
        }

        // ── Paginated public reviews (TICKET-154) — the all-reviews page ──
        // POST { restaurant_id, cursor?, limit? } → canonical Page<PublicReviewCard>.
        // Same eligibility SSOT as the page's capped list (get_public_reviews),
        // keyset-paginated in SQL (get_public_reviews_page), enriched with the
        // same followee flags + Ring-2 calibrations.
        //
        // MUST stay above the global `if (!restaurantId)` query-param guard —
        // this action reads restaurant_id from the POST body first (clients
        // also mirror it into the query as belt-and-braces; the 2026-07-10
        // deploy smoke caught exactly this ordering bug).
        if (action === 'reviews') {
            const body = await req.json().catch(() => ({}));
            const rid = (body?.restaurant_id ?? restaurantId) as string | null;
            if (!rid) return fail('restaurant_id is required');

            // Accept UUID/external id, then follow any tombstone aliases.
            const resolvedId = await resolveRestaurantLookupId(supabase, rid);
            if (!resolvedId) return json({ data: { rows: [], next_cursor: null, has_more: false } });

            const pageSize = Math.min(Math.max(Number(body?.limit) || 30, 1), 50);
            const cursor = decodeCursor(body?.cursor);

            const { data: reviewRows, error: reviewsErr } = await supabase
                .rpc('get_public_reviews_page', {
                    p_restaurant_id: resolvedId,
                    p_limit: pageSize + 1,
                    p_cursor_date: cursor?.sort_date ?? null,
                    p_cursor_id: cursor?.id ?? null,
                });
            if (reviewsErr) throw reviewsErr;
            const raw = (reviewRows ?? []) as any[];

            // Ring-1 exclusion set (viewer's tablemates) — calibration is Ring 2 only.
            const sharedIds = new Set<string>();
            {
                const { data: memberships, error: memberErr } = await supabase
                    .from('table_members')
                    .select('table_id')
                    .eq('member_id', user.id);
                if (memberErr) throw memberErr;
                const tableIds = (memberships ?? []).map((m: any) => m.table_id as string);
                if (tableIds.length > 0) {
                    const { data: shared, error: sharedErr } = await supabase
                        .from('table_members')
                        .select('member_id')
                        .in('table_id', tableIds)
                        .neq('member_id', user.id);
                    if (sharedErr) throw sharedErr;
                    for (const m of shared ?? []) sharedIds.add((m as any).member_id as string);
                }
            }

            // Followee flags — non-fatal, same as the page block.
            const followedSet = new Set<string>();
            {
                const reviewerIds = [...new Set<string>(
                    raw.map((r) => r.user_id as string).filter((uid) => !!uid && uid !== user.id),
                )];
                if (reviewerIds.length > 0) {
                    const { data: followRows, error: followErr } = await supabase
                        .from('follows')
                        .select('following_id')
                        .eq('follower_id', user.id)
                        .in('following_id', reviewerIds);
                    if (followErr) console.error('restaurant-history follows error:', followErr);
                    for (const fr of followRows ?? []) {
                        followedSet.add((fr as { following_id: string }).following_id);
                    }
                }
            }

            // Ring-2 calibrations — non-fatal.
            let calMap = new Map<string, Calibration | null>();
            const calAuthorIds = [...new Set<string>(
                raw
                    .map((r) => r.user_id as string)
                    .filter((uid) => uid !== user.id && !sharedIds.has(uid)),
            )];
            if (calAuthorIds.length > 0) {
                try {
                    calMap = await computeCalibrations(supabase, user.id, calAuthorIds);
                } catch (calErr) {
                    console.error('restaurant-history calibration error:', calErr);
                }
            }

            const cards: PublicReviewCard[] = raw.map((row: any) => ({
                entry_id: row.entry_id,
                user_id: row.user_id,
                display_name: row.display_name ?? 'User',
                username: row.username ?? null,
                avatar_url: row.avatar_url ?? null,
                rating: row.rating,
                note_excerpt: row.content ?? '',
                photo_url: row.photo_url ?? null,
                created_at: row.created_at,
                public_reaction_count: row.public_reaction_count ?? 0,
                public_reply_count: row.public_reply_count ?? 0,
                calibration: (row.user_id === user.id || sharedIds.has(row.user_id))
                    ? null
                    : (calMap.get(row.user_id) ?? null),
                is_followee: followedSet.has(row.user_id),
            }));

            const page = buildPage(cards, pageSize, (row) =>
                ({ sort_date: row.created_at, id: row.entry_id }));
            return json({ data: page });
        }

        // ── On Socials rail (TICKET-156) — your circle's + strangers' clippings ──
        // POST { restaurant_id }. Reads TICKET-155's block-aware SECURITY DEFINER
        // predicate (fn_restaurant_saves_visible) — the SINGLE visibility referent
        // for self, circle, AND strangers — filters to social sources
        // (tiktok / IG-web / video), dedupes by canonical-video content key
        // (tier-then-recency winner + also_count), caps at 12, and joins the
        // durable clip_thumbs cache for thumbnail URLs (NEVER the rotting provider
        // CDN link). callEdgeFn strips the outer { data } envelope, so the rows
        // nest under data.
        //
        // MUST stay above the global `if (!restaurantId)` query-param guard below —
        // this action reads restaurant_id from the POST body first (clients mirror
        // it into the query too; the 2026-07-10 #193→#199 deploy smoke caught
        // exactly this ordering bug on the sibling `reviews` action).
        if (action === 'social_clippings') {
            const body = await req.json().catch(() => ({}));
            const rid = (body?.restaurant_id ?? restaurantId) as string | null;
            if (!rid) return fail('restaurant_id is required');

            // Accept UUID/external id, then follow any tombstone aliases.
            const resolvedId = await resolveRestaurantLookupId(supabase, rid);
            if (!resolvedId) return json({ data: { rows: [] } });

            // 155's predicate. p_viewer = the JWT-validated caller (unspoofable —
            // the RPC is service_role-only EXECUTE, invoked here after getUser).
            const { data: saverRows, error: rpcErr } = await supabase.rpc(
                'fn_restaurant_saves_visible',
                { p_viewer: user.id, p_restaurant_id: resolvedId },
            );
            if (rpcErr) {
                // Fail-open ONLY when 155's RPC isn't applied yet on this stack —
                // keyed on ERROR CODES alone (undefined_function / PostgREST
                // not-found). A message regex would also match a PRESENT-but-broken
                // RPC (a missing dependency throws "… does not exist" under a
                // different code) and silently mask a real fault as an empty rail
                // (review WARN-1, 2026-07-10). Any other error reports + rethrows.
                const code = (rpcErr as { code?: string }).code ?? '';
                if (code === '42883' || code === 'PGRST202') {
                    console.warn('social_clippings: fn_restaurant_saves_visible absent — returning empty rail');
                    return json({ data: { rows: [] } });
                }
                reportError(rpcErr, { fn: 'restaurant-history', action: 'social_clippings' });
                throw rpcErr;
            }

            // Tier precedence mirrors 155's enum: self > tablemate > following > stranger.
            const TIER_RANK: Record<string, number> = { self: 0, tablemate: 1, following: 2, stranger: 3 };
            const isEligible = (src: any): boolean => {
                const t = src?.type;
                if (t === 'tiktok' || t === 'video') return true;
                if (t === 'web') {
                    // Exact-hostname predicate (TICKET-189) — synced with the
                    // SQL copy fn_is_instagram_url; substring matching banned.
                    const u = typeof src?.url === 'string' ? src.url : '';
                    return isInstagramUrl(u);
                }
                return false;
            };

            type Elig = { raw: any; src: any; rank: number; url: string | null; key: string | null };
            const eligible: Elig[] = [];
            for (const row of (saverRows ?? []) as any[]) {
                const src = row.source;
                if (!isEligible(src)) continue;
                const url = typeof src?.url === 'string' ? src.url : null;
                eligible.push({
                    raw: row,
                    src,
                    rank: TIER_RANK[row.relationship as string] ?? 3,
                    url,
                    // video-type (and any url-less row) has no key → its own card,
                    // never deduped, never a photo.
                    key: url ? await contentKey(url) : null,
                });
            }

            // Dedupe url-bearing rows by content key: winner = lowest tier rank,
            // tiebreak newest; losers fold into also_count. Keyless (video) rows
            // pass through untouched.
            const byKey = new Map<string, { winner: Elig; count: number }>();
            const keyless: Elig[] = [];
            for (const e of eligible) {
                if (!e.key) { keyless.push(e); continue; }
                const g = byKey.get(e.key);
                if (!g) {
                    byKey.set(e.key, { winner: e, count: 1 });
                } else {
                    g.count += 1;
                    const cur = g.winner;
                    const better =
                        e.rank < cur.rank ||
                        (e.rank === cur.rank && e.raw.created_at > cur.raw.created_at);
                    if (better) g.winner = e;
                }
            }

            const buildCard = (e: Elig, alsoCount: number) => ({
                saver: {
                    user_id: e.raw.saver_id as string,
                    display_name: (e.raw.display_name as string | null) ?? 'Someone',
                    avatar_url: (e.raw.avatar_url as string | null) ?? null,
                },
                relationship: e.raw.relationship as string,
                // Return ONLY {type, url, author_handle} — never thumbnail_url (a
                // rotting provider CDN link; AC "never hotlink"). The durable
                // thumb_url is joined from clip_thumbs below.
                source: {
                    type: (e.src?.type as string | null) ?? null,
                    url: e.url,
                    author_handle: typeof e.src?.author_handle === 'string' ? e.src.author_handle : null,
                },
                also_count: alsoCount,
                created_at: e.raw.created_at as string,
                _key: e.key,
                _rank: e.rank,
            });

            const cards = [
                ...[...byKey.values()].map((g) => buildCard(g.winner, g.count - 1)),
                ...keyless.map((e) => buildCard(e, 0)),
            ];

            // self → circle → strangers; within a tier, most-recent first.
            cards.sort((a, b) =>
                a._rank - b._rank ||
                (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));

            // Read every candidate key before the cap so confirmed-dead clips
            // can be removed and later live candidates can backfill the rail.
            const wantKeys = [...new Set(cards.map((c) => c._key).filter((k): k is string => !!k))];
            const thumbByKey = new Map<string, string>();
            const goneKeys = new Set<string>();
            if (wantKeys.length > 0) {
                const { data: thumbRows, error: thumbErr } = await supabase
                    .from('clip_thumbs')
                    .select('content_key, storage_path, status')
                    .in('content_key', wantKeys)
                    .in('status', ['cached', 'gone']);
                if (thumbErr) throw thumbErr;
                for (const t of (thumbRows ?? []) as Array<{
                    content_key: string;
                    storage_path: string | null;
                    status: 'cached' | 'gone';
                }>) {
                    if (t.status === 'gone') goneKeys.add(t.content_key);
                    else if (t.storage_path) thumbByKey.set(t.content_key, t.storage_path);
                }
            }

            // Missing thumb rows remain eligible; only an explicit gone marker
            // excludes a URL-bearing card. Keyless video cards always pass.
            const capped = cards
                .filter((c) => !c._key || !goneKeys.has(c._key))
                .slice(0, 12);

            const rows = capped.map((c) => {
                const storagePath = c._key ? thumbByKey.get(c._key) ?? null : null;
                return {
                    saver: c.saver,
                    relationship: c.relationship,
                    source: c.source,
                    thumb_url: storagePath
                        ? `${supabaseUrl ?? ''}/storage/v1/object/public/clip-thumbs/${storagePath}`
                        : null,
                    also_count: c.also_count,
                    created_at: c.created_at,
                };
            });

            return json({ data: { rows } });
        }

        // ── Featured in lists ────────────────────────────────────────────────
        // Body-POST action: MUST remain above the global restaurantId guard.
        // The RPC is service-role-only; p_viewer is the JWT-validated caller.
        if (action === 'featured_lists') {
            const body = await req.json().catch(() => ({}));
            const rid = (body?.restaurant_id ?? restaurantId) as string | null;
            if (!rid) return fail('restaurant_id is required');

            const resolvedId = await resolveRestaurantLookupId(supabase, rid);
            if (!resolvedId) return fail('restaurant not found', 404);

            const { data: featuredRows, error: rpcErr } = await supabase.rpc(
                'fn_restaurant_featured_lists',
                {
                    p_viewer: user.id,
                    p_restaurant_id: resolvedId,
                    p_limit: 3,
                },
            );
            if (rpcErr) {
                const code = (rpcErr as { code?: string }).code ?? '';
                if (code === '42883' || code === 'PGRST202') {
                    console.warn('featured_lists: fn_restaurant_featured_lists absent — returning empty band');
                    return json({ data: { rows: [], total: 0 } });
                }
                reportError(rpcErr, { fn: 'restaurant-history', action: 'featured_lists' });
                throw rpcErr;
            }

            const rawRows = (featuredRows ?? []) as any[];
            const rows = rawRows.map((row) => ({
                id: row.id as string,
                title: row.title as string,
                emoji: (row.emoji as string | null) ?? null,
                entry_count: Number(row.entry_count ?? 0),
                owner_display_name: (row.owner_display_name as string | null) ?? null,
                owner_username: (row.owner_username as string | null) ?? null,
            }));
            const total = rawRows.length > 0
                ? Number(rawRows[0].total_count ?? 0)
                : 0;

            return json({ data: { rows, total } });
        }

        // ── Map pin peek-card enrichment (TICKET-190) ────────────────────────
        // Body-POST action: MUST remain above the global restaurantId guard.
        // Every media URL is authorized for this viewer + exact layer context
        // before it enters the response; the client only walks this safe list.
        if (action === 'peek_card') {
            const body = await req.json().catch(() => ({}));
            const rid = (body?.restaurant_id ?? restaurantId) as string | null;
            if (!rid) return fail('restaurant_id is required');
            if (!isPeekCardContext(body?.context)) return fail('valid context is required');

            const resolvedId = await resolveRestaurantLookupId(supabase, rid);
            if (!resolvedId) return fail('restaurant not found', 404);

            const data = await loadPeekCard(supabase, {
                viewerId: user.id,
                restaurantId: resolvedId,
                context: body.context,
                supabaseUrl: supabaseUrl ?? '',
            });
            return json({ data });
        }


        if (!restaurantId) return fail('restaurant_id is required', 400);
        // All remaining read paths accept a durable deep link. A link may point
        // at a tombstone forever, so normalize it once before any authorization,
        // hydration, reservation, or aggregate lookup.
        restaurantId = await resolveRestaurantLookupId(supabase, restaurantId);
        if (!restaurantId) return fail('restaurant not found', 404);

        // ── Table-scoped history ──────────────────────────────────────────
        if (action === 'table_history') {
            const tableId = url.searchParams.get('table_id');
            const excludeNightId = url.searchParams.get('exclude_night_id');

            if (!tableId) return fail('table_id is required for table_history', 400);

            const { data: membership, error: memberErr } = await supabase
                .from('table_members')
                .select('member_id')
                .eq('table_id', tableId)
                .eq('member_id', user.id)
                .maybeSingle();
            if (memberErr) throw memberErr;
            if (!membership) return fail('Not a member of this table', 403);

            // [TICKET-060 B4] Add visibility predicate: verified OR owned by caller.
            // Service-role bypasses RLS, so the filter must be explicit.
            // An unverified ghost not owned by this user must not be returned
            // even when its id is known (e.g. guessed from URL params).
            const { data: restaurant, error: restErr } = await supabase
                .from('restaurants')
                .select('id, name, address, city, country, photo_url')
                .eq('id', restaurantId)
                .or(`verification.eq.verified,created_by.eq.${user.id}`)
                .maybeSingle();
            if (restErr) throw restErr;

            // TICKET-044: include merged rounds (kind='merged', status=NULL) alongside
            // live rounds (kind='live', status='revealed').
            // Change: switch from .eq('status', 'revealed') to the kind-branched predicate.
            let roundsQuery = supabase
                .from('table_nights')
                .select(`
                    id,
                    kind,
                    status,
                    revealed_at,
                    created_at
                `)
                .eq('table_id', tableId)
                .eq('restaurant_id', restaurantId)
                .or('kind.eq.merged,status.eq.revealed');
            if (excludeNightId) roundsQuery = roundsQuery.neq('id', excludeNightId);

            const { data: rounds, error: roundsErr } = await roundsQuery;
            if (roundsErr) throw roundsErr;

            // TICKET-044: solo entries — also exclude entries now part of a merged round in this table.
            const { data: soloEntries, error: entriesErr } = await supabase
                .from('entries')
                .select(`
                    id,
                    rating,
                    visited_at,
                    created_at,
                    user_id
                `)
                .eq('table_id', tableId)
                .eq('restaurant_id', restaurantId)
                .is('table_night_id', null)
                .not('rating', 'is', null)
                .order('visited_at', { ascending: false });
            if (entriesErr) throw entriesErr;

            // Filter out solo entries that are now bound to a merged round in this table
            const entryIds = (soloEntries ?? []).map((e: any) => e.id as string);
            let mergedEntryIds = new Set<string>();
            if (entryIds.length > 0) {
                const { data: boundEntries } = await supabase
                    .from('round_entries')
                    .select('entry_id')
                    .eq('table_id', tableId)
                    .in('entry_id', entryIds);
                mergedEntryIds = new Set(
                    (boundEntries ?? []).map((b: any) => b.entry_id as string)
                );
            }

            const visits: Visit[] = [];

            // TICKET-044: use projectRound for both live and merged rounds.
            for (const r of rounds ?? []) {
                const roundKind: 'live' | 'merged' = r.kind === 'merged' ? 'merged' : 'live';
                const { participants, average_rating } = await projectRound(r.id, roundKind, supabase);
                const names = participants.map((p) => p.display_name).filter(Boolean) as string[];
                visits.push({
                    kind: 'round',
                    id: r.id,
                    table_night_id: r.id,
                    rating: average_rating,
                    date: r.revealed_at ?? r.created_at,
                    user_display_names: names,
                });
            }

            for (const e of soloEntries ?? []) {
                // Skip entries now part of a merged round
                if (mergedEntryIds.has(e.id)) continue;
                const name = (e as any).profiles?.display_name as string | undefined;
                visits.push({
                    kind: 'solo',
                    id: e.id,
                    entry_id: e.id,
                    rating: e.rating,
                    date: (e.visited_at ?? e.created_at) as string,
                    user_display_names: name ? [name] : [],
                });
            }

            visits.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

            const ratedVisits = visits.filter((v) => v.rating != null);
            const tableAverage =
                ratedVisits.length > 0
                    ? ratedVisits.reduce((sum, v) => sum + (v.rating as number), 0) /
                      ratedVisits.length
                    : null;

            return json({
                data: {
                    restaurant,
                    visits,
                    visit_count: visits.length,
                    table_average: tableAverage,
                    last_visit: visits[0] ?? null,
                },
            });
        }

        // ── User-scoped history (cross-table) ──────────────────────────────
        if (action === 'user_history') {
            const excludeEntryId = url.searchParams.get('exclude_entry_id');

            let q = supabase
                .from('entries')
                .select(`
                    id,
                    rating,
                    visited_at,
                    created_at,
                    table_night_id,
                    table_id
                `)
                .eq('user_id', user.id)
                .eq('restaurant_id', restaurantId)
                .not('rating', 'is', null)
                .order('visited_at', { ascending: false });
            if (excludeEntryId) q = q.neq('id', excludeEntryId);

            const { data: entries, error } = await q;
            if (error) throw error;

            const visits: Visit[] = (entries ?? []).map((e: any) => ({
                kind: e.table_night_id ? 'round' : 'solo',
                id: e.id,
                entry_id: e.id,
                table_night_id: e.table_night_id ?? undefined,
                rating: e.rating,
                date: (e.visited_at ?? e.created_at) as string,
                user_display_names: [],
            }));

            const ratedVisits = visits.filter((v) => v.rating != null);
            const userAverage =
                ratedVisits.length > 0
                    ? ratedVisits.reduce((sum, v) => sum + (v.rating as number), 0) /
                      ratedVisits.length
                    : null;

            return json({
                data: {
                    visits,
                    visit_count: visits.length,
                    user_average: userAverage,
                    last_visit: visits[0] ?? null,
                },
            });
        }

        // ── Reserve link (TICKET-149) ─────────────────────────────────────
        // Resolve the venue's direct booking-page URL (OpenTable/Resy/
        // SevenRooms/…) by scanning its own website — Google Places exposes
        // no reservation field. Result is cached on the row: a found URL is
        // sticky, a null is re-checked after 30 days. The client fires this
        // only when the page payload shows the row unchecked or stale.
        if (action === 'reserve_link') {
            if (!restaurantId) return fail('restaurant_id is required');

            const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            // Same visibility predicate as action=page (TICKET-060 B4):
            // service-role bypasses RLS, so filter explicitly.
            let query = supabase
                .from('restaurants')
                .select('id, website, reserve_url, reserve_url_checked_at')
                .or(`verification.eq.verified,created_by.eq.${user.id}`);
            query = uuidPattern.test(restaurantId)
                ? query.eq('id', restaurantId)
                : query.eq('external_id', restaurantId);
            const { data: row, error: rowErr } = await query.maybeSingle();
            if (rowErr) throw rowErr;
            if (!row) return json({ data: { reserve_url: null } });
            if (row.reserve_url) return json({ data: { reserve_url: row.reserve_url } });

            const RECHECK_MS = 30 * 24 * 60 * 60 * 1000;
            const checkedMs = row.reserve_url_checked_at
                ? Date.parse(row.reserve_url_checked_at)
                : NaN;
            if (!Number.isNaN(checkedMs) && Date.now() - checkedMs < RECHECK_MS) {
                return json({ data: { reserve_url: null } });
            }

            const resolved = await resolveReserveUrl(row.website ?? null);
            const { error: updateErr } = await supabase
                .from('restaurants')
                .update({
                    reserve_url: resolved,
                    reserve_url_checked_at: new Date().toISOString(),
                })
                .eq('id', row.id);
            if (updateErr) throw updateErr;

            return json({ data: { reserve_url: resolved } });
        }

        // ── Full restaurant page data (aggregated) — v3 ───────────────────────────
        if (action === 'page') {
            const tableIdParam = url.searchParams.get('table_id');

            // Resolve restaurant — UUID takes precedence; fall back to external_id
            const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            const isUuid = uuidPattern.test(restaurantId);

            // [TICKET-060 B4] Add visibility predicate to every by-id/external_id lookup.
            // Service-role bypasses RLS — the filter must be explicit here.
            // Predicate: verification='verified' OR created_by = authenticated caller.
            // This prevents a known unverified-ghost id from returning to non-owners.
            let restaurantRow: RestaurantPageData['restaurant'] = null;
            if (isUuid) {
                const { data, error } = await supabase
                    .from('restaurants')
                    .select('id, name, address, city, country, cuisine, price_level, photo_url, google_rating, google_rating_count, external_id, lat, lng, photo_source, places_photo_attribution_html, phone, website, google_maps_uri, hours, places_synced_at, place_types, reserve_url, reserve_url_checked_at')
                    .eq('id', restaurantId)
                    .or(`verification.eq.verified,created_by.eq.${user.id}`)
                    .maybeSingle();
                if (error) throw error;
                restaurantRow = data ?? null;
            } else {
                const { data, error } = await supabase
                    .from('restaurants')
                    .select('id, name, address, city, country, cuisine, price_level, photo_url, google_rating, google_rating_count, external_id, lat, lng, photo_source, places_photo_attribution_html, phone, website, google_maps_uri, hours, places_synced_at, place_types, reserve_url, reserve_url_checked_at')
                    .eq('external_id', restaurantId)
                    .or(`verification.eq.verified,created_by.eq.${user.id}`)
                    .maybeSingle();
                if (error) throw error;
                restaurantRow = data ?? null;
            }

            // Empty page for ghost restaurants not yet in DB
            const emptyDistributions = { you: [0,0,0,0,0], your_table: null, napkin: [0,0,0,0,0] };
            const emptyHalfDistributions = { you: new Array(10).fill(0), your_table: null, napkin: new Array(10).fill(0) };
            const emptyPhotos = { from_your_table: [], from_others: [] };
            const emptyPlaceDetails: PlaceDetails = { hours_today: null, open_now: null, hours_week: null, website: null, phone: null, menu_url: null, lat: null, lng: null };

            if (!restaurantRow) {
                return json({
                    data: {
                        restaurant: null,
                        personal: { average: null, visit_count: 0 },
                        table_chip: null,
                        whos_been: [],
                        visits: [],
                        visit_count: 0,
                        public_reviews: [],
                        public_reviews_total: 0,
                        distributions: emptyDistributions,
                        distributions_half: emptyHalfDistributions,
                        napkin_aggregate: { average: null, count: 0 },
                        photos: emptyPhotos,
                        place_details: emptyPlaceDetails,
                        tables_count_with_logs: 0,
                        first_logged_at_by_your_table: null,
                        professional_critics: [],
                    } as RestaurantPageData,
                });
            }

            const resolvedRestaurantId = restaurantRow.id;

            // Best-effort place_details from cached DB columns
            const placeDetails: PlaceDetails = {
                hours_today: null,
                open_now: null,
                hours_week: null,
                website: null,
                phone: null,
                menu_url: null,
                lat: (restaurantRow as any).lat ?? null,
                lng: (restaurantRow as any).lng ?? null,
            };

            // Find all table_ids the user is a member of
            const { data: memberships, error: memberErr } = await supabase
                .from('table_members')
                .select('table_id, tables(id, name)')
                .eq('member_id', user.id);
            if (memberErr) throw memberErr;

            const memberTableIds = (memberships ?? []).map((m: any) => m.table_id as string);

            // ── Personal average (viewer's own entries across all Tables) ──
            let personalAverage: number | null = null;
            let personalVisitCount = 0;
            let personalRatings: number[] = [];
            let personalLastVisit: { date: string; rating: number | null } | null = null;

            {
                const { data: personalEntries, error: personalErr } = await supabase
                    .from('entries')
                    .select('id, rating, visited_at, created_at')
                    .eq('user_id', user.id)
                    .eq('restaurant_id', resolvedRestaurantId)
                    .not('rating', 'is', null)
                    .order('visited_at', { ascending: false });
                if (personalErr) throw personalErr;

                const rated = (personalEntries ?? []).filter((e: any) => e.rating != null);
                personalVisitCount = rated.length;
                if (rated.length > 0) {
                    personalRatings = rated.map((e: any) => e.rating as number);
                    personalAverage = personalRatings.reduce((a, b) => a + b, 0) / personalRatings.length;
                    personalLastVisit = {
                        date: (rated[0].visited_at ?? rated[0].created_at) as string,
                        rating: rated[0].rating ?? null,
                    };
                }
            }

            // ── Table chip — most recent visit's Table, biased by tableId param ──
            let tableChip: RestaurantPageData['table_chip'] = null;
            let tableRatings: number[] = [];
            let tableVisitorIds: Set<string> = new Set();

            if (memberTableIds.length > 0) {
                let candidateTableIds = memberTableIds;
                if (tableIdParam && memberTableIds.includes(tableIdParam)) {
                    candidateTableIds = [tableIdParam];
                }

                // TICKET-043: disambiguate FK (see search-action note above for context).
                const { data: tableEntries, error: tableEntriesErr } = await supabase
                    .from('entries')
                    .select('id, rating, table_id, user_id, visited_at, created_at, tables!entries_table_id_fkey(id, name)')
                    .in('table_id', candidateTableIds)
                    .eq('restaurant_id', resolvedRestaurantId)
                    .not('rating', 'is', null)
                    .order('visited_at', { ascending: false });
                if (tableEntriesErr) throw tableEntriesErr;

                if ((tableEntries ?? []).length > 0) {
                    const mostRecentEntry = (tableEntries as any[])[0];
                    const chipTableId = mostRecentEntry.table_id as string;
                    const chipTableName = mostRecentEntry.tables?.name as string ?? 'Table';

                    const chipEntries = (tableEntries as any[]).filter(e => e.table_id === chipTableId);
                    tableRatings = chipEntries.map((e: any) => e.rating as number);
                    chipEntries.forEach((e: any) => tableVisitorIds.add(e.user_id as string));
                    const chipAvg = tableRatings.reduce((sum, r) => sum + r, 0) / tableRatings.length;

                    tableChip = {
                        table_id: chipTableId,
                        table_name: chipTableName,
                        average: chipAvg,
                        visit_count: chipEntries.length,
                    };
                }
            }

            // ── Shared-Table members ──
            let sharedUserIds: string[] = [];
            if (memberTableIds.length > 0) {
                const { data: sharedMembers, error: sharedErr } = await supabase
                    .from('table_members')
                    .select('member_id')
                    .in('table_id', memberTableIds)
                    .neq('member_id', user.id);
                if (sharedErr) throw sharedErr;
                sharedUserIds = [...new Set((sharedMembers ?? []).map((m: any) => m.member_id as string))];
            }

            // ── Who's been ──
            let whosBeen: WhosBeenEntry[] = [];
            if (sharedUserIds.length > 0) {
                // TICKET-034: exclude private entries from "who's been" — a tablemate's
                // feed-only private visit must not surface on a restaurant page they
                // didn't explicitly share to a shared Table.
                const { data: sharedEntries, error: sharedEntriesErr } = await supabase
                    .from('entries')
                    .select('user_id, rating')
                    .in('user_id', sharedUserIds)
                    .eq('restaurant_id', resolvedRestaurantId)
                    .neq('visibility', 'private')
                    .not('rating', 'is', null);
                if (sharedEntriesErr) throw sharedEntriesErr;

                const sharedProfiles = await fetchProfiles(supabase, sharedUserIds);

                const byUser = new Map<string, { display_name: string; avatar_url: string | null; username: string | null; ratings: number[] }>();
                for (const e of (sharedEntries ?? []) as any[]) {
                    const uid = e.user_id as string;
                    const prof = sharedProfiles.get(uid);
                    if (!byUser.has(uid)) {
                        byUser.set(uid, {
                            display_name: prof?.display_name ?? 'Member',
                            avatar_url: prof?.avatar_url ?? null,
                            username: prof?.username ?? null,
                            ratings: [],
                        });
                    }
                    if (e.rating != null) {
                        byUser.get(uid)!.ratings.push(e.rating as number);
                    }
                }

                whosBeen = Array.from(byUser.entries()).map(([uid, info]) => ({
                    user_id: uid,
                    display_name: info.display_name,
                    avatar_url: info.avatar_url,
                    personal_average: info.ratings.reduce((a, b) => a + b, 0) / info.ratings.length,
                    visit_count: info.ratings.length,
                }));
            }

            // ── Visits feed — viewer's own entries (always) + shared users' entries (when has tables) ──
            // Individual-first doctrine: a solo user with no tables must still see their own Visits.
            // The guard here is only on the tablemate/rounds branches, not on the self-entries fetch.
            const allVisibleUserIds = [user.id, ...sharedUserIds];
            const visitsRaw: Visit[] = [];

            {
                // Always fetch the viewer's own entries — regardless of table membership.
                // For users with tables, also fetch tablemates' entries in the same query.
                // TICKET-034: exclude private entries from cross-user results, but preserve
                // the viewer's own private entries (they want to see their own visit history
                // regardless of privacy setting). Use an OR filter: self OR non-private.
                const { data: feedEntries, error: feedEntriesErr } = await supabase
                    .from('entries')
                    .select('id, user_id, rating, visited_at, created_at, content, table_night_id, visibility')
                    .in('user_id', allVisibleUserIds)
                    .eq('restaurant_id', resolvedRestaurantId)
                    .is('table_night_id', null)
                    .not('rating', 'is', null)
                    .or(`user_id.eq.${user.id},visibility.neq.private`)
                    .order('visited_at', { ascending: false });
                if (feedEntriesErr) throw feedEntriesErr;

                const feedProfiles = await fetchProfiles(supabase, (feedEntries ?? []).map((e: any) => e.user_id as string));

                for (const e of (feedEntries ?? []) as any[]) {
                    const prof = feedProfiles.get(e.user_id);
                    visitsRaw.push({
                        kind: 'solo',
                        id: e.id,
                        entry_id: e.id,
                        user_id: e.user_id,
                        avatar_url: prof?.avatar_url ?? null,
                        rating: e.rating,
                        date: e.visited_at ?? e.created_at,
                        user_display_names: prof?.display_name ? [prof.display_name] : [],
                        note: e.content ?? null,
                        is_self: e.user_id === user.id,
                        is_tablemate: sharedUserIds.includes(e.user_id),
                    });
                }
            }

            // TICKET-044: Rounds are table-scoped — only fetch when the user has table membership.
            // Change: include merged rounds (kind='merged') alongside live revealed rounds.
            if (memberTableIds.length > 0) {
                const { data: feedNights, error: feedNightsErr } = await supabase
                    .from('table_nights')
                    .select(`
                        id,
                        kind,
                        host_user_id,
                        revealed_at,
                        created_at
                    `)
                    .in('table_id', memberTableIds)
                    .eq('restaurant_id', resolvedRestaurantId)
                    .or('kind.eq.merged,status.eq.revealed');
                if (feedNightsErr) throw feedNightsErr;

                // TICKET-044: use projectRound helper for both live and merged rounds.
                for (const night of (feedNights ?? []) as any[]) {
                    const roundKind: 'live' | 'merged' = night.kind === 'merged' ? 'merged' : 'live';
                    const { participants, average_rating } = await projectRound(night.id, roundKind, supabase);

                    const visibleParticipants = participants.filter((p) =>
                        allVisibleUserIds.includes(p.user_id)
                    );
                    if (visibleParticipants.length === 0) continue;

                    const names = participants
                        .map((p) => p.display_name)
                        .filter(Boolean) as string[];

                    visitsRaw.push({
                        kind: 'round',
                        id: night.id,
                        table_night_id: night.id,
                        user_id: night.host_user_id,
                        avatar_url: null,
                        rating: average_rating,
                        date: night.revealed_at ?? night.created_at,
                        user_display_names: names,
                        note: null,
                        is_self: night.host_user_id === user.id,
                        is_tablemate: sharedUserIds.includes(night.host_user_id),
                    });
                }
            }

            visitsRaw.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

            // ── Public reviews ──
            const { data: publicReviewRows, error: publicReviewsErr } = await supabase
                .rpc('get_public_reviews', {
                    p_restaurant_id: resolvedRestaurantId,
                    p_limit: 20,
                });
            if (publicReviewsErr) throw publicReviewsErr;

            const publicReviewsTotal: number = publicReviewRows?.length > 0
                ? Number((publicReviewRows[0] as any).total_count ?? 0)
                : 0;

            // ── Followee set — which public-review authors the viewer follows ──
            // Letterboxd-style "from people you follow": a follow is a directional
            // row in `follows` (follower_id → following_id). Service-role bypasses
            // RLS, so the explicit follower_id filter is load-bearing; the
            // .in(...) scopes the read to the handful of authors on this page.
            const followedSet = new Set<string>();
            {
                const reviewerIds = [...new Set<string>(
                    (publicReviewRows ?? [])
                        .map((r: any) => r.user_id as string)
                        .filter((uid: string) => !!uid && uid !== user.id),
                )];
                if (reviewerIds.length > 0) {
                    const { data: followRows, error: followErr } = await supabase
                        .from('follows')
                        .select('following_id')
                        .eq('follower_id', user.id)
                        .in('following_id', reviewerIds);
                    // Non-fatal (like calibration below): a failed read just means no
                    // followee tier this load, never a 500 for the whole page.
                    if (followErr) console.error('restaurant-history follows error:', followErr);
                    for (const fr of followRows ?? []) {
                        followedSet.add((fr as { following_id: string }).following_id);
                    }
                }
            }

            // ── Calibration batch for public review authors ──
            // Filter out the viewer and Tablemates — calibration is Ring 2 only.
            // The helper defends against Tablemates internally, but we pre-filter
            // here for performance (avoids passing known Tablemates to the helper).
            const allSharedMemberIds = new Set<string>(sharedUserIds);
            const publicReviewAuthorIds: string[] = [...new Set<string>(
                (publicReviewRows ?? [])
                    .map((row: any) => row.user_id as string)
                    .filter((uid: string) => uid !== user.id && !allSharedMemberIds.has(uid))
            )];

            let calMap = new Map<string, Calibration | null>();
            if (publicReviewAuthorIds.length > 0) {
                try {
                    calMap = await computeCalibrations(supabase, user.id, publicReviewAuthorIds);
                } catch (calErr) {
                    // Non-fatal: calibration failure should not degrade the page
                    console.error('restaurant-history calibration error:', calErr);
                }
            }

            const publicReviews: PublicReviewCard[] = ((publicReviewRows ?? []) as any[]).map((row: any) => ({
                entry_id: row.entry_id,
                user_id: row.user_id,
                display_name: row.display_name ?? 'User',
                username: row.username ?? null,
                avatar_url: row.avatar_url ?? null,
                rating: row.rating,
                note_excerpt: row.content ?? '',
                photo_url: row.photo_url ?? null,
                created_at: row.created_at,
                public_reaction_count: row.public_reaction_count ?? 0,
                public_reply_count: row.public_reply_count ?? 0,
                // calibration is null for viewer's own reviews and Tablemates (Ring 1)
                calibration: (row.user_id === user.id || allSharedMemberIds.has(row.user_id))
                    ? null
                    : (calMap.get(row.user_id) ?? null),
                // Letterboxd "from people you follow" — surfaced as its own tier.
                is_followee: followedSet.has(row.user_id),
            }));

            // ── v3: Distributions ──
            // "you" distribution
            const youDist = buildDistribution(personalRatings);

            // "your_table" distribution — all entries from the chip table
            const yourTableDist: number[] | null = tableChip ? buildDistribution(tableRatings) : null;

            // "napkin" distribution — non-private entries at this restaurant.
            // TICKET-034: private logs must never contribute to the aggregate number
            // (doctrine: "logs default private; surface on public profile only when …").
            // We intentionally include visibility='table' and 'friends' entries because
            // those represent signals shared within some circle — not fully private.
            // The stricter is_entry_publicly_eligible filter (which also gates on profile
            // public + content length) is out of scope for this ticket; see TICKET-034
            // build log for the documented looser-than-public-eligible behavior.
            let napkinRatings: number[] = [];
            {
                const { data: napkinEntries, error: napkinErr } = await supabase
                    .from('entries')
                    .select('rating')
                    .eq('restaurant_id', resolvedRestaurantId)
                    .neq('visibility', 'private')
                    .not('rating', 'is', null);
                if (!napkinErr) {
                    napkinRatings = (napkinEntries ?? []).map((e: any) => e.rating as number);
                }
            }
            const napkinDist = buildDistribution(napkinRatings);
            const napkinAverage = napkinRatings.length > 0
                ? napkinRatings.reduce((a, b) => a + b, 0) / napkinRatings.length
                : null;
            const napkinCount = napkinRatings.length;

            // ── v3: Photos ──
            let fromYourTable: PhotoItem[] = [];
            let fromOthers: PhotoItem[] = [];

            {
                // Fetch entry_photos filtered server-side by restaurant_id via the entries join.
                // The inner join ensures only photos whose entry is at this restaurant are returned,
                // so the subsequent limit(48) is applied after the restaurant filter — not before it.
                // ARCHITECT-REVIEW: adding restaurant_id directly to entry_photos would allow a
                // simpler indexed query; for now the inner join on entries is correct and sufficient.
                //
                // TICKET-034: also select visibility so we can post-filter private entries from
                // cross-user photo results. We preserve the viewer's own private photos (isSelf).
                const { data: entryPhotoRows, error: photoErr } = await supabase
                    .from('entry_photos')
                    .select('photo_url, entry_id, entries!inner(user_id, restaurant_id, table_id, visibility)')
                    .eq('entries.restaurant_id', resolvedRestaurantId)
                    .not('photo_url', 'is', null)
                    .limit(48);

                if (photoErr) {
                    console.error('restaurant-history photos error:', photoErr.message);
                }

                if (!photoErr && entryPhotoRows) {
                    // All rows are already filtered to this restaurant by the server-side join.
                    // TICKET-034: post-filter: exclude photos from private entries unless the viewer
                    // is the author. This preserves the viewer's own private visit photos while
                    // preventing a tablemate's feed-only private entry photos from leaking here.
                    const allPhotos = entryPhotoRows as any[];
                    const relevantPhotos = allPhotos.filter((p: any) => {
                        const entryUserId = p.entries?.user_id as string;
                        const visibility = p.entries?.visibility as string | null;
                        const isSelf = entryUserId === user.id;
                        // TICKET-173: NULL must fail CLOSED — `!== 'private'`
                        // alone let a NULL-visibility entry's photos through.
                        return isSelf || (visibility != null && visibility !== 'private');
                    });

                    // Collect all user IDs to fetch profiles
                    const photoUserIds = [...new Set(relevantPhotos.map((p: any) => p.entries?.user_id as string).filter(Boolean))];
                    const photoProfiles = await fetchProfiles(supabase, photoUserIds);

                    for (const photo of relevantPhotos) {
                        const userId = photo.entries?.user_id as string;
                        const entryTableId = photo.entries?.table_id as string | null;
                        const prof = photoProfiles.get(userId);
                        const photoUrl = photo.photo_url ?? null;
                        if (!photoUrl) continue;

                        const isSelf = userId === user.id;
                        const isTablemate = sharedUserIds.includes(userId);

                        const item: PhotoItem = {
                            url: photoUrl,
                            author_display_name: prof?.display_name ?? 'User',
                            author_handle: prof?.username ? `@${prof.username}` : '@user',
                            is_tablemate: isTablemate,
                            is_self: isSelf,
                            entry_id: photo.entry_id,
                        };

                        // Trust ring: the viewer's own photos always go to fromYourTable.
                        // A tablemate's photo only goes to fromYourTable when the source entry
                        // was actually shared to a table the viewer is also in (table_id IS NOT NULL
                        // AND that table_id is in the viewer's memberTableIds).
                        // Feed-only (table_id = null) entries from tablemates stay in fromOthers.
                        const isSharedToSharedTable =
                            entryTableId != null && memberTableIds.includes(entryTableId);

                        if (isSelf || isSharedToSharedTable) {
                            fromYourTable.push(item);
                        } else {
                            fromOthers.push(item);
                        }
                    }

                    // Sort: self first, then tablemates
                    fromYourTable.sort((a, b) => {
                        if (a.is_self && !b.is_self) return -1;
                        if (!a.is_self && b.is_self) return 1;
                        return 0;
                    });

                    // Cap at 24
                    fromYourTable = fromYourTable.slice(0, 24);
                    fromOthers = fromOthers.slice(0, 24);
                }
            }

            // ── v3: tables_count_with_logs + first_logged_at_by_your_table ──
            let tablesCountWithLogs = 0;
            let firstLoggedAtByYourTable: string | null = null;

            if (memberTableIds.length > 0) {
                // Count distinct tables that have entries at this restaurant
                const { data: loggedTables, error: loggedTablesErr } = await supabase
                    .from('entries')
                    .select('table_id, visited_at, created_at')
                    .in('table_id', memberTableIds)
                    .eq('restaurant_id', resolvedRestaurantId)
                    .not('table_id', 'is', null);
                if (!loggedTablesErr && loggedTables) {
                    const distinctTableIds = new Set((loggedTables as any[]).map((e: any) => e.table_id as string));
                    tablesCountWithLogs = distinctTableIds.size;

                    // Earliest entry date
                    const allDates = (loggedTables as any[]).map((e: any) => (e.visited_at ?? e.created_at) as string);
                    if (allDates.length > 0) {
                        firstLoggedAtByYourTable = allDates.sort()[0];
                    }
                }
            }

            // ── TICKET-026: Professional critic reviews ────────────────────────────
            let professionalCritics: ProfessionalCritic[] = [];
            {
                const { data: criticRows, error: criticErr } = await supabase
                    .from('professional_critic_reviews')
                    .select('id, publication, kind, score, score_out_of, author, published_date, excerpt, source_url, scrape_confidence')
                    .eq('restaurant_id', resolvedRestaurantId)
                    .eq('suppressed', false);

                if (criticErr) {
                    // Non-fatal: critic failure should not degrade the page
                    console.error('restaurant-history critics error:', criticErr.message);
                } else {
                    professionalCritics = ((criticRows ?? []) as any[])
                        // Filter out rows missing publication
                        .filter((r: any) => !!r.publication)
                        // Filter rows that have excerpt but no source_url (licensing defense)
                        .filter((r: any) => !(r.excerpt && !r.source_url))
                        .map((r: any): ProfessionalCritic => ({
                            id: r.id,
                            publication: r.publication,
                            kind: r.kind,
                            score: r.score ?? null,
                            score_out_of: r.score_out_of ?? null,
                            author: r.author ?? null,
                            published_date: r.published_date ?? null,
                            // Blank excerpt when scrape_confidence < 70
                            excerpt: (r.scrape_confidence != null && r.scrape_confidence < 70)
                                ? null
                                : (r.excerpt ?? null),
                            source_url: r.source_url ?? null,
                        }));
                }
            }

            // Napkin average and count for the signal strip
            // (napkinAverage and napkinCount computed above from all entries)

            return json({
                data: {
                    restaurant: restaurantRow,
                    personal: { average: personalAverage, visit_count: personalVisitCount, last_visit: personalLastVisit },
                    table_chip: tableChip
                        ? {
                            ...tableChip,
                            member_count: tableVisitorIds.size,
                        }
                        : null,
                    whos_been: whosBeen,
                    visits: visitsRaw,
                    visit_count: visitsRaw.length,
                    public_reviews: publicReviews,
                    public_reviews_total: publicReviewsTotal,
                    distributions: {
                        you: youDist,
                        your_table: yourTableDist,
                        napkin: napkinDist,
                    },
                    // TICKET-154: half-star truth. Legacy 5-bucket stays above
                    // for clients predating this field.
                    distributions_half: {
                        you: buildHalfDistribution(personalRatings),
                        your_table: tableChip ? buildHalfDistribution(tableRatings) : null,
                        napkin: buildHalfDistribution(napkinRatings),
                    },
                    napkin_aggregate: {
                        average: napkinAverage,
                        count: napkinCount,
                    },
                    photos: {
                        from_your_table: fromYourTable,
                        from_others: fromOthers,
                    },
                    place_details: placeDetails,
                    tables_count_with_logs: tablesCountWithLogs,
                    first_logged_at_by_your_table: firstLoggedAtByYourTable,
                    professional_critics: professionalCritics,
                } as RestaurantPageData,
            });
        }

        return fail('Unknown action', 400);
    } catch (err) {
        const msg = err instanceof Error ? err.message : JSON.stringify(err);
        console.error('restaurant-history error:', msg, err);
        reportError(err, { fn: 'restaurant-history' });
        return json(
            { error: 'Internal Server Error', details: msg },
            500,
        );
    }
});
