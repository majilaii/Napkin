/**
 * Google Maps shared-list parsing — pure helpers (no I/O, testable).
 *
 * A Maps list share (maps.app.goo.gl/… → google.com/maps/@/data=!…!11m2!2s<id>!…)
 * is a JS-only page: <title> is bare "Google Maps" and APP_INITIALIZATION_STATE
 * carries no places. The list data lives behind the internal
 * `/maps/preview/entitylist/getlist` endpoint, which the page itself exposes as
 * a `<link rel="preload" as="fetch">` — we extract that exact URL (Google keeps
 * it current) and fall back to a static pb built from the list id. The response
 * is XSSI-prefixed (`)]}'`) JSON: root[4] = list title, root[8] = items, each
 * item [2] = place name, [1][4] = street address. Verified against live lists
 * 2026-07-07 (40-item + 23-item samples, identical shape).
 *
 * Endpoint is unauthenticated for publicly-shared lists; privately-shared lists
 * 404/empty → we degrade to zero items (caller falls back to title unfurl).
 */

import type { StagedCandidate } from '../_shared/candidateDedupe.ts';

export interface MapsListItem {
    name: string;
    address: string | null;
}

export interface ParsedMapsList {
    title: string | null;
    items: MapsListItem[];
}

/** Spot ceiling for a list import — aligned with save_spots' per-request cap. */
export const MAPS_LIST_CAP = 20;

/**
 * Extract the entitylist/getlist preload URL from a Maps list page.
 * The href is HTML-attribute-encoded (&amp;) — decode before fetching.
 */
export function extractGetlistPreloadUrl(html: string): string | null {
    const m = html.match(
        /<link\s+href="(\/maps\/preview\/entitylist\/getlist[^"]+)"[^>]*as="fetch"/i,
    );
    if (!m) return null;
    return 'https://www.google.com' + m[1].replace(/&amp;/g, '&');
}

/**
 * Pull the list id out of a canonical Maps list URL. Two shapes observed:
 *   …/maps/placelists/list/<id>
 *   …/maps/@/data=!3m1!4b1!4m3!11m2!2s<id>!3e3   (share-redirect target)
 */
export function extractListIdFromMapsUrl(url: string): string | null {
    const placelists = url.match(/\/maps\/placelists\/list\/([\w-]+)/);
    if (placelists) return placelists[1];
    const dataParam = url.match(/!11m2!2s([\w-]+)/);
    if (dataParam) return dataParam[1];
    return null;
}

/**
 * Static getlist URL for when the preload link isn't in the HTML.
 * pb shape from the ecosystem's stable minimal form: !1m1!1s<id>!2e2!3e2!4i500!16b1.
 */
export function buildGetlistFallbackUrl(listId: string): string {
    const pb = `!1m1!1s${encodeURIComponent(listId)}!2e2!3e2!4i500!16b1`;
    return `https://www.google.com/maps/preview/entitylist/getlist?authuser=0&hl=en&gl=us&pb=${pb}`;
}

/**
 * Parse a getlist response body. Defensive at every level — Google can reshape
 * this without notice, and a shape drift must degrade to null (caller falls
 * back to the title path), never throw.
 */
export function parseGetlistResponse(body: string): ParsedMapsList | null {
    // Strip the XSSI protection prefix.
    const jsonStart = body.indexOf('[');
    if (jsonStart < 0) return null;
    let data: unknown;
    try {
        data = JSON.parse(body.slice(jsonStart));
    } catch {
        return null;
    }
    if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
    const root = data[0] as unknown[];

    const title = typeof root[4] === 'string' && root[4].trim().length > 0
        ? (root[4] as string).trim()
        : null;

    const rawItems = Array.isArray(root[8]) ? (root[8] as unknown[]) : [];
    const items: MapsListItem[] = [];
    for (const raw of rawItems) {
        if (!Array.isArray(raw)) continue;
        const name = typeof raw[2] === 'string' ? raw[2].trim() : '';
        if (!name) continue;
        const loc = Array.isArray(raw[1]) ? (raw[1] as unknown[]) : null;
        const address = loc && typeof loc[4] === 'string' && loc[4].trim().length > 0
            ? (loc[4] as string).trim()
            : null;
        items.push({ name, address });
    }
    if (items.length === 0 && !title) return null;
    return { title, items };
}

/**
 * Best-effort city from a street address — used only for the ghost-candidate
 * label and the pre-Places fuzzy-dedupe key (the Places query itself gets the
 * FULL address via `area`). The segment after the street line is the locality
 * in every observed format; digit-bearing tokens (postcodes, "WC2H 9FB") are
 * stripped from it.
 *   "1-3 Queen St, Williamstown SA 5351"                         → "Williamstown SA"
 *   "12 Upper St Martin's Lane, London WC2H 9FB, United Kingdom" → "London"
 *   "123 Main St, Brooklyn, NY 11211, USA"                       → "Brooklyn"
 */
export function cityFromAddress(address: string | null): string | null {
    if (!address) return null;
    const segs = address.split(',').map((s) => s.trim()).filter(Boolean);
    if (segs.length < 2) return null;
    const words = segs[1].split(/\s+/).filter((w) => !/\d/.test(w));
    const city = words.join(' ').trim();
    return city.length > 0 ? city : null;
}

