#!/usr/bin/env node
/**
 * backfill-list-cover-hero.mjs — one-shot Places-hero backfill for LIST COVER plates.
 *
 * TICKET-187. Imports — the main source of list content — historically never set
 * `restaurants.photo_url`, so list covers (derived at read time by
 * fn_saved_list_cards from the FIRST entry's restaurant) fall back to emoji.
 * This script mirrors a Places hero photo into our own Storage +
 * `restaurants.photo_url` for the bounded set of list-referenced restaurants the
 * TICKET-187 import fix cannot retroactively heal. Covers need NO recompute —
 * they derive from `restaurants.photo_url` on next read.
 *
 *   ┌─────────────────────────────────────────────────────────────────────────┐
 *   │  MANDATORY FIRST STEP — run with --dry-run before ANY real invocation.    │
 *   │    node scripts/backfill-list-cover-hero.mjs --dry-run                    │
 *   │  Dry-run prints the candidate count + per-mode $ estimate and makes ZERO  │
 *   │  paid (Google Places) calls. Record the count in the ticket, THEN run.    │
 *   └─────────────────────────────────────────────────────────────────────────┘
 *
 * PRIORITY SETS (run in order, dry-run each first — TICKET-187 design):
 *   --set=covers (default)  The single cover-candidate restaurant per list — the
 *                           FIRST list entry computed with the EXACT
 *                           fn_saved_list_cards ordering (ranked → position ASC
 *                           NULLS LAST, else created_at DESC NULLS LAST, tiebreak
 *                           le.id ASC). Smallest, highest-value; unblocks covers.
 *   --set=all               Every list_entries-referenced restaurant. Larger;
 *                           survives reorders/edits, feeds the profile shelves.
 *   --set=everything        Every restaurant in the table, with no list join. It
 *                           supersedes the narrower sets for full-surface coverage
 *                           across map, feed, and restaurant pages.
 *
 * Real run:   node scripts/backfill-list-cover-hero.mjs [--set=covers|all|everything]
 * Over 500:   add --force
 * Stale ids:  add --refresh-stale (see below)
 *
 * WHY THIS IS NET-NEW NODE CODE (not an import)
 * ---------------------------------------------
 * `_storeHeroPhoto` / `acquireAndMirrorHeroPhotos` (supabase/functions/_shared/
 * restaurant.ts) are Deno edge helpers and cannot be imported here. This script
 * RE-IMPLEMENTS their TICKET-187 invariants exactly:
 *   - never write `photo_url` without `places_photo_attribution_html`;
 *   - photos-only Details field mask (photos.name,photos.authorAttributions) —
 *     the Essentials tier, never the app's full field list;
 *   - empty/missing attribution or no photo → stamp `photo_source = 'none'`
 *     (TERMINAL sentinel, no re-spend); transient HTTP failure → leave NULL;
 *   - REFERENCE-DERIVED Storage key `restaurant-photos/<id>/<sha1(photoName)>.jpg`
 *     + exact-URL CAS guarded on `photo_url IS NULL` — different-reference racers
 *     produce distinct objects and only the CAS winner is referenced (a loser is
 *     a harmless orphan, never mis-attributed);
 *   - the four Places columns (photo_url, photo_reference, attribution,
 *     source='places') are written in ONE atomic UPDATE, upholding the DB CHECK.
 * Idempotent on rerun: both the 'none' sentinel and a populated `photo_url` drop
 * out of the coverage predicate.
 *
 * COVERAGE PREDICATE (intersect candidate set with — TICKET-187)
 * --------------------------------------------------------------
 *   photo_url IS NULL AND photo_source IS NULL AND external_id IS NOT NULL
 *   AND verification = 'verified'
 *   - `photo_source IS NULL` excludes rows already stamped 'none'/'places' so
 *     reruns spend nothing (zero double-spend vs the -157 Top-4 backfill).
 *   - `external_id IS NOT NULL` excludes rows with no Places handle.
 *   - `verification = 'verified'` excludes GHOST rows. Ghosts carry synthetic
 *     NON-NULL `ghost_*` external ids and DO land in list_entries, so the -157
 *     predicate alone does NOT exclude them; without this clause a ghost's
 *     guaranteed Details 404 would (under --refresh-stale) proceed to Text
 *     Search and could rewrite its external_id, bypassing the unverified-ghost
 *     quarantine. The script SELECTs `verification` and filters BEFORE counting
 *     or spending; both normal and --refresh-stale dry runs assert ghosts are
 *     excluded (see the GHOST EXCLUSION line + hard assertion in fetchCoverage).
 *
 * COUNT-BEFORE-SPEND + CEILING
 * ----------------------------
 * Logs the coverage count before any paid call. Refuses to run past a hard
 * ceiling of 500 rows without --force. --dry-run makes ZERO paid calls.
 *
 * COST MATH (per-mode, conservative — TICKET-187 P2 corrected)
 * ------------------------------------------------------------
 * Normal mode ≈ count × (photos-only Place Details at the ESSENTIALS tier +
 * Places Photos media at $7/1000). Do NOT price this as the app's full-field
 * Details (Enterprise tier). --refresh-stale ADDS a Text Search (Pro) call per
 * stale (Details-404) row — surfaced as a separate worst-case line. VERIFY SKU
 * tiers against current Google pricing before a real run; record the printed
 * count + estimate in the ticket first.
 *
 * RATE LIMIT
 * ----------
 * 100 ms between rows (~10 QPS), well under quota. Safe to Ctrl-C and rerun.
 *
 * EXECUTION — laptop, not CI: SUPABASE_SERVICE_ROLE_KEY + GOOGLE_PLACES_API_KEY
 * from supabase/.env.local (as with -157). The deploy doctrine's "never push
 * from a laptop" governs schema migrations + edge deploys; this is a
 * service-key data/Storage backfill (writes only `restaurants` rows +
 * `restaurant-photos` objects) and is out of that rule's scope.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_SB_URL = 'https://ftvmseaqwwlcxtdlvxxz.supabase.co';

const CEILING = 500;
// Photos-only field mask (photos.name,photos.authorAttributions) bills at the
// ESSENTIALS tier — conservative estimate $5/1000. NOT the Pro/Enterprise tier
// the app's full PLACE_FIELDS mask bills at.
const DETAILS_ESSENTIALS_COST = 0.005;
const PHOTO_MEDIA_COST = 0.007;        // Places Photos media fetch, $7/1000
const PER_ROW_COST = DETAILS_ESSENTIALS_COST + PHOTO_MEDIA_COST; // ≈ $0.012 worst case
// --refresh-stale only: places:searchText (Pro, w/ photos mask) per Details-404 row.
const SEARCH_TEXT_PRO_COST = 0.032;

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const FORCE = args.has('--force');
// --refresh-stale: legacy rows can carry EXPIRED Google place ids (Details →
// 404 "no longer valid"; hit 2026-07-11 on the -157 run, 4/4 legacy rows).
// With the flag, a 404 re-finds the place via places:searchText on
// name+address, CAS-updates external_id (guarded by a name-overlap check), and
// mirrors the photo from the SAME search response.
const REFRESH_STALE = args.has('--refresh-stale');

// --set=covers (default) | --set=all | --set=everything.
const setArg = process.argv.slice(2).find((a) => a.startsWith('--set='));
const CANDIDATE_SET = setArg ? setArg.slice('--set='.length) : 'covers';
if (!['covers', 'all', 'everything'].includes(CANDIDATE_SET)) {
    console.error(`Unknown --set=${CANDIDATE_SET}. Use --set=covers (default), --set=all, or --set=everything.`);
    process.exit(1);
}

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
// upload (that needs the image content-type — see uploadHero).
const REST_HEADERS = {
    apikey: SB_KEY,
    Authorization: `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json',
};

/** Minimal HTML escaper — mirrors places-search/index.ts + _shared/htmlEscape.ts::escapeAttr. */
function escapeHtml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Build attribution HTML from authorAttributions[0] only (TICKET-057 AC 13 / _storeHeroPhoto). */
function buildAttributionHtml(body) {
    const att = body?.photos?.[0]?.authorAttributions?.[0];
    if (typeof att?.displayName !== 'string' || att.displayName.trim() === '') return null;
    if (typeof att?.uri === 'string' && att.uri.trim() !== '') {
        return `<a href="${escapeHtml(att.uri)}">${escapeHtml(att.displayName)}</a>`;
    }
    return escapeHtml(att.displayName);
}

