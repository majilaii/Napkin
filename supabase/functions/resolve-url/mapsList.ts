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
    try {
        const parsed = new URL(u);
        const parts = parsed.pathname.split('/');
        const i = parts.findIndex((p) => p === 'place' || p === 'Place');
        if (i >= 0 && parts[i + 1]) {
            return decodeURIComponent(parts[i + 1]).replace(/\+/g, ' ').trim() || null;
        }
        return parsed.searchParams.get('q') ?? parsed.searchParams.get('query');
    } catch {
        return null;
    }
}

// google.com serves EU vantage points a consent interstitial when no consent
// cookies ride along; these opt the request out. Harmless elsewhere.
const MAPS_FETCH_HEADERS = {
    'User-Agent': 'Napkin/1.0 (link-resolver; +https://napkin.app)',
    'Cookie': 'CONSENT=YES+; SOCS=CAI',
};

export interface ExpandedMapsShare {
    placeQuery: string | null;
    list: ParsedMapsList | null;
}

/**
 * Google Maps SHARE links are short redirects (maps.app.goo.gl/…, goo.gl/maps/…)
 * with no /place/ segment. Follow the redirect; the target is either
 *   (a) a single place → parse the name from the canonical URL, or
 *   (b) a shared LIST → the JS-only page exposes its entitylist/getlist data
 *       fetch as a <link rel="preload"> — fetch that (static-pb fallback) and
 *       parse the items, or
 *   (c) neither → fall back to og:title / <title> (bare "Google Maps" — the
 *       JS-shell title — is rejected; it used to leak into a Places search).
 * Fully fail-soft: any failure degrades toward { null, null }.
 *
 * `signalFactory` mints a per-stage AbortSignal already clamped to the caller's
 * overall deadline (Deadline.stageSignal in index.ts).
 */
export async function expandMapsShare(
    url: string,
    signalFactory: (ms: number) => AbortSignal,
): Promise<ExpandedMapsShare> {
    let finalUrl = url;
    let pageText: string | null = null;
    try {
        const res = await fetch(url, {
            signal: signalFactory(2500),
            redirect: 'follow',
            headers: MAPS_FETCH_HEADERS,
        });
        finalUrl = res.url || url;
        const fromUrl = parsePlaceFromMapsUrl(finalUrl);
        if (fromUrl) {
            res.body?.cancel().catch(() => {});
            return { placeQuery: fromUrl, list: null };
        }
        pageText = await res.text().catch(() => null);
    } catch {
        return { placeQuery: null, list: null };
    }

    const preloadUrl = pageText ? extractGetlistPreloadUrl(pageText) : null;
    const listId = preloadUrl ? null : extractListIdFromMapsUrl(finalUrl);
    const getlistUrl = preloadUrl ?? (listId ? buildGetlistFallbackUrl(listId) : null);
    if (getlistUrl) {
        try {
            const listRes = await fetch(getlistUrl, {
                signal: signalFactory(2500),
                headers: MAPS_FETCH_HEADERS,
            });
            if (listRes.ok) {
                const body = await listRes.text().catch(() => null);
                const parsed = body ? parseGetlistResponse(body) : null;
                if (parsed && parsed.items.length > 0) {
                    return { placeQuery: null, list: parsed };
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
            return { placeQuery: cleaned, list: null };
        }
    }
    return { placeQuery: null, list: null };
}
