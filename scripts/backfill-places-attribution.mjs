#!/usr/bin/env node
/**
 * backfill-places-attribution.mjs — one-shot Places attribution backfill.
 *
 * Run: node scripts/backfill-places-attribution.mjs
 *
 * PURPOSE
 * -------
 * Rows in `public.restaurants` that were mirrored from Google Places before
 * TICKET-057 (migration 20260505000000) have photo_url set but no
 * places_photo_attribution_html or photo_source. Google ToS requires we
 * display attribution whenever we show a Places photo. This script resolves
 * each such row by re-fetching Place Details for authorAttributions.
 *
 * ROW-FILTER SQL (verified against _storeHeroPhoto's actual write path)
 * -----------------------------------------------------------------------
 * SELECT id, external_id, photo_url
 *   FROM public.restaurants
 *  WHERE photo_url IS NOT NULL
 *    AND places_photo_attribution_html IS NULL
 *    AND photo_source IS NULL
 *    AND photo_url LIKE '%/restaurant-photos/%'
 *  ORDER BY id;
 *
 * The '/restaurant-photos/' prefix is the Storage bucket name used by
 * _storeHeroPhoto in supabase/functions/_shared/restaurant.ts (grep:
 *   supabase.storage.from('restaurant-photos').upload(...)
 * ). This scopes detection to Places-mirrored URLs and never reclassifies
 * user/Table-uploaded photos.
 *
 * BRANCHES (per row)
 * ------------------
 * Non-empty attribution → UPDATE places_photo_attribution_html + photo_source='places'
 *   WHERE id=? AND photo_source IS NULL AND photo_url=$original (CAS guard)
 *
 * Empty/missing attribution → UPDATE photo_url=NULL + photo_source='none'
 *   WHERE id=? AND photo_source IS NULL AND photo_url=$original AND photo_url LIKE '%/restaurant-photos/%'
 *   (compliance: no Places photo without credit; stamps 'none' so lazy-backfill
 *   trigger in app/restaurant/[id].tsx does not re-fire on every page visit)
 *
 * IDEMPOTENCY
 * -----------
 * - WHERE clauses include photo_source IS NULL so re-runs skip already-classified rows.
 * - CAS guard (photo_url = $original) means a concurrent user/Table write between
 *   SELECT and UPDATE simply causes a no-op — never destructive.
 * - The 'none' sentinel excludes rows from the SELECT filter on re-runs.
 *
 * RATE LIMIT
 * ----------
 * 100 ms delay between Place Details requests → ~10 QPS (well under the
 * default 100 QPS quota). At 10 QPS, 2k rows ≈ 3.3 minutes. Safe to Ctrl-C
 * and re-run (idempotent).
 *
 * PLACES FIELD MASK
 * -----------------
 * photos.authorAttributions only — minimal field, saves quota.
 * We do NOT re-fetch photos themselves; we only need the attribution metadata.
 */

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_SB_URL = 'https://ftvmseaqwwlcxtdlvxxz.supabase.co';

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
if (!PLACES_KEY) {
    console.error('Missing GOOGLE_PLACES_API_KEY. Set in shell or supabase/.env.local.');
    process.exit(1);
}

const REST_HEADERS = {
    apikey: SB_KEY,
    Authorization: `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json',
};

/** Minimal HTML escaper — mirrors the one in places-search/index.ts. */
function escapeHtml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Sleep helper for rate limiting. */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Fetch rows to backfill via Supabase REST API. */
async function fetchRows() {
    // Filter: photo_url set, attribution not set, photo_source not set,
    // and URL contains '/restaurant-photos/' (Places-mirrored Storage bucket).
    const url = new URL(`${SB_URL}/rest/v1/restaurants`);
    url.searchParams.set('select', 'id,external_id,photo_url');
    url.searchParams.set('photo_url', 'not.is.null');
    url.searchParams.set('places_photo_attribution_html', 'is.null');
    url.searchParams.set('photo_source', 'is.null');
    url.searchParams.set('photo_url', 'like.*%2Frestaurant-photos%2F*');
    url.searchParams.set('order', 'id');

    // Use raw SQL filter via Supabase PostgREST for the LIKE + IS NULL combo.
    // PostgREST: photo_url=like.*...* and photo_source=is.null
    const filterUrl = `${SB_URL}/rest/v1/restaurants?select=id,external_id,photo_url` +
        `&photo_url=not.is.null` +
        `&places_photo_attribution_html=is.null` +
        `&photo_source=is.null` +
        `&photo_url=like.*restaurant-photos*` +
        `&order=id`;

    const res = await fetch(filterUrl, { headers: REST_HEADERS });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Failed to fetch rows: ${res.status} ${body}`);
    }
    return res.json();
}