/**
 * Stage list items for the Places-resolution pipeline DIRECTLY — deliberately
 * NOT through dedupeAndRank. The pre-Places fuzzy fold exists to merge one
 * place seen by two noisy channels (ASR vs OCR); list items are deterministic
 * and already distinct (Google enforces uniqueness per list), and the fold
 * verifiably collapses same-name branches ("Dishoom" vs "Dishoom Shoreditch",
 * two "Gail's Bakery" in one city). True duplicates still collapse post-Places
 * by google_place_id.
 *
 * The FULL street address rides in `area` so the Places text query becomes
 * "<name>, <street address>"; the parsed city only feeds the ghost label.
 */
export function mapsItemsToStaged(items: MapsListItem[], cap: number): StagedCandidate[] {
    return items.slice(0, cap).map((it, i) => ({
        extracted: {
            name: it.name,
            city: cityFromAddress(it.address),
            city_inferred: false,
            area: it.address,
            stance: 'neutral' as const,
            cuisine: null,
            address: it.address,
            booking_url: null,
            hours: null,
            confidence: 'exact' as const,
            google_place_id: null,
        },
        tier: 0 as const,
        ordinal: i,
        inBothTiers: false,
    }));
}

// ── Share-link expansion (I/O — lives here, not index.ts, so it's importable
//    without triggering serve(); same doctrine as _helpers.ts) ────────────────

/** "Carbone · Greenwich Village - Google Maps" → "Carbone · Greenwich Village" */
export function cleanMapsTitle(t: string): string {
    return t.replace(/\s*[-–—|]\s*Google\s*Maps\s*$/i, '').trim();
}

/** Parse a place name from an already-canonical Maps URL (/place/<name> or ?q=). */
export function parsePlaceFromMapsUrl(u: string): string | null {
    return parseMapsPlaceTarget(u)?.query ?? null;
}

export interface MapsPlaceLocation {
    lat: number;
    lng: number;
}

export interface MapsPlaceTarget {
    query: string;
    /** The place's own coordinates when the link carries them (web shares). */
    location: MapsPlaceLocation | null;
    /** The query carries its own address ("Name, 12 High St, London N1"). */
    selfLocating: boolean;
}

/**
 * The place a Maps URL names, with its own coordinates when the URL carries them.
 *   /maps/place/<name>/@<lat>,<lng>,<z>/data=…!3d<lat>!4d<lng>…  (web shares)
 *   maps.google.com/?q=<name>,+<address>&ftid=…                    (app shares)
 * `!3d/!4d` is the PLACE; `@lat,lng` is only the camera, so it is the fallback.
 * A `q` that is itself a coordinate pair is a dropped pin, never a venue.
 */
export function parseMapsPlaceTarget(u: string): MapsPlaceTarget | null {
    let parsed: URL;
    try {
        parsed = new URL(u);
    } catch {
        return null;
    }
    const parts = parsed.pathname.split('/');
    const i = parts.findIndex((p) => p === 'place' || p === 'Place');
    let query: string | null = null;
    if (i >= 0 && parts[i + 1]) {
        try {
            query = decodeURIComponent(parts[i + 1].replace(/\+/g, ' ')).trim() || null;
        } catch {
            return null;
        }
    } else {
        query = (parsed.searchParams.get('q') ?? parsed.searchParams.get('query'))?.trim() || null;
        if (query && COORDINATE_PAIR.test(query)) return null;
    }
    if (!query) return null;
    return { query, location: mapsUrlLocation(parsed), selfLocating: SELF_LOCATING.test(query) };
}

/** Address-shaped: a separator (Latin, Arabic, CJK comma) or a street/post number. */
const SELF_LOCATING = /[,،、，]|\d/;

const COORDINATE_PAIR = /^-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?$/;

function validLocation(lat: number, lng: number): MapsPlaceLocation | null {
    return Number.isFinite(lat) && Number.isFinite(lng) &&
        Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)
        ? { lat, lng }
        : null;
}

function mapsUrlLocation(url: URL): MapsPlaceLocation | null {
    let path: string;
    try {
        path = decodeURIComponent(url.pathname);
    } catch {
        path = url.pathname;
    }
    const pin = path.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    if (pin) {
        const location = validLocation(Number(pin[1]), Number(pin[2]));
        if (location) return location;
    }
    const camera = path.match(/\/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,|$)/);
    if (camera) {
        const location = validLocation(Number(camera[1]), Number(camera[2]));
        if (location) return location;
    }
    const ll = url.searchParams.get('ll')?.split(',');
    return ll?.length === 2 ? validLocation(Number(ll[0]), Number(ll[1])) : null;
}

