/**
 * Tests for videoUrlKey.ts — the single content-key authority for TICKET-156's
 * On Socials rail (capture / read / backfill all import THIS normalizer, so a
 * drift here orphans every cached thumb). Pure string logic — no network.
 *
 * Run with: deno test supabase/functions/_shared/videoUrlKey.test.ts
 */

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { canonicalizeVideoUrl, contentKey } from './videoUrlKey.ts';

// ── Query params + fragment + trailing slash are stripped (same key) ─────────
Deno.test('tiktok: query params / trailing slash collapse to one key', () => {
    const bare = canonicalizeVideoUrl('https://www.tiktok.com/@topjaw/video/7623328701794520342');
    assertEquals(bare, 'tiktok:7623328701794520342');
    assertEquals(
        canonicalizeVideoUrl('https://www.tiktok.com/@topjaw/video/7623328701794520342?is_from_webapp=1&sender=xyz'),
        bare,
    );
    assertEquals(
        canonicalizeVideoUrl('https://www.tiktok.com/@topjaw/video/7623328701794520342/'),
        bare,
    );
    assertEquals(
        canonicalizeVideoUrl('https://tiktok.com/@topjaw/video/7623328701794520342#comments'),
        bare,
    );
});

Deno.test('tiktok: id-only path (no @user) folds to the same key', () => {
    assertEquals(
        canonicalizeVideoUrl('https://www.tiktok.com/video/7623328701794520342'),
        'tiktok:7623328701794520342',
    );
});

// ── Instagram shortcode: /reel /reels /p /tv + /{user}/ prefix all collapse ──
Deno.test('instagram: reel/p/tv variants + username prefix collapse to one key', () => {
    const key = 'instagram:DGaQ0R0sbQ0';
    assertEquals(canonicalizeVideoUrl('https://www.instagram.com/reel/DGaQ0R0sbQ0/'), key);
    assertEquals(canonicalizeVideoUrl('https://www.instagram.com/reels/DGaQ0R0sbQ0/'), key);
    assertEquals(canonicalizeVideoUrl('https://instagram.com/p/DGaQ0R0sbQ0'), key);
    assertEquals(canonicalizeVideoUrl('https://www.instagram.com/tv/DGaQ0R0sbQ0/'), key);
    assertEquals(canonicalizeVideoUrl('https://www.instagram.com/topjaw/reel/DGaQ0R0sbQ0/'), key);
    assertEquals(
        canonicalizeVideoUrl('https://www.instagram.com/reel/DGaQ0R0sbQ0/?igsh=abc123'),
        key,
    );
});

Deno.test('instagram: shortcode case is preserved (case-sensitive identifier)', () => {
    // A lowercased shortcode is a DIFFERENT video — must not collapse.
    assert(
        canonicalizeVideoUrl('https://www.instagram.com/reel/DGaQ0R0sbQ0/') !==
            canonicalizeVideoUrl('https://www.instagram.com/reel/dgaq0r0sbq0/'),
    );
});

// ── N3: shortlinks canNOT be resolved → distinct key from the full URL ───────
Deno.test('N3: tiktok shortlink and full URL produce DIFFERENT keys (accepted)', () => {
    const short = canonicalizeVideoUrl('https://vm.tiktok.com/ZGeAbc123/');
    const full = canonicalizeVideoUrl('https://www.tiktok.com/@topjaw/video/7623328701794520342');
    assert(short !== full, 'shortlink must not (cannot) collapse to the full-URL key');
    // But two identical shortlinks still collapse to one key.
    assertEquals(
        canonicalizeVideoUrl('https://vm.tiktok.com/ZGeAbc123/'),
        canonicalizeVideoUrl('https://vm.tiktok.com/ZGeAbc123?_r=1'),
    );
});

// ── Non-provider URLs: host+path, www-stripped, lowercased ───────────────────
Deno.test('web: strips www, query, fragment, trailing slash', () => {
    const a = canonicalizeVideoUrl('https://www.example.com/food/best-spots/?ref=x#top');
    assertEquals(a, 'example.com/food/best-spots');
    assertEquals(canonicalizeVideoUrl('https://example.com/food/best-spots'), a);
});

Deno.test('unparseable input degrades without throwing', () => {
    assertEquals(canonicalizeVideoUrl('not a url'), 'not a url');
    assertEquals(canonicalizeVideoUrl(''), '');
});

// ── contentKey: deterministic 64-char hex, matches for equivalent URLs ───────
Deno.test('contentKey: deterministic sha-256 hex, equal for equivalent URLs', async () => {
    const k1 = await contentKey('https://www.tiktok.com/@topjaw/video/7623328701794520342?x=1');
    const k2 = await contentKey('https://tiktok.com/@topjaw/video/7623328701794520342/');
    assertEquals(k1, k2);
    assert(/^[0-9a-f]{64}$/.test(k1), 'key must be 64 hex chars');
});

Deno.test('contentKey: different videos → different keys', async () => {
    const a = await contentKey('https://www.instagram.com/reel/AAAAAAAAAAA/');
    const b = await contentKey('https://www.instagram.com/reel/BBBBBBBBBBB/');
    assert(a !== b);
});