/** Lowercase hex SHA-1 — derives the reference-unique Storage key (matches _storeHeroPhoto). */
function sha1Hex(s) {
    return crypto.createHash('sha1').update(s, 'utf8').digest('hex');
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Page a PostgREST table fully (limit/offset by 1000) with an arbitrary query string. */
async function fetchAll(pathAndQuery, orderCol) {
    const pageSize = 1000;
    let offset = 0;
    const all = [];
    for (;;) {
        const sep = pathAndQuery.includes('?') ? '&' : '?';
        // Explicit order: PostgREST adds no implicit sort, and offset pagination over an
        // unordered scan can skip/duplicate rows between pages (-157 review WARN).
        const order = orderCol ? `order=${orderCol}&` : '';
        const url = `${SB_URL}/rest/v1/${pathAndQuery}${sep}${order}limit=${pageSize}&offset=${offset}`;
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
 * Mirror of fn_saved_list_cards' cover subquery ordering
 * (migration 20260712210253_list_saves.sql), applied per list:
 *   ORDER BY
 *     CASE WHEN l.ranked THEN le.position END ASC NULLS LAST,
 *     CASE WHEN NOT l.ranked THEN le.created_at END DESC NULLS LAST,
 *     le.id ASC
 *   LIMIT 1
 * Returns the cover-candidate restaurant_id, or null for an empty list.
 * NOTE: le.id is a uuid; Postgres uuid order == lexicographic order of the
 * lowercase canonical text form PostgREST returns, so string compare is exact.
 */
function coverCandidateRestaurantId(entries, ranked) {
    if (!entries || entries.length === 0) return null;
    const sorted = [...entries].sort((a, b) => {
        if (ranked) {
            const pa = a.position ?? null;
            const pb = b.position ?? null;
            if (pa !== pb) {
                if (pa === null) return 1;  // ASC NULLS LAST
                if (pb === null) return -1;
                return pa - pb;             // ASC
            }
        } else {
            const ca = a.created_at ?? null;
            const cb = b.created_at ?? null;
            if (ca !== cb) {
                if (ca === null) return 1;  // DESC NULLS LAST
                if (cb === null) return -1;
                return ca < cb ? 1 : -1;    // DESC
            }
        }
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // le.id ASC
    });
    return sorted[0]?.restaurant_id ?? null;
}

/** Build the deduped candidate restaurant_id set for the chosen priority set. */
async function buildCandidateSet() {
    const candidates = new Set();

    if (CANDIDATE_SET === 'everything') {
        const restaurantRows = await fetchAll('restaurants?select=id', 'id');
        for (const r of restaurantRows) {
            if (r.id) candidates.add(r.id);
        }
        return candidates;
    }

    const entryRows = await fetchAll(
        'list_entries?select=id,list_id,restaurant_id,position,created_at',
        'id',
    );

    if (CANDIDATE_SET === 'all') {
        // Priority set 2: every list-referenced restaurant.
        for (const r of entryRows) {
            if (r.restaurant_id) candidates.add(r.restaurant_id);
        }
        return candidates;
    }

    // Priority set 1 (covers): the single first-entry restaurant per list,
    // computed with the EXACT fn_saved_list_cards ordering.
    const listRows = await fetchAll('lists?select=id,ranked', 'id');
    const rankedByList = new Map(listRows.map((l) => [l.id, !!l.ranked]));
    const entriesByList = new Map();
    for (const e of entryRows) {
        let list = entriesByList.get(e.list_id);
        if (!list) { list = []; entriesByList.set(e.list_id, list); }
        list.push(e);
    }
    for (const [listId, entries] of entriesByList) {
        const rid = coverCandidateRestaurantId(entries, rankedByList.get(listId) ?? false);
        if (rid) candidates.add(rid);
    }
    return candidates;
}

/**
 * Intersect the candidate set with the TICKET-187 coverage predicate. Batch-
 * fetches restaurant rows by id (chunks of 100) — SELECTING `verification`
 * (unlike the -157 precedent) — and filters in memory:
 *   photo_url IS NULL AND photo_source IS NULL AND external_id IS NOT NULL
 *   AND verification = 'verified'.
 * Returns { coverage, ghostsExcluded } and HARD-ASSERTS no ghost survived —
 * the assertion runs in BOTH normal and --refresh-stale modes, dry or real.
 */
async function fetchCoverage(candidateIds) {
    const coverage = [];
    let ghostsExcluded = 0;
    const ids = [...candidateIds];
    for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        const inList = chunk.map((id) => `"${id}"`).join(',');
        const url = `${SB_URL}/rest/v1/restaurants` +
            `?select=id,external_id,photo_url,photo_source,verification,name,city,address` +
            `&id=in.(${inList})`;
        const res = await fetch(url, { headers: REST_HEADERS });
        if (!res.ok) {
            const b = await res.text();
            throw new Error(`Coverage read failed (${res.status}): ${b}`);
        }
        const rows = await res.json();
        for (const r of rows) {
            const photoless = r.photo_url === null && r.photo_source === null && r.external_id != null;
            if (!photoless) continue;
            if (r.verification !== 'verified') {
                // Ghost quarantine: synthetic ghost_* external ids must never reach
                // Google (guaranteed 404 → under --refresh-stale, a Text Search could
                // rewrite external_id and bypass the unverified quarantine).
                ghostsExcluded++;
                continue;
            }
            coverage.push({
                id: r.id,
                external_id: r.external_id,
                name: r.name ?? null,
                city: r.city ?? null,
                address: r.address ?? null,
            });
        }
    }
    // Defensive assertion (both modes): no unverified/ghost row may survive.
    for (const row of coverage) {
        if (typeof row.external_id === 'string' && row.external_id.startsWith('ghost_')) {
            throw new Error(
                `ASSERTION FAILED: ghost external_id ${row.external_id} survived the coverage ` +
                `predicate (id=${row.id}). Aborting before any spend.`,
            );
        }
    }
    return { coverage, ghostsExcluded };
}

/** Place Details — photos-only Essentials mask: photos.name + photos.authorAttributions. */
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
 * Fetch the Places media bytes and upload to Storage. TICKET-187: the object key
 * is REFERENCE-DERIVED — `restaurant-photos/<id>/<sha1(photoName)>.jpg` — so
 * different-reference racers write distinct objects and the exact-URL CAS keeps
 * photo_reference/attribution always matching the persisted photo_url. The
 * upload uses image headers, NOT REST_HEADERS (reusing REST_HEADERS'
 * application/json would store a corrupt object).
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

    const objectPath = `restaurant-photos/${id}/${sha1Hex(photoName)}.jpg`;
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

/**
 * Lenient name overlap — mirrors the app matcher's contract: normalized token
 * containment either direction. Guards the stale-id refresh so a searchText
 * top-hit for a DIFFERENT venue never rewrites external_id.
 */
function namesOverlapLoose(a, b) {
    const tokens = (s) =>
        (s ?? '')
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[^\p{L}\p{N}\s]/gu, '')
            .split(/\s+/)
            .filter((t) => t && t !== 'the');
    const ta = tokens(a);
    const tb = tokens(b);
    if (ta.length === 0 || tb.length === 0) return false;
    const sa = new Set(ta);
    const sb = new Set(tb);
    const contains = (outer, inner) => [...inner].every((t) => outer.has(t));
    return contains(sa, sb) || contains(sb, sa);
}

/**
 * places:searchText refresh for an expired place id — ONE call returns the fresh
 * id AND the photo resources, so no second Details call is needed.
 */
async function searchTextRefresh(name, address, city) {
    const textQuery = [name, address ?? city].filter(Boolean).join(', ');
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
            'X-Goog-Api-Key': PLACES_KEY,
            'X-Goog-FieldMask':
                'places.id,places.displayName,places.formattedAddress,places.photos.name,places.photos.authorAttributions',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ textQuery, maxResultCount: 1 }),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const body = await res.json();
    const place = body?.places?.[0] ?? null;
    if (!place?.id) return { ok: false, status: 'empty' };
    return { ok: true, place };
}

