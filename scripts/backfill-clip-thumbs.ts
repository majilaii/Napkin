#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
/**
 * backfill-clip-thumbs.ts — one-shot server-side TikTok thumbnail backfill for
 * the On Socials rail (TICKET-156).
 *
 * Run: deno run --allow-net --allow-env --allow-read scripts/backfill-clip-thumbs.ts [--recheck]
 *
 * PURPOSE
 * -------
 * TikTok wishlist saves made before TICKET-156 have no cached cover frame, so the
 * rail renders them typographic. This job re-hits TikTok's OFFICIAL public oEmbed
 * endpoint per stored URL for a fresh thumbnail, downloads the bytes, and caches
 * them to the `clip-thumbs` bucket + a `clip_thumbs` row — the SAME durable store
 * the read action joins.
 *
 * TikTok ONLY. Instagram is deliberately NOT fetched here: instagramPerception's
 * doctrine is that datacenter IPs get walled, so IG backfill runs opportunistically
 * ON-DEVICE during the owner's own sessions (useRestaurantClippings). Old IG rows
 * may simply stay typographic.
 *
 * KEY AUTHORITY
 * -------------
 * Imports contentKey from ../supabase/functions/_shared/videoUrlKey.ts DIRECTLY —
 * the SAME normalizer the capture action and the rail read use. There is no third
 * normalizer; a drift here would orphan every backfilled thumb.
 *
 * IDEMPOTENCY / RESUMABILITY
 * --------------------------
 * - Skips any key already present in clip_thumbs ('cached' OR 'gone').
 * - 404 / deleted video → upsert status 'gone' (permanent skip-marker; never
 *   re-tried → typographic fallback forever).
 * - 429 → exponential backoff, then retry.
 * - Bounded per invocation (MAX_UPLOADS); pages through wishlist_items and stops
 *   early. Re-run to continue — already-processed rows are skipped. Does NOT need
 *   to clear the full backlog in one run.
 * - --recheck scans the same TikTok wishlist URL space, probes only keys whose
 *   current row is 'cached', and marks definitive 404/400 responses 'gone'
 *   without deleting the existing storage object.
 *
 * RATE LIMIT
 * ----------
 * ~10 QPS (100 ms between oEmbed calls), well under TikTok's public tolerance.
 */

import { contentKey } from '../supabase/functions/_shared/videoUrlKey.ts';

const DEFAULT_SB_URL = 'https://ftvmseaqwwlcxtdlvxxz.supabase.co';

// ── Env (mirrors the .mjs backfill precedent: shell env or supabase/.env.local) ──
function loadEnvFromFile(filePath: string): Record<string, string> {
    try {
        const content = Deno.readTextFileSync(filePath);
        const entries: Record<string, string> = {};
        for (const line of content.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eq = trimmed.indexOf('=');
            if (eq === -1) continue;
            entries[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^"|"$/g, '');
        }
        return entries;
    } catch {
        return {};
    }
}

const localEnv = loadEnvFromFile(`${Deno.cwd()}/supabase/.env.local`);
const SB_URL = Deno.env.get('SUPABASE_URL') ?? localEnv.SUPABASE_URL ?? DEFAULT_SB_URL;
const SB_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? localEnv.SUPABASE_SERVICE_ROLE_KEY;

if (!SB_KEY) {
    console.error('Missing SUPABASE_SERVICE_ROLE_KEY. Set in shell or supabase/.env.local.');
    Deno.exit(1);
}

