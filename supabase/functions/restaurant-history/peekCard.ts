import { isInstagramUrl } from '../_shared/socialHost.ts';
import { contentKey } from '../_shared/videoUrlKey.ts';

export type PeekCardLayer =
    | 'saved'
    | 'been'
    | 'network'
    | 'overlap'
    | 'gathered'
    | 'list';

export interface PeekCardContext {
    layer: PeekCardLayer;
    entry_id?: string;
    table_id?: string;
    list_id?: string;
}

export interface PeekCardMediaCandidate {
    kind: 'entry' | 'clip' | 'places';
    url: string;
    photo_source?: 'user' | 'table' | 'places';
    attribution?: string | null;
}

export interface PeekCardResponse {
    media: PeekCardMediaCandidate[];
    google_rating: number | null;
    google_rating_count: number | null;
    price_level: number | null;
    hours: { weekdayDescriptions: string[] } | null;
    visible_saves_count?: number;
    address_short: string | null;
    reserve_url: string | null;
}

export interface PeekCardClient {
    from: (table: string) => any;
    rpc: (
        name: string,
        args: Record<string, unknown>,
    ) => PromiseLike<{ data: any; error: any }>;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VISIBLE_SAVES_FLOOR = 3;
const TIER_RANK: Record<string, number> = {
    self: 0,
    tablemate: 1,
    following: 2,
    stranger: 3,
};

const LAYERS = new Set<PeekCardLayer>([
    'saved',
    'been',
    'network',
    'overlap',
    'gathered',
    'list',
]);

export function isPeekCardContext(value: unknown): value is PeekCardContext {
    if (!value || typeof value !== 'object') return false;
    const context = value as Record<string, unknown>;
    if (
        typeof context.layer !== 'string' ||
        !LAYERS.has(context.layer as PeekCardLayer)
    ) {
        return false;
    }
    for (const key of ['entry_id', 'table_id', 'list_id'] as const) {
        const field = context[key];
        if (field !== undefined && typeof field !== 'string') return false;
    }
    return true;
}

function finiteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizedHours(
    value: unknown,
): { weekdayDescriptions: string[] } | null {
    if (!value || typeof value !== 'object') return null;
    const descriptions = (value as { weekdayDescriptions?: unknown }).weekdayDescriptions;
    if (
        !Array.isArray(descriptions) ||
        !descriptions.every((line) => typeof line === 'string')
    ) {
        return null;
    }
    return { weekdayDescriptions: descriptions };
}

export function shortAddress(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const firstLine = value.split(',')[0]?.trim() ?? '';
    return firstLine || null;
}

function decodeEntities(value: string): string {
    return value
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&apos;/gi, "'")
        .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)));
}

/** Stored Places attribution is constrained server-authored HTML. The card only
 * needs its author label; links and the full HTML remain on the restaurant page. */
export function placesAttributionAuthor(value: unknown): string | null {
    if (typeof value !== 'string' || value.length > 1024) return null;
    const stripped = value.replace(/<[^>]*>/g, ' ');
    const label = decodeEntities(stripped).replace(/\s+/g, ' ').trim();
    return label || null;
}

function emptyResponse(): PeekCardResponse {
    return {
        media: [],
        google_rating: null,
        google_rating_count: null,
        price_level: null,
        hours: null,
        address_short: null,
        reserve_url: null,
    };
}

async function firstEntryPhoto(
    client: PeekCardClient,
    entryId: string,
): Promise<string | null> {
    const { data, error } = await client
        .from('entry_photos')
        .select('photo_url, entry_id, sort_order')
        .eq('entry_id', entryId)
        .not('photo_url', 'is', null)
        .order('sort_order', { ascending: true })
        .limit(1)
        .maybeSingle();
    if (error) return null;
    return typeof data?.photo_url === 'string' && data.photo_url.trim() ? data.photo_url : null;
}