/**
 * CAS UPDATE — swap an expired external_id for the refreshed one. Guarded on the
 * OLD id so a concurrent writer never gets clobbered. A 409 (unique violation:
 * another restaurants row already carries the new id — duplicate venue rows)
 * reports ok:false and the caller skips.
 */
async function updateExternalId(id, oldExternalId, newExternalId) {
    const url = `${SB_URL}/rest/v1/restaurants?id=eq.${id}&external_id=eq.${encodeURIComponent(oldExternalId)}`;
    const res = await fetch(url, {
        method: 'PATCH',
        headers: { ...REST_HEADERS, Prefer: 'return=representation' },
        body: JSON.stringify({ external_id: newExternalId }),
    });
    if (!res.ok) return false;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0;
}

/** CAS UPDATE — stamp the 'none' sentinel (TERMINAL). Guard: photo_url IS NULL. */
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

/** CAS UPDATE — atomic four-column Places write with THIS writer's exact object
 *  URL. Guard: photo_url IS NULL (exact-URL CAS — only one writer's URL wins). */
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

function printEstimates(total) {
    // Per-mode CONSERVATIVE estimates (TICKET-187 P2): never a flat count × $0.024.
    const detailsLine = (total * DETAILS_ESSENTIALS_COST).toFixed(2);
    const mediaLine = (total * PHOTO_MEDIA_COST).toFixed(2);
    const normalTotal = (total * PER_ROW_COST).toFixed(2);
    console.log(`\n  COVERAGE COUNT: ${total} rows to backfill (set=${CANDIDATE_SET})`);
    console.log('  COST ESTIMATE (worst case, verify SKU tiers against current Google pricing):');
    console.log(`    photos-only Place Details (Essentials): ${total} × $${DETAILS_ESSENTIALS_COST.toFixed(3)} ≈ $${detailsLine}`);
    console.log(`    Places Photos media ($7/1000):          ${total} × $${PHOTO_MEDIA_COST.toFixed(3)} ≈ $${mediaLine}`);
    console.log(`    normal-mode total:                       ≈ $${normalTotal}`);
    if (REFRESH_STALE) {
        const staleLine = (total * SEARCH_TEXT_PRO_COST).toFixed(2);
        console.log(`    --refresh-stale: + Text Search (Pro) per Details-404 row — worst case ` +
            `${total} × $${SEARCH_TEXT_PRO_COST.toFixed(3)} ≈ $${staleLine} (only stale rows actually spend this)`);
    }
}