const REST_HEADERS = {
    apikey: SB_KEY,
    Authorization: `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json',
};

const SCAN_PAGE = 200;    // wishlist_items scanned per page
const MAX_SCAN = 5000;    // hard scan ceiling per invocation
const MAX_UPLOADS = 500;  // stop after this many new cache writes (bounded work)
const MAX_RECHECKS = 500; // stop after this many cached videos are rechecked
const RATE_MS = 100;      // ~10 QPS between oEmbed calls

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One page of tiktok wishlist rows (source jsonb). */
async function fetchTikTokPage(offset: number): Promise<Array<{ source: any }>> {
    const url =
        `${SB_URL}/rest/v1/wishlist_items?select=source` +
        `&source->>type=eq.tiktok` +
        `&deleted_at=is.null` +
        `&order=created_at.desc&limit=${SCAN_PAGE}&offset=${offset}`;
    const res = await fetch(url, { headers: REST_HEADERS });
    if (!res.ok) throw new Error(`fetch wishlist_items failed: ${res.status} ${await res.text()}`);
    return res.json();
}

/** Which of these keys already have a clip_thumbs row (any status). */
async function existingKeys(keys: string[]): Promise<Set<string>> {
    if (keys.length === 0) return new Set();
    const inList = keys.map((k) => `"${k}"`).join(',');
    const url = `${SB_URL}/rest/v1/clip_thumbs?select=content_key&content_key=in.(${inList})`;
    const res = await fetch(url, { headers: REST_HEADERS });
    if (!res.ok) throw new Error(`fetch clip_thumbs failed: ${res.status} ${await res.text()}`);
    const rows = (await res.json()) as Array<{ content_key: string }>;
    return new Set(rows.map((r) => r.content_key));
}

/** Which of these keys currently have a cached clip_thumbs row. */
async function cachedKeys(keys: string[]): Promise<Set<string>> {
    if (keys.length === 0) return new Set();
    const inList = keys.map((k) => `"${k}"`).join(',');
    const url =
        `${SB_URL}/rest/v1/clip_thumbs?select=content_key` +
        `&status=eq.cached&content_key=in.(${inList})`;
    const res = await fetch(url, { headers: REST_HEADERS });
    if (!res.ok) throw new Error(`fetch cached clip_thumbs failed: ${res.status} ${await res.text()}`);
    const rows = (await res.json()) as Array<{ content_key: string }>;
    return new Set(rows.map((r) => r.content_key));
}

/** TikTok public oEmbed → fresh thumbnail_url. null on 404 (deleted). */
async function fetchOEmbedThumb(videoUrl: string): Promise<{ status: 'ok'; thumb: string } | { status: 'gone' } | { status: 'retry' }> {
    const endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`;
    const res = await fetch(endpoint);
    if (res.status === 404 || res.status === 400) return { status: 'gone' };
    if (res.status === 429 || res.status >= 500) return { status: 'retry' };
    if (!res.ok) return { status: 'gone' };
    const body = await res.json().catch(() => null);
    const thumb = body?.thumbnail_url;
    if (typeof thumb !== 'string' || !thumb.startsWith('http')) return { status: 'gone' };
    return { status: 'ok', thumb };
}

async function uploadThumb(key: string, bytes: Uint8Array, contentType: string): Promise<boolean> {
    const res = await fetch(`${SB_URL}/storage/v1/object/clip-thumbs/${key}.jpg`, {
        method: 'POST',
        headers: {
            apikey: SB_KEY!,
            Authorization: `Bearer ${SB_KEY}`,
            'Content-Type': contentType || 'image/jpeg',
            'x-upsert': 'true',
        },
        // Cast: the DOM lib's fetch overload narrows BodyInit's ArrayBufferView to
        // Uint8Array<ArrayBuffer>, but arrayBuffer() infers ArrayBufferLike. Valid
        // at runtime (Deno accepts a Uint8Array body).
        body: bytes as unknown as BodyInit,
    });
    return res.ok;
}