/** Fetch Place Details — attribution only. */
async function fetchAttribution(externalId) {
    const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(externalId)}`;
    const res = await fetch(url, {
        headers: {
            'X-Goog-Api-Key': PLACES_KEY,
            'X-Goog-FieldMask': 'photos.authorAttributions',
        },
    });
    if (!res.ok) {
        const status = res.status;
        return { ok: false, status };
    }
    const body = await res.json();
    return { ok: true, body };
}

/** Build attribution HTML string from authorAttributions — first only (AC 13). */
function buildAttributionHtml(body) {
    const att = body?.photos?.[0]?.authorAttributions?.[0];
    if (!att?.displayName) return null;
    if (att.uri) {
        return `<a href="${escapeHtml(att.uri)}">${escapeHtml(att.displayName)}</a>`;
    }
    return escapeHtml(att.displayName);
}

/** UPDATE row with Places attribution. CAS guard: photo_source IS NULL AND photo_url = $original. */
async function stampAttribution(id, attribution, originalPhotoUrl) {
    const url = `${SB_URL}/rest/v1/restaurants?id=eq.${id}&photo_source=is.null` +
        `&photo_url=eq.${encodeURIComponent(originalPhotoUrl)}`;
    const res = await fetch(url, {
        method: 'PATCH',
        headers: { ...REST_HEADERS, Prefer: 'return=minimal' },
        body: JSON.stringify({
            places_photo_attribution_html: attribution,
            photo_source: 'places',
        }),
    });
    return res.ok;
}

/** UPDATE row to null out photo_url + stamp sentinel 'none'. CAS guard included. */
async function stampNone(id, originalPhotoUrl) {
    // Extra guard: only null out URLs that look like Places-mirrored Storage paths.
    const url = `${SB_URL}/rest/v1/restaurants?id=eq.${id}&photo_source=is.null` +
        `&photo_url=eq.${encodeURIComponent(originalPhotoUrl)}` +
        `&photo_url=like.*restaurant-photos*`;
    const res = await fetch(url, {
        method: 'PATCH',
        headers: { ...REST_HEADERS, Prefer: 'return=minimal' },
        body: JSON.stringify({
            photo_url: null,
            photo_source: 'none',
        }),
    });
    return res.ok;
}

async function main() {
    console.log('Fetching rows to backfill...');
    const rows = await fetchRows();
    const total = rows.length;
    console.log(`Found ${total} rows to process.`);
    if (total === 0) {
        console.log('Nothing to do.');
        return;
    }

    let attributed = 0;
    let nulled = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const n = i + 1;
        const label = `[${n}/${total}] id=${row.id} external_id=${row.external_id}`;

        if (!row.external_id) {
            console.log(`${label} → skipped (no external_id)`);
            skipped++;
            await sleep(100);
            continue;
        }

        const result = await fetchAttribution(row.external_id);

        if (!result.ok) {
            console.warn(`${label} → WARN http=${result.status}, skipping`);
            errors++;
            await sleep(100);
            continue;
        }

        const attribution = buildAttributionHtml(result.body);

        if (attribution) {
            const ok = await stampAttribution(row.id, attribution, row.photo_url);
            if (ok) {
                console.log(`${label} → attributed`);
                attributed++;
            } else {
                console.log(`${label} → skipped (raced — CAS miss or already classified)`);
                skipped++;
            }
        } else {
            // No attribution — null out photo and stamp sentinel.
            const ok = await stampNone(row.id, row.photo_url);
            if (ok) {
                console.log(`${label} → nulled (sentinel='none')`);
                nulled++;
            } else {
                console.log(`${label} → skipped (raced — CAS miss or already classified)`);
                skipped++;
            }
        }

        // Rate limit: ~10 QPS
        await sleep(100);
    }

    console.log('\nBackfill complete.');
    console.log(`  attributed: ${attributed}`);
    console.log(`  nulled (sentinel='none'): ${nulled}`);
    console.log(`  skipped: ${skipped}`);
    console.log(`  errors (http): ${errors}`);
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