/** maps.app.goo.gl, goo.gl and Google's (geo-localised) web hosts only. */
export function isGoogleMapsHop(url: URL): boolean {
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    return host === 'maps.app.goo.gl' || host === 'goo.gl' || host === 'consent.google.com' ||
        /^(?:www\.|maps\.)?google\.(?:[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(host);
}

/** A redirect target that can name a place: a Maps path or a maps.google.* host. */
function isMapsPlaceHop(url: URL): boolean {
    return isGoogleMapsHop(url) && url.hostname !== 'consent.google.com' &&
        (url.pathname.startsWith('/maps') || url.hostname.toLowerCase().startsWith('maps.google.'));
}

// google.com serves EU vantage points a consent interstitial when no consent
// cookies ride along; these opt the request out. Harmless elsewhere.
const MAPS_FETCH_HEADERS = {
    'User-Agent': 'Napkin/1.0 (link-resolver; +https://napkin.app)',
    'Cookie': 'CONSENT=YES+; SOCS=CAI',
};

export interface ExpandedMapsShare {
    place: MapsPlaceTarget | null;
    list: ParsedMapsList | null;
}

const EMPTY_EXPANSION: ExpandedMapsShare = { place: null, list: null };
/** Observed chains are 1 hop (web share) to 3 hops (app share) before the page. */
const MAX_MAPS_REDIRECTS = 6;
const MAPS_HOP_TIMEOUT_MS = 2500;

/**
 * Google Maps SHARE links are short redirects (maps.app.goo.gl/…, goo.gl/maps/…)
 * with no /place/ segment. Walk the redirects ourselves; the chain names either
 *   (a) a single place → read it from the FIRST hop that names it. App-made
 *       links go maps.app.goo.gl → maps.google.com/?q=Name,+Address → two more
 *       hops → a slow 220 KB page; following all of it under one budget timed
 *       out, so every app share imported nothing (TICKET-248), or
 *   (b) a shared LIST → the JS-only page exposes its entitylist/getlist data
 *       fetch as a <link rel="preload"> — fetch that (static-pb fallback) and
 *       parse the items, or
 *   (c) neither → fall back to og:title / <title> (bare "Google Maps" — the
 *       JS-shell title — is rejected; it used to leak into a Places search).
 * Only Google hosts are followed. A consent interstitial is never fetched: its
 * `continue` parameter is the Maps URL it guards.
 * Fully fail-soft: any failure degrades toward an empty expansion.
 *
 * `signalFactory` mints a per-stage AbortSignal already clamped to the caller's
 * overall deadline (Deadline.stageSignal in index.ts).
 */
export async function expandMapsShare(
    url: string,
    signalFactory: (ms: number) => AbortSignal,
    fetcher: typeof fetch = fetch,
): Promise<ExpandedMapsShare> {
    let current: URL;
    try {
        current = new URL(url);
    } catch {
        return EMPTY_EXPANSION;
    }
    let pageText: string | null = null;
    try {
        for (let redirects = 0; ; redirects++) {
            if (current.hostname === 'consent.google.com') {
                const guarded = current.searchParams.get('continue');
                if (!guarded) return EMPTY_EXPANSION;
                current = new URL(guarded);
            }
            if (!isGoogleMapsHop(current)) return EMPTY_EXPANSION;
            const named = isMapsPlaceHop(current) ? parseMapsPlaceTarget(current.href) : null;
            if (named) return { place: named, list: null };
            const res = await fetcher(current.href, {
                signal: signalFactory(MAPS_HOP_TIMEOUT_MS),
                redirect: 'manual',
                headers: MAPS_FETCH_HEADERS,
            });
            const location = res.headers.get('location');
            if (res.status >= 300 && res.status < 400 && location) {
                res.body?.cancel().catch(() => {});
                if (redirects >= MAX_MAPS_REDIRECTS) return EMPTY_EXPANSION;
                current = new URL(location, current);
                continue;
            }
            if (!res.ok) {
                res.body?.cancel().catch(() => {});
                return EMPTY_EXPANSION;
            }
            pageText = await res.text().catch(() => null);
            break;
        }
    } catch {
        return EMPTY_EXPANSION;
    }
    const finalUrl = current.href;

    const preloadUrl = pageText ? extractGetlistPreloadUrl(pageText) : null;
    const listId = preloadUrl ? null : extractListIdFromMapsUrl(finalUrl);
    const getlistUrl = preloadUrl ?? (listId ? buildGetlistFallbackUrl(listId) : null);
    if (getlistUrl) {
        try {
            const listRes = await fetcher(getlistUrl, {
                signal: signalFactory(2500),
                headers: MAPS_FETCH_HEADERS,
            });
            if (listRes.ok) {
                const body = await listRes.text().catch(() => null);
                const parsed = body ? parseGetlistResponse(body) : null;
                if (parsed && parsed.items.length > 0) {
                    return { place: null, list: parsed };
                }
            } else {
                listRes.body?.cancel().catch(() => {});
            }
        } catch {
            /* fail-soft → title fallback */
        }
    }

    if (pageText) {
        const og = pageText.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,200})["']/i);
        const raw = og?.[1] ?? pageText.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1] ?? null;
        const cleaned = raw ? cleanMapsTitle(raw) : null;
        if (cleaned && !/^google maps$/i.test(cleaned)) {
            return { place: { query: cleaned, location: null, selfLocating: false }, list: null };
        }
    }
    return EMPTY_EXPANSION;
}