async function upsertRow(key: string, status: 'cached' | 'gone', storagePath: string | null): Promise<boolean> {
    const res = await fetch(`${SB_URL}/rest/v1/clip_thumbs`, {
        method: 'POST',
        headers: { ...REST_HEADERS, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({
            content_key: key,
            storage_path: storagePath,
            status,
            source_type: 'tiktok',
            updated_at: new Date().toISOString(),
        }),
    });
    return res.ok;
}

/** Mark a cached row gone without touching storage_path or the storage object. */
async function markCachedRowGone(key: string): Promise<void> {
    const res = await fetch(
        `${SB_URL}/rest/v1/clip_thumbs?content_key=eq.${encodeURIComponent(key)}&status=eq.cached`,
        {
            method: 'PATCH',
            headers: { ...REST_HEADERS, Prefer: 'return=minimal' },
            body: JSON.stringify({
                status: 'gone',
                updated_at: new Date().toISOString(),
            }),
        },
    );
    if (!res.ok) {
        throw new Error(`mark clip_thumb gone failed: ${res.status} ${await res.text()}`);
    }
}

/** Recheck oEmbed liveness without changing a cached row on ambiguous failures. */
async function probeCachedVideo(videoUrl: string): Promise<'gone' | 'live' | 'skipped'> {
    const endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(videoUrl)}`;
    let attempt = 0;
    while (attempt < 4) {
        let res: Response;
        try {
            res = await fetch(endpoint);
        } catch {
            return 'skipped';
        }
        if (res.status === 404 || res.status === 400) return 'gone';
        if (res.status === 429 || res.status >= 500) {
            attempt++;
            if (attempt < 4) await sleep(RATE_MS * Math.pow(4, attempt));
            continue;
        }
        if (res.ok) return 'live';
        return 'skipped';
    }
    return 'skipped';
}

/** Fetch → oEmbed → download → upload → upsert, with 429 backoff. */
async function processVideo(videoUrl: string, key: string): Promise<'cached' | 'gone' | 'error'> {
    let attempt = 0;
    while (attempt < 4) {
        const oembed = await fetchOEmbedThumb(videoUrl);
        if (oembed.status === 'retry') {
            attempt++;
            await sleep(RATE_MS * Math.pow(4, attempt)); // 400ms · 1.6s · 6.4s …
            continue;
        }
        if (oembed.status === 'gone') {
            await upsertRow(key, 'gone', null);
            return 'gone';
        }
        // status ok
        const imgRes = await fetch(oembed.thumb);
        if (!imgRes.ok) return 'error';
        const ct = imgRes.headers.get('content-type') ?? 'image/jpeg';
        if (!ct.startsWith('image/')) return 'error';
        const bytes = new Uint8Array(await imgRes.arrayBuffer());
        if (bytes.length === 0 || bytes.length > 2 * 1024 * 1024) return 'error';
        const up = await uploadThumb(key, bytes, ct);
        if (!up) return 'error';
        const row = await upsertRow(key, 'cached', `${key}.jpg`);
        return row ? 'cached' : 'error';
    }
    return 'error';
}

async function recheckCachedVideos() {
    console.log('TikTok cached clip-thumb recheck starting…');
    let rechecked = 0;
    let newlyGone = 0;
    let stillLive = 0;
    let skipped = 0;
    const seen = new Set<string>();

    // fetchTikTokPage intentionally keeps this mode TikTok-only; Instagram
    // cached rows are never probed from a datacenter IP.
    for (let offset = 0; offset < MAX_SCAN && rechecked < MAX_RECHECKS; offset += SCAN_PAGE) {
        const page = await fetchTikTokPage(offset);
        if (page.length === 0) break;

        const pageKeyed: Array<{ url: string; key: string }> = [];
        for (const row of page) {
            const url = typeof row.source?.url === 'string' ? row.source.url : null;
            if (!url) continue;
            const key = await contentKey(url);
            if (seen.has(key)) continue;
            seen.add(key);
            pageKeyed.push({ url, key });
        }

        const cached = await cachedKeys(pageKeyed.map((p) => p.key));
        for (const { url, key } of pageKeyed) {
            if (rechecked >= MAX_RECHECKS) break;
            if (!cached.has(key)) continue;

            const result = await probeCachedVideo(url);
            rechecked++;
            if (result === 'gone') {
                await markCachedRowGone(key);
                newlyGone++;
                console.log(`  ${key.slice(0, 12)}… → gone (storage retained)`);
            } else if (result === 'live') {
                stillLive++;
            } else {
                skipped++;
            }
            await sleep(RATE_MS);
        }

        if (page.length < SCAN_PAGE) break;
    }

    console.log('\nRecheck run complete.');
    console.log(`  rechecked:   ${rechecked}`);
    console.log(`  newly gone:  ${newlyGone}`);
    console.log(`  still live:  ${stillLive}`);
    console.log(`  skipped:     ${skipped}`);
    if (rechecked >= MAX_RECHECKS) {
        console.log('  (hit MAX_RECHECKS — re-run to continue)');
    }
}

async function main() {
    if (Deno.args.includes('--recheck')) {
        await recheckCachedVideos();
        return;
    }

    console.log('TikTok clip-thumb backfill starting…');
    let scanned = 0;
    let uploads = 0;
    let cached = 0;
    let gone = 0;
    let errors = 0;
    const seen = new Set<string>(); // keys handled this run (dedupe within scan)

    for (let offset = 0; offset < MAX_SCAN && uploads < MAX_UPLOADS; offset += SCAN_PAGE) {
        const page = await fetchTikTokPage(offset);
        if (page.length === 0) break;
        scanned += page.length;

        // Compute keys, dedupe within this run, and skip already-cached/gone.
        const pageKeyed: Array<{ url: string; key: string }> = [];
        for (const row of page) {
            const url = typeof row.source?.url === 'string' ? row.source.url : null;
            if (!url) continue;
            const key = await contentKey(url);
            if (seen.has(key)) continue;
            seen.add(key);
            pageKeyed.push({ url, key });
        }
        const already = await existingKeys(pageKeyed.map((p) => p.key));
        const todo = pageKeyed.filter((p) => !already.has(p.key));

        for (const { url, key } of todo) {
            if (uploads >= MAX_UPLOADS) break;
            const result = await processVideo(url, key);
            if (result === 'cached') { cached++; uploads++; }
            else if (result === 'gone') { gone++; uploads++; }
            else errors++;
            console.log(`  ${key.slice(0, 12)}… → ${result}`);
            await sleep(RATE_MS);
        }

        if (page.length < SCAN_PAGE) break; // last page
    }

    console.log('\nBackfill run complete.');
    console.log(`  scanned rows: ${scanned}`);
    console.log(`  cached:       ${cached}`);
    console.log(`  gone (404):   ${gone}`);
    console.log(`  errors:       ${errors}`);
    if (uploads >= MAX_UPLOADS) {
        console.log('  (hit MAX_UPLOADS — re-run to continue; processed rows are skipped)');
    }
}

main().catch((err) => {
    console.error('Fatal:', err);
    Deno.exit(1);
});