async function main() {
    console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (zero paid calls)' : FORCE ? 'REAL RUN (--force)' : 'REAL RUN'}` +
        `${REFRESH_STALE ? ' + --refresh-stale' : ''} · set=${CANDIDATE_SET}`);
    console.log(CANDIDATE_SET === 'covers'
        ? 'Building candidate set (cover-candidate restaurant per list — exact fn_saved_list_cards ordering)…'
        : CANDIDATE_SET === 'all'
            ? 'Building candidate set (ALL list_entries-referenced restaurants)…'
            : 'Building candidate set (EVERY restaurant — no list join)…');
    const candidates = await buildCandidateSet();
    console.log(`  candidate restaurants (deduped): ${candidates.size}`);

    console.log('Intersecting with coverage predicate (photo_url IS NULL AND photo_source IS NULL ' +
        "AND external_id IS NOT NULL AND verification = 'verified')…");
    const { coverage, ghostsExcluded } = await fetchCoverage(candidates);
    const total = coverage.length;
    console.log(`  GHOST EXCLUSION: ${ghostsExcluded} unverified/ghost row(s) excluded before counting or spending`);
    printEstimates(total);

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
            `Re-run with --force to override.`,
        );
        process.exit(1);
    }

    let attributed = 0;
    let nulled = 0;
    let raced = 0;
    let errors = 0;
    let refreshed = 0;

    for (let i = 0; i < coverage.length; i++) {
        const { id, external_id, name, city, address } = coverage[i];
        const label = `[${i + 1}/${total}] id=${id} external_id=${external_id}`;

        let details = await fetchPlaceDetails(external_id);

        // Expired place id (Details 404 "no longer valid") + --refresh-stale:
        // re-find via searchText, CAS-swap external_id behind the name guard,
        // and reuse the SAME response's photo resources (no second Details).
        if (!details.ok && details.status === 404 && REFRESH_STALE && name) {
            const found = await searchTextRefresh(name, address, city);
            if (!found.ok) {
                console.warn(`${label} → WARN stale id, searchText failed (${found.status}), skipping`);
                errors++;
                await sleep(100);
                continue;
            }
            const foundName = found.place.displayName?.text ?? '';
            if (!namesOverlapLoose(name, foundName)) {
                console.warn(
                    `${label} → WARN stale id, refresh guard REJECTED ("${name}" vs "${foundName}"), skipping`,
                );
                errors++;
                await sleep(100);
                continue;
            }
            const swapped = await updateExternalId(id, external_id, found.place.id);
            if (!swapped) {
                console.warn(`${label} → WARN stale id, external_id CAS/unique miss, skipping`);
                errors++;
                await sleep(100);
                continue;
            }
            console.log(`${label} → refreshed external_id → ${found.place.id} ("${foundName}")`);
            refreshed++;
            details = { ok: true, body: { photos: found.place.photos ?? [] } };
        }

        if (!details.ok) {
            // Transient (or stale without --refresh-stale) → leave NULL, retryable.
            console.warn(`${label} → WARN Place Details http=${details.status}, skipping (photo_source stays NULL)`);
            errors++;
            await sleep(100);
            continue;
        }

        const attribution = buildAttributionHtml(details.body);
        const photoName = details.body?.photos?.[0]?.name ?? null;

        if (!attribution || !photoName) {
            // Genuinely photo-less / unattributable → TERMINAL 'none' sentinel, no media fetch.
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
        else { console.log(`${label} → skipped (CAS miss — raced; orphan object is harmless)`); raced++; }

        await sleep(100);
    }

    console.log('\nBackfill complete.');
    console.log(`  attributed (photo_source='places'): ${attributed}`);
    console.log(`  nulled (sentinel='none'):           ${nulled}`);
    console.log(`  raced (CAS miss, no-op):            ${raced}`);
    console.log(`  refreshed (stale external_id):      ${refreshed}`);
    console.log(`  errors (http/upload):               ${errors}`);
    if (CANDIDATE_SET !== 'everything') {
        console.log('\nRun the OTHER priority set next (--set=covers → --set=all), dry-run first.');
    }
}

main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
});
