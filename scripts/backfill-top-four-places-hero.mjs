#!/usr/bin/env node
/**
 * backfill-top-four-places-hero.mjs — one-shot Places-hero backfill for Top 4 plates.
 *
 * TICKET-157. Mirrors a Places hero photo into our own Storage + `restaurants.photo_url`
 * for the BOUNDED set of restaurants that are actually referenced by someone's Top 4,
 * so the profile marquee + Table grid can render a real photo instead of a monogram.
 *
 *   ┌─────────────────────────────────────────────────────────────────────────┐
 *   │  MANDATORY FIRST STEP — run with --dry-run before ANY real invocation.    │
 *   │    node scripts/backfill-top-four-places-hero.mjs --dry-run               │
 *   │  Dry-run prints the candidate count + $ estimate and makes ZERO paid      │
 *   │  (Google Places) calls. Record the count in the ticket, THEN run for real.│
 *   └─────────────────────────────────────────────────────────────────────────┘
 *
 * Real run:   node scripts/backfill-top-four-places-hero.mjs
 * Over 500:   node scripts/backfill-top-four-places-hero.mjs --force
 *
 * WHY THIS IS NET-NEW NODE CODE (not an import)
 * ---------------------------------------------
 * `_storeHeroPhoto` (supabase/functions/_shared/restaurant.ts) is a Deno edge helper
 * and cannot be imported here. This script RE-IMPLEMENTS its invariant exactly:
 *   - never write `photo_url` without `places_photo_attribution_html`;
 *   - empty/missing attribution → stamp `photo_source = 'none'` (sentinel, no re-spend);
 *   - CAS-guard every write on `photo_url IS NULL` (a concurrent user/Table write
 *     between read and PATCH → CAS miss → safe no-op);
 *   - the four Places columns (photo_url, photo_reference, attribution, source='places')
 *     are written in ONE atomic UPDATE, upholding the DB CHECK (source='places' ↔
 *     attribution non-null).
 * Idempotent on rerun: both the 'none' sentinel and a populated `photo_url` drop out
 * of the coverage predicate.
 *
 * CANDIDATE SET (union of three sources, deduped via a Set — [ARCH-REVIEW N2])
 * ---------------------------------------------------------------------------
 *   1. Every `restaurant_id` in `user_profile_top_4`   (curated profile picks).
 *   2. Every `restaurant_id` in `table_top_4`          (Table grids).
 *   3. Auto-derived per-user Top 4, REPRODUCED EXACTLY from user-profile/index.ts
 *      `fetchTopFour` (lines 640–706): for each user with NO `user_profile_top_4`
 *      row (manual overrides auto), take their entries with
 *        restaurant_id IS NOT NULL AND rating IS NOT NULL AND rating >= 4.0,
 *      bucket by restaurant (max_rating; visit_count = # of these ≥4.0 rows;
 *      last_visited = max(visited_at ?? created_at) — [ARCH-REVIEW N3]), rank by
 *      max_rating ↓ → visit_count ↓ → last_visited ↓, slice top 4.
 *      Union BOTH the includePrivate=true slice (all ≥4.0 rows) AND the
 *      includePrivate=false slice (visibility != 'private') — a private ≥4.0 entry
 *      can evict a public pick, so `true` alone is not a superset ([ARCH-REVIEW W1]).
 *
 * COVERAGE PREDICATE (intersect candidate set with)
 * -------------------------------------------------
 *   photo_url IS NULL AND photo_source IS NULL AND external_id IS NOT NULL
 *   - `photo_source IS NULL` excludes rows already stamped 'none' (tried, no usable
 *     photo) so reruns spend nothing.
 *   - `external_id IS NOT NULL` excludes rows with no Places handle.
 *
 * COUNT-BEFORE-SPEND + CEILING
 * ----------------------------
 * Logs the coverage count before any paid call. Refuses to run past a hard ceiling
 * of 500 rows without --force. --dry-run makes ZERO paid calls.
 *
 * COST MATH
 * ---------
 * Each NULL-`photo_url` row also has NULL `photo_reference` (written atomically
 * together), so every hit costs 1 Place Details (Pro, photos.* mask ≈ $0.017) +
 * at most 1 Places Photo media fetch (≈ $0.007) ≈ $0.024/row. Rows that resolve to
 * the 'none' sentinel cost only the Details call, so real spend ≤ this bound.
 * Worst case at the 500 ceiling ≈ $12.00.
 *
 * RATE LIMIT
 * ----------
 * 100 ms between rows (~10 QPS), well under quota. Safe to Ctrl-C and rerun.
 */

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_SB_URL = 'https://ftvmseaqwwlcxtdlvxxz.supabase.co';

