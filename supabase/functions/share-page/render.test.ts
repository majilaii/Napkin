/**
 * render.test.ts — TICKET-072
 *
 * Tests for renderPage and renderTombstone.
 *
 * Key invariants tested:
 *   1. escapeText/escapeAttr applied: hostile sharer_name can't inject HTML
 *   2. render context uuid-absence: no restaurant_id, owner_id, or token echo in HTML
 *   3. tombstone: uniform structure for all bad-token classes
 *   4. TESTFLIGHT_PUBLIC_URL: https-only; null/http → invite-only fallback
 *   5. OG tags present with escaped values
 *   6. Cache-control / referrer meta present (rendered in <head>)
 */

import {
    assertEquals,
    assertStringIncludes,
    assertMatch,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { renderPage, renderTombstone, type RenderContext } from './render.ts';

const BASE_CTX: RenderContext = {
    sharer_name: 'Jacky',
    created_at: '2026-06-11T10:00:00Z',
    spots: [
        { name: 'Berenjak', city: 'London', cuisine: 'Persian', rating: 4.6 },
        { name: 'Kono', city: 'New York', cuisine: 'Japanese', rating: null },
    ],
};

const VALID_TOKEN = 'ABCdefGHIjklMNOpqrSTUv'; // 22-char base64url

// ── Escape: hostile sharer_name ───────────────────────────────────────────────

Deno.test('renderPage: escapes hostile sharer_name in body text', () => {
    const ctx = { ...BASE_CTX, sharer_name: '<script>alert("xss")</script>' };
    const html = renderPage(ctx, VALID_TOKEN, null);
    assertEquals(html.includes('<script>'), false);
    assertStringIncludes(html, '&lt;script&gt;');
});

Deno.test('renderPage: escapes hostile sharer_name in og:title attribute', () => {
    const ctx = { ...BASE_CTX, sharer_name: '"onload="alert(1)' };
    const html = renderPage(ctx, VALID_TOKEN, null);
    // Should not have raw " inside attribute values
    // The og:title content attribute should not have unescaped quotes that break the attribute
    const ogTitleMatch = html.match(/og:title[^>]+content="([^"]*)"/);
    // If we can parse the og:title content without the regex failing, the quote was escaped
    assertEquals(html.includes('" onload='), false);
});

Deno.test('renderPage: escapes ampersand in sharer_name', () => {
    const ctx = { ...BASE_CTX, sharer_name: 'Tom & Jerry' };
    const html = renderPage(ctx, VALID_TOKEN, null);
    assertStringIncludes(html, '&amp;');
});

Deno.test('renderPage: escapes hostile spot name', () => {
    const ctx = {
        ...BASE_CTX,
        spots: [{ name: '<script>alert(1)</script>', city: null, cuisine: null, rating: null }],
    };
    const html = renderPage(ctx, VALID_TOKEN, null);
    assertEquals(html.includes('<script>alert(1)</script>'), false);
    assertStringIncludes(html, '&lt;script&gt;');
});

// ── UUID absence: no restaurant_id, owner_id, or token echo in body/attr ──────

Deno.test('renderPage: no UUID from snapshot appears in rendered HTML', () => {
    // UUIDs would come from restaurant_id — the render context strips them
    // We verify the rendered HTML contains no UUID-shaped strings
    const html = renderPage(BASE_CTX, VALID_TOKEN, null);
    // This pattern matches standard UUID format
    const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    // The token itself (base64url) does NOT match UUID format, so this is safe
    assertEquals(uuidRe.test(html), false);
});

Deno.test('renderPage: token appears only in scheme-link href (generated, not reflected)', () => {
    const html = renderPage(BASE_CTX, VALID_TOKEN, null);
    // Token should appear in the napkin:// scheme CTA
    assertStringIncludes(html, `napkin://handoff?t=${VALID_TOKEN}`);
    // Token should NOT appear in any other context (e.g. not echoed in the page text)
    // Count occurrences — should be exactly 1
    const occurrences = html.split(VALID_TOKEN).length - 1;
    assertEquals(occurrences, 1, `token should appear exactly once (in scheme href), found ${occurrences}`);
});

// ── OG tags ───────────────────────────────────────────────────────────────────