async function ownEntryPhoto(
    client: PeekCardClient,
    viewerId: string,
    restaurantId: string,
): Promise<string | null> {
    const { data, error } = await client
        .from('entry_photos')
        .select(
            'photo_url, entry_id, created_at, entries!inner(user_id, restaurant_id)',
        )
        .eq('entries.user_id', viewerId)
        .eq('entries.restaurant_id', restaurantId)
        .not('photo_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) return null;
    return typeof data?.photo_url === 'string' && data.photo_url.trim() ? data.photo_url : null;
}

/** Mirrors fn_network_map_pins' exact eligibility predicate against one client-
 * supplied entry id. Every error/null aborts this rung; photos are read last. */
async function authorizedNetworkPhoto(
    client: PeekCardClient,
    viewerId: string,
    restaurantId: string,
    entryId: string | undefined,
): Promise<string | null> {
    if (!entryId) return null;

    // 1. Exact entry, restaurant, and fail-closed visibility check.
    const { data: entry, error: entryError } = await client
        .from('entries')
        .select('id, restaurant_id, user_id, visibility')
        .eq('id', entryId)
        .maybeSingle();
    if (
        entryError ||
        !entry ||
        entry.restaurant_id !== restaurantId ||
        entry.visibility == null ||
        entry.visibility === 'private' ||
        typeof entry.user_id !== 'string'
    ) {
        return null;
    }

    const authorId = entry.user_id as string;

    // 2. Viewer follows this exact author (`following_id`, never `followee`).
    const { data: follow, error: followError } = await client
        .from('follows')
        .select('following_id')
        .eq('follower_id', viewerId)
        .eq('following_id', authorId)
        .maybeSingle();
    if (followError || !follow) return null;

    // 3. Standalone account-public gate; strict true only (error/null fail closed).
    const { data: publicAccount, error: publicError } = await client.rpc(
        'fn_public_account',
        { p_user_id: authorId },
    );
    if (publicError || publicAccount !== true) return null;

    // 4. A block in either direction aborts before any photo read.
    const { data: block, error: blockError } = await client
        .from('blocked_users')
        .select('blocker_id')
        .or(
            `and(blocker_id.eq.${viewerId},blocked_id.eq.${authorId}),` +
                `and(blocker_id.eq.${authorId},blocked_id.eq.${viewerId})`,
        )
        .limit(1)
        .maybeSingle();
    if (blockError || block) return null;

    // 5. Only now may the exact entry's photo URL be read.
    return firstEntryPhoto(client, entryId);
}

async function authorizedGatheredPhoto(
    client: PeekCardClient,
    viewerId: string,
    restaurantId: string,
    tableId: string | undefined,
): Promise<string | null> {
    if (!tableId) return null;

    // Membership must pass before any share, entry, or photo read.
    const { data: membership, error: membershipError } = await client
        .from('table_members')
        .select('member_id')
        .eq('table_id', tableId)
        .eq('member_id', viewerId)
        .maybeSingle();
    if (membershipError || !membership) return null;

    // Multi-table shares live in entry_tables. Read the requested table only.
    const { data: shares, error: sharesError } = await client
        .from('entry_tables')
        .select('entry_id, posted_at')
        .eq('table_id', tableId)
        .order('posted_at', { ascending: false });
    if (sharesError) return null;
    const sharedEntryIds = [
        ...new Set(
            (shares ?? [])
                .map((row: any) => row.entry_id)
                .filter((id: unknown): id is string => typeof id === 'string'),
        ),
    ];
    if (sharedEntryIds.length === 0) return null;

    // Doctrine: the Table share is itself the visibility grant, so there is deliberately no entry-visibility filter here.
    // A table spans many restaurants; constrain the shared entries to this one.
    const { data: entries, error: entriesError } = await client
        .from('entries')
        .select('id')
        .in('id', sharedEntryIds)
        .eq('restaurant_id', restaurantId);
    if (entriesError) return null;
    const eligibleEntryIds = [
        ...new Set(
            (entries ?? [])
                .map((row: any) => row.id)
                .filter((id: unknown): id is string => typeof id === 'string'),
        ),
    ];
    if (eligibleEntryIds.length === 0) return null;

    const { data: photo, error: photoError } = await client
        .from('entry_photos')
        .select('photo_url, entry_id, created_at')
        .in('entry_id', eligibleEntryIds)
        .not('photo_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (photoError) return null;
    return typeof photo?.photo_url === 'string' && photo.photo_url.trim() ? photo.photo_url : null;
}

function isEligibleSocialSource(source: any): boolean {
    const type = source?.type;
    if (type === 'tiktok' || type === 'video') return true;
    if (type !== 'web') return false;
    return isInstagramUrl(typeof source?.url === 'string' ? source.url : '');
}

/** Dedupe and rank with the same tier→recency ordering as social_clippings. */
async function rankedVisibleClipKeys(saverRows: any[]): Promise<string[]> {
    type Candidate = { key: string; rank: number; createdAt: string };
    const byKey = new Map<string, Candidate>();

    for (const row of saverRows) {
        const source = row?.source;
        if (!isEligibleSocialSource(source) || typeof source?.url !== 'string') {
            continue;
        }
        const key = await contentKey(source.url);
        if (!key) continue;
        const candidate: Candidate = {
            key,
            rank: TIER_RANK[row.relationship as string] ?? TIER_RANK.stranger,
            createdAt: typeof row.created_at === 'string' ? row.created_at : '',
        };
        const current = byKey.get(key);
        if (
            !current ||
            candidate.rank < current.rank ||
            (candidate.rank === current.rank &&
                candidate.createdAt > current.createdAt)
        ) {
            byKey.set(key, candidate);
        }
    }

    return [...byKey.values()]
        .sort((a, b) =>
            a.rank - b.rank
            || (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)
        )
        .map((candidate) => candidate.key);
}

async function visibleClipCandidate(
    client: PeekCardClient,
    viewerId: string,
    restaurantId: string,
    supabaseUrl: string,
): Promise<{ url: string | null; visibleCount: number | null }> {
    const { data: saverRows, error: savesError } = await client.rpc(
        'fn_restaurant_saves_visible',
        { p_viewer: viewerId, p_restaurant_id: restaurantId },
    );
    if (savesError) {
        const code = (savesError as { code?: string }).code ?? '';
        if (code === '42883' || code === 'PGRST202') {
            return { url: null, visibleCount: null };
        }
        throw savesError;
    }

    const visibleRows = Array.isArray(saverRows) ? saverRows : [];
    const rankedKeys = await rankedVisibleClipKeys(visibleRows);
    if (rankedKeys.length === 0) {
        return { url: null, visibleCount: visibleRows.length };
    }

    const { data: thumbs, error: thumbsError } = await client
        .from('clip_thumbs')
        .select('content_key, storage_path')
        .in('content_key', rankedKeys)
        .eq('status', 'cached')
        .not('storage_path', 'is', null);
    if (thumbsError) throw thumbsError;

    const pathByKey = new Map<string, string>();
    for (const thumb of (thumbs ?? []) as any[]) {
        if (
            typeof thumb.content_key === 'string' &&
            typeof thumb.storage_path === 'string'
        ) {
            pathByKey.set(thumb.content_key, thumb.storage_path);
        }
    }

    // Walk the ranked rows until the first durable cached thumbnail. The top
    // social winner may legitimately be unthumbed.
    for (const key of rankedKeys) {
        const storagePath = pathByKey.get(key);
        if (storagePath) {
            const base = supabaseUrl.replace(/\/$/, '');
            return {
                url: `${base}/storage/v1/object/public/clip-thumbs/${storagePath}`,
                visibleCount: visibleRows.length,
            };
        }
    }
    return { url: null, visibleCount: visibleRows.length };
}

export async function loadPeekCard(
    client: PeekCardClient,
    input: {
        viewerId: string;
        restaurantId: string;
        context: PeekCardContext;
        supabaseUrl: string;
    },
): Promise<PeekCardResponse> {
    const { viewerId, restaurantId, context, supabaseUrl } = input;

    // Resolve UUID/external_id with the same explicit visibility fence as page.
    let restaurantQuery = client
        .from('restaurants')
        .select(
            'id, address, price_level, google_rating, google_rating_count, hours, ' +
                'reserve_url, photo_url, photo_source, places_photo_attribution_html',
        )
        .or(`verification.eq.verified,created_by.eq.${viewerId}`);
    restaurantQuery = UUID_PATTERN.test(restaurantId)
        ? restaurantQuery.eq('id', restaurantId)
        : restaurantQuery.eq('external_id', restaurantId);
    const { data: restaurant, error: restaurantError } = await restaurantQuery
        .maybeSingle();
    if (restaurantError) throw restaurantError;
    if (!restaurant) return emptyResponse();

    const resolvedId = restaurant.id as string;
    const media: PeekCardMediaCandidate[] = [];

    if (context.layer === 'been') {
        const url = await ownEntryPhoto(client, viewerId, resolvedId);
        if (url) media.push({ kind: 'entry', url, photo_source: 'user' });
    } else if (context.layer === 'network') {
        const url = await authorizedNetworkPhoto(
            client,
            viewerId,
            resolvedId,
            context.entry_id,
        );
        if (url) media.push({ kind: 'entry', url, photo_source: 'user' });
    } else if (context.layer === 'gathered') {
        const url = await authorizedGatheredPhoto(
            client,
            viewerId,
            resolvedId,
            context.table_id,
        );
        if (url) media.push({ kind: 'entry', url, photo_source: 'table' });
    }

    const clip = await visibleClipCandidate(
        client,
        viewerId,
        resolvedId,
        supabaseUrl,
    );
    if (clip.url) media.push({ kind: 'clip', url: clip.url });

    if (
        restaurant.photo_source === 'places' &&
        typeof restaurant.photo_url === 'string' &&
        restaurant.photo_url.trim()
    ) {
        const attribution = placesAttributionAuthor(
            restaurant.places_photo_attribution_html,
        );
        if (attribution) {
            media.push({
                kind: 'places',
                url: restaurant.photo_url,
                photo_source: 'places',
                attribution,
            });
        }
    }

    const response: PeekCardResponse = {
        media,
        google_rating: finiteNumber(restaurant.google_rating),
        google_rating_count: finiteNumber(restaurant.google_rating_count),
        price_level: finiteNumber(restaurant.price_level),
        hours: normalizedHours(restaurant.hours),
        address_short: shortAddress(restaurant.address),
        reserve_url: typeof restaurant.reserve_url === 'string' &&
                restaurant.reserve_url.trim()
            ? restaurant.reserve_url
            : null,
    };

    if (
        context.layer !== 'overlap' &&
        clip.visibleCount != null &&
        clip.visibleCount >= VISIBLE_SAVES_FLOOR
    ) {
        response.visible_saves_count = clip.visibleCount;
    }
    return response;
}