const CEILING = 500;
const DETAILS_COST = 0.017; // Place Details Pro, photos.* field mask
const PHOTO_COST = 0.007;   // Places Photo media fetch
const PER_ROW_COST = DETAILS_COST + PHOTO_COST; // ≈ $0.024 worst-case per row

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const FORCE = args.has('--force');

function loadEnvFromFile(filePath) {
    if (!fs.existsSync(filePath)) return {};
    const entries = {};
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;
        const key = trimmed.slice(0, eqIndex).trim();
        const value = trimmed.slice(eqIndex + 1).trim().replace(/^"|"$/g, '');
        entries[key] = value;
    }
    return entries;
}

const repoRoot = process.cwd();
const localEnv = loadEnvFromFile(path.join(repoRoot, 'supabase', '.env.local'));

const SB_URL = process.env.SUPABASE_URL ?? localEnv.SUPABASE_URL ?? DEFAULT_SB_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? localEnv.SUPABASE_SERVICE_ROLE_KEY;
const PLACES_KEY = process.env.GOOGLE_PLACES_API_KEY ?? localEnv.GOOGLE_PLACES_API_KEY;

if (!SB_KEY) {
    console.error('Missing SUPABASE_SERVICE_ROLE_KEY. Set in shell or supabase/.env.local.');
    process.exit(1);
}
// GOOGLE_PLACES_API_KEY is only needed for a real (non-dry) run.
if (!DRY_RUN && !PLACES_KEY) {
    console.error('Missing GOOGLE_PLACES_API_KEY. Set in shell or supabase/.env.local.');
    process.exit(1);
}