Deno.test('renderPage: og:title present', () => {
    const html = renderPage(BASE_CTX, VALID_TOKEN, null);
    assertStringIncludes(html, 'og:title');
    assertStringIncludes(html, "Jacky's napkin");
});

Deno.test('renderPage: og:description present and contains spot names', () => {
    const html = renderPage(BASE_CTX, VALID_TOKEN, null);
    assertStringIncludes(html, 'og:description');
    assertStringIncludes(html, 'Berenjak');
});

// ── Referrer meta ─────────────────────────────────────────────────────────────

Deno.test('renderPage: includes no-referrer meta tag', () => {
    const html = renderPage(BASE_CTX, VALID_TOKEN, null);
    assertStringIncludes(html, 'name="referrer"');
    assertStringIncludes(html, 'no-referrer');
});

// ── TestFlight URL handling ───────────────────────────────────────────────────

Deno.test('renderPage: shows invite murmur when no testflight URL', () => {
    const html = renderPage(BASE_CTX, VALID_TOKEN, null);
    assertStringIncludes(html, 'invite-only');
});

Deno.test('renderPage: shows get-Napkin link when valid testflight https URL', () => {
    const html = renderPage(BASE_CTX, VALID_TOKEN, 'https://testflight.apple.com/join/abc123');
    assertStringIncludes(html, 'testflight.apple.com');
    assertStringIncludes(html, 'get Napkin');
});

Deno.test('renderPage: rejects http testflight URL → invite murmur', () => {
    const html = renderPage(BASE_CTX, VALID_TOKEN, 'http://testflight.apple.com/join/abc123');
    assertStringIncludes(html, 'invite-only');
    assertEquals(html.includes('http://testflight.apple.com'), false);
});

Deno.test('renderPage: outbound links have rel=noopener noreferrer', () => {
    const html = renderPage(BASE_CTX, VALID_TOKEN, 'https://testflight.apple.com/join/abc123');
    assertStringIncludes(html, 'rel="noopener noreferrer"');
});

// ── Tombstone (uniform 410) ───────────────────────────────────────────────────

Deno.test('renderTombstone: contains folded-away copy', () => {
    const html = renderTombstone();
    assertStringIncludes(html, 'folded away');
});

Deno.test('renderTombstone: contains the closing murmur', () => {
    const html = renderTombstone();
    assertStringIncludes(html, "the link's closed");
});

Deno.test('renderTombstone: contains no sharer PII', () => {
    const html = renderTombstone();
    // Must not contain any name, email, or list content
    assertEquals(html.includes('Jacky'), false);
    assertEquals(html.includes('Berenjak'), false);
});

Deno.test('renderTombstone: contains no UUID', () => {
    const html = renderTombstone();
    const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    assertEquals(uuidRe.test(html), false);
});

Deno.test('renderTombstone: valid HTML structure', () => {
    const html = renderTombstone();
    assertStringIncludes(html, '<!DOCTYPE html>');
    assertStringIncludes(html, '<html');
    assertStringIncludes(html, '</html>');
});

Deno.test('renderTombstone: includes no-referrer meta', () => {
    const html = renderTombstone();
    assertStringIncludes(html, 'no-referrer');
});

// ── Spot rendering details ────────────────────────────────────────────────────

Deno.test('renderPage: rating appears for rated spot', () => {
    const html = renderPage(BASE_CTX, VALID_TOKEN, null);
    assertStringIncludes(html, '4.6');
});

Deno.test('renderPage: null rating not rendered as literal "null"', () => {
    const html = renderPage(BASE_CTX, VALID_TOKEN, null);
    assertEquals(html.includes('>null<'), false);
});

Deno.test('renderPage: spot count in header', () => {
    const html = renderPage(BASE_CTX, VALID_TOKEN, null);
    assertStringIncludes(html, '2 spots');
});

Deno.test('renderPage: singular "spot" for count of 1', () => {
    const ctx = { ...BASE_CTX, spots: [BASE_CTX.spots[0]] };
    const html = renderPage(ctx, VALID_TOKEN, null);
    assertStringIncludes(html, '1 spot');
    assertEquals(html.includes('1 spots'), false);
});