// REST_HEADERS is for Supabase PostgREST reads/writes ONLY. It carries
// Content-Type: application/json and MUST NOT be reused for the Storage binary
// upload (that needs the image content-type — see uploadHero / [ARCH-REVIEW W4]).
const REST_HEADERS = {
    apikey: SB_KEY,
    Authorization: `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json',
};

/** Minimal HTML escaper — mirrors places-search/index.ts + backfill-places-attribution.mjs. */
function escapeHtml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Build attribution HTML from authorAttributions[0] only (AC 13 / _storeHeroPhoto). */
function buildAttributionHtml(body) {
    const att = body?.photos?.[0]?.authorAttributions?.[0];
    if (!att?.displayName) return null;
    if (att.uri) {
        return `<a href="${escapeHtml(att.uri)}">${escapeHtml(att.displayName)}</a>`;
    }
    return escapeHtml(att.displayName);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Page a PostgREST table fully (limit/offset by 1000) with an arbitrary query string. */
async function fetchAll(pathAndQuery) {
    const pageSize = 1000;
    let offset = 0;
    const all = [];
    for (;;) {
        const sep = pathAndQuery.includes('?') ? '&' : '?';
        // order=id: PostgREST adds no implicit sort, and offset pagination over an
        // unordered scan can skip/duplicate rows between pages (review WARN, 2026-07-10).
        const url = `${SB_URL}/rest/v1/${pathAndQuery}${sep}order=id&limit=${pageSize}&offset=${offset}`;
        const res = await fetch(url, { headers: REST_HEADERS });
        if (!res.ok) {
            const b = await res.text();
            throw new Error(`REST read failed (${res.status}) for ${pathAndQuery}: ${b}`);
        }
        const rows = await res.json();
        all.push(...rows);
        if (rows.length < pageSize) break;
        offset += pageSize;
    }
    return all;
}

/**
 * Reproduce fetchTopFour's rank-and-slice for one user's entries (mirror of
 * user-profile/index.ts:640–706). `entries` are that user's ≥4.0 rows; when
 * `excludePrivate` is true, private rows are dropped first (includePrivate=false).
 * Returns the top-4 restaurant_ids in rank order.
 */
function autoDeriveTop4(entries, excludePrivate) {
    const buckets = new Map();
    for (const e of entries) {
        if (excludePrivate && e.visibility === 'private') continue;
        const rid = e.restaurant_id;
        const rating = Number(e.rating);
        const visited = e.visited_at ?? e.created_at; // [N3]
        const existing = buckets.get(rid);
        if (!existing) {
            buckets.set(rid, { restaurant_id: rid, max_rating: rating, visit_count: 1, last_visited_at: visited });
        } else {
            existing.max_rating = Math.max(existing.max_rating, rating);
            existing.visit_count += 1; // only ≥4.0 rows reach here — [N3]
            if (!existing.last_visited_at || visited > existing.last_visited_at) {
                existing.last_visited_at = visited;
            }
        }
    }
    return Array.from(buckets.values())
        .sort((a, b) => {
            if (a.max_rating !== b.max_rating) return b.max_rating - a.max_rating;
            if (a.visit_count !== b.visit_count) return b.visit_count - a.visit_count;
            const al = a.last_visited_at ?? '';
            const bl = b.last_visited_at ?? '';
            return al < bl ? 1 : al > bl ? -1 : 0;
        })
        .slice(0, 4)
        .map((b) => b.restaurant_id);
}

/** Build the deduped candidate restaurant_id set from all three sources. */
async function buildCandidateSet() {
    const candidates = new Set(); // [ARCH-REVIEW N2]

    // Source 1: curated profile picks (also gives us the manual-user set).
    const profileRows = await fetchAll('user_profile_top_4?select=user_id,restaurant_id');
    const manualUserIds = new Set();
    for (const r of profileRows) {
        if (r.restaurant_id) candidates.add(r.restaurant_id);
        if (r.user_id) manualUserIds.add(r.user_id);
    }

    // Source 2: Table grids.
    const tableRows = await fetchAll('table_top_4?select=restaurant_id');
    for (const r of tableRows) {
        if (r.restaurant_id) candidates.add(r.restaurant_id);
    }

    // Source 3: auto-derived per-user Top 4 (users WITHOUT a manual profile row).
    const entryRows = await fetchAll(
        'entries?select=user_id,restaurant_id,rating,visited_at,created_at,visibility' +
        '&restaurant_id=not.is.null&rating=not.is.null&rating=gte.4.0',
    );
    const byUser = new Map();
    for (const e of entryRows) {
        if (manualUserIds.has(e.user_id)) continue; // manual overrides auto
        let list = byUser.get(e.user_id);
        if (!list) { list = []; byUser.set(e.user_id, list); }
        list.push(e);
    }
    for (const [, list] of byUser) {
        // [W1]: union BOTH slices — a private ≥4.0 entry can evict a public pick.
        for (const rid of autoDeriveTop4(list, false)) candidates.add(rid); // includePrivate=true
        for (const rid of autoDeriveTop4(list, true)) candidates.add(rid);  // includePrivate=false
    }

    return candidates;
}

/**
 * Intersect the candidate set with the coverage predicate. Batch-fetches restaurant
 * rows by id (chunks of 100) and filters in memory:
 *   photo_url IS NULL AND photo_source IS NULL AND external_id IS NOT NULL.
 */
async function fetchCoverage(candidateIds) {
    const coverage = [];
    const ids = [...candidateIds];
    for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const inList = chunk.map((id) => `"${id}"`).join(',');
        const url = `${SB_URL}/rest/v1/restaurants?select=id,external_id,photo_url,photo_source` +
            `&id=in.(${inList})`;
        const res = await fetch(url, { headers: REST_HEADERS });
        if (!res.ok) {
            const b = await res.text();
            throw new Error(`Coverage read failed (${res.status}): ${b}`);
        }
        const rows = await res.json();
        for (const r of rows) {
            if (r.photo_url === null && r.photo_source === null && r.external_id != null) {
                coverage.push({ id: r.id, external_id: r.external_id });
            }
        }
    }
    return coverage;
}

/** Place Details — photos.name (resource name) + photos.authorAttributions. */
async function fetchPlaceDetails(externalId) {
    const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(externalId)}`;
    const res = await fetch(url, {
        headers: {
            'X-Goog-Api-Key': PLACES_KEY,
            'X-Goog-FieldMask': 'photos.name,photos.authorAttributions',
        },
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, body: await res.json() };
}

/**
 * Fetch the Places media bytes and upload to Storage (bucket restaurant-photos,
 * key `${id}/hero.jpg`). [ARCH-REVIEW W4]: the upload uses image headers, NOT
 * REST_HEADERS — reusing REST_HEADERS' application/json would store a corrupt object.
 * Returns { ok, publicUrl } or { ok: false }.
 */
async function uploadHero(id, photoName) {
    // Byte-identical media URL to _storeHeroPhoto.
    const mediaUrl = `https://places.googleapis.com/v1/${photoName}/media?maxHeightPx=800&maxWidthPx=1200&key=${PLACES_KEY}`;
    const mediaRes = await fetch(mediaUrl);
    if (!mediaRes.ok) {
        console.error(`  media fetch failed for ${id}: HTTP ${mediaRes.status}`);
        return { ok: false };
    }
    const contentType = mediaRes.headers.get('content-type') ?? 'image/jpeg';
    const bytes = Buffer.from(await mediaRes.arrayBuffer());
    if (bytes.byteLength === 0) {
        console.error(`  media returned empty body for ${id}`);
        return { ok: false };
    }

    const objectPath = `restaurant-photos/${id}/hero.jpg`;
    const uploadRes = await fetch(`${SB_URL}/storage/v1/object/${objectPath}`, {
        method: 'POST',
        headers: {
            apikey: SB_KEY,
            Authorization: `Bearer ${SB_KEY}`,
            'Content-Type': contentType,
            'x-upsert': 'true',
        },
        body: bytes,
    });
    if (!uploadRes.ok) {
        const b = await uploadRes.text();
        console.error(`  storage upload failed for ${id}: HTTP ${uploadRes.status} ${b}`);
        return { ok: false };
    }
    return { ok: true, publicUrl: `${SB_URL}/storage/v1/object/public/${objectPath}` };
}

/** CAS UPDATE — stamp the 'none' sentinel. Guard: photo_url IS NULL. */
async function stampNone(id) {
    const url = `${SB_URL}/rest/v1/restaurants?id=eq.${id}&photo_url=is.null`;
    const res = await fetch(url, {
        method: 'PATCH',
        headers: { ...REST_HEADERS, Prefer: 'return=representation' },
        body: JSON.stringify({ photo_source: 'none' }),
    });
    if (!res.ok) return false;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0; // false ⇒ CAS miss (raced)
}

/** CAS UPDATE — atomic four-column Places write. Guard: photo_url IS NULL. */
async function stampPlaces(id, publicUrl, photoName, attribution) {
    const url = `${SB_URL}/rest/v1/restaurants?id=eq.${id}&photo_url=is.null`;
    const res = await fetch(url, {
        method: 'PATCH',
        headers: { ...REST_HEADERS, Prefer: 'return=representation' },
        body: JSON.stringify({
            photo_url: publicUrl,
            photo_reference: photoName,
            places_photo_attribution_html: attribution,
            photo_source: 'places',
        }),
    });
    if (!res.ok) return false;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0; // false ⇒ CAS miss (raced)
}

async function main() {
    console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (zero paid calls)' : FORCE ? 'REAL RUN (--force)' : 'REAL RUN'}`);
    console.log('Building candidate set (profile + table + auto-derived Top 4)…');
    const candidates = await buildCandidateSet();
    console.log(`  candidate restaurants (deduped): ${candidates.size}`);

    console.log('Intersecting with coverage predicate (photo_url IS NULL AND photo_source IS NULL AND external_id IS NOT NULL)…');
    const coverage = await fetchCoverage(candidates);
    const total = coverage.length;
    const estimate = (total * PER_ROW_COST).toFixed(2);
    console.log(`\n  COVERAGE COUNT: ${total} rows to backfill`);
    console.log(`  COST ESTIMATE (worst case): ${total} × $${PER_ROW_COST.toFixed(3)} ≈ $${estimate}`);

    if (total === 0) {
        console.log('\nNothing to do.');
        return;
    }

    if (DRY_RUN) {
        console.log('\n--dry-run: made ZERO paid calls. Record the count above in the ticket, then run for real.');
        if (total > CEILING) {
            console.log(`NOTE: ${total} exceeds the ceiling of ${CEILING}. A real run will require --force.`);
        }
        return;
    }

    if (total > CEILING && !FORCE) {
        console.error(
            `\nREFUSING: ${total} rows exceeds the hard ceiling of ${CEILING}. ` +
            `Re-run with --force to override (worst case ≈ $${estimate}).`,
        );
        process.exit(1);
    }

    let attributed = 0;
    let nulled = 0;
    let raced = 0;
    let errors = 0;

    for (let i = 0; i < coverage.length; i++) {
        const { id, external_id } = coverage[i];
        const label = `[${i + 1}/${total}] id=${id} external_id=${external_id}`;

        const details = await fetchPlaceDetails(external_id);
        if (!details.ok) {
            console.warn(`${label} → WARN Place Details http=${details.status}, skipping`);
            errors++;
            await sleep(100);
            continue;
        }

        const attribution = buildAttributionHtml(details.body);
        const photoName = details.body?.photos?.[0]?.name ?? null;

        if (!attribution || !photoName) {
            // Empty/missing attribution (or no photo resource) → 'none' sentinel, no media fetch.
            const ok = await stampNone(id);
            if (ok) { console.log(`${label} → nulled (sentinel='none')`); nulled++; }
            else { console.log(`${label} → skipped (CAS miss — raced)`); raced++; }
            await sleep(100);
            continue;
        }

        const upload = await uploadHero(id, photoName);
        if (!upload.ok) {
            errors++;
            await sleep(100);
            continue;
        }

        const ok = await stampPlaces(id, upload.publicUrl, photoName, attribution);
        if (ok) { console.log(`${label} → attributed (photo_source='places')`); attributed++; }
        else { console.log(`${label} → skipped (CAS miss — raced)`); raced++; }

        await sleep(100);
    }

    console.log('\nBackfill complete.');
    console.log(`  attributed (photo_source='places'): ${attributed}`);
    console.log(`  nulled (sentinel='none'):           ${nulled}`);
    console.log(`  raced (CAS miss, no-op):            ${raced}`);
    console.log(`  errors (http/upload):               ${errors}`);
}

main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
});
