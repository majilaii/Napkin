/**
 * TICKET-053 step 2 — validator unit tests for validateWishlistSource + validateUrl.
 * Run with: deno test --allow-env supabase/functions/
 */
import { assertEquals, assertNotStrictEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { validateWishlistSource } from '../_shared/wishlistSource.ts';
import { validateUrl } from '../_shared/urlValidation.ts';

// ── validateWishlistSource ──────────────────────────────────────────────────

Deno.test('validateWishlistSource: tiktok happy path', () => {
    const input: Record<string, unknown> = {
        type: 'tiktok',
        url: 'https://www.tiktok.com/@user/video/123',
        thumbnail_url: 'https://p16.tiktok.com/img.jpg',
        author_handle: 'user',
        author_name: 'User Name',
        embed_product_id: 'abc123',
    };
    const result = validateWishlistSource(input);
    assertEquals(result.ok, true);
    const ok = result as Extract<typeof result, { ok: true }>;
    assertEquals(ok.source.type, 'tiktok');
    assertEquals((ok.source as any).url, input['url'] as string);
    // Returned object is freshly constructed (not reference-equal to input)
    assertNotStrictEquals(ok.source as unknown, input);
});

Deno.test('validateWishlistSource: tiktok minimal (no optional fields)', () => {
    const input: Record<string, unknown> = { type: 'tiktok', url: 'https://tiktok.com/@u/video/1' };
    const result = validateWishlistSource(input);
    assertEquals(result.ok, true);
    const ok = result as Extract<typeof result, { ok: true }>;
    assertEquals(ok.source.type, 'tiktok');
    // Optional fields absent — not set on output
    assertEquals('thumbnail_url' in ok.source, false);
    assertNotStrictEquals(ok.source as unknown, input);
});

Deno.test('validateWishlistSource: google_maps happy path', () => {
    const input: Record<string, unknown> = { type: 'google_maps', url: 'https://maps.app.goo.gl/abc', place_id: 'ChIJ123' };
    const result = validateWishlistSource(input);
    assertEquals(result.ok, true);
    const ok = result as Extract<typeof result, { ok: true }>;
    assertEquals(ok.source.type, 'google_maps');
    assertNotStrictEquals(ok.source as unknown, input);
});

Deno.test('validateWishlistSource: web happy path', () => {
    const input: Record<string, unknown> = { type: 'web', url: 'https://example.com', title: 'Best Pasta' };
    const result = validateWishlistSource(input);
    assertEquals(result.ok, true);
    const ok = result as Extract<typeof result, { ok: true }>;
    assertEquals(ok.source.type, 'web');
    assertNotStrictEquals(ok.source as unknown, input);
});

Deno.test('validateWishlistSource: extra key rejected (tiktok + embed_html)', () => {
    const input: Record<string, unknown> = { type: 'tiktok', url: 'https://tiktok.com/v/1', embed_html: '<blockquote>...</blockquote>' };
    const result = validateWishlistSource(input);
    assertEquals(result.ok, false);
    const err = result as Extract<typeof result, { ok: false }>;
    assertEquals(err.reason, 'extra_keys');
    assertEquals((err.extra_keys ?? []).includes('embed_html'), true);
});

Deno.test('validateWishlistSource: extra key rejected (google_maps)', () => {
    const input: Record<string, unknown> = { type: 'google_maps', url: 'https://maps.google.com', place_id: 'abc', extra: 'bad' };
    const result = validateWishlistSource(input);
    assertEquals(result.ok, false);
    const err = result as Extract<typeof result, { ok: false }>;
    assertEquals(err.reason, 'extra_keys');
});

Deno.test('validateWishlistSource: missing type rejected', () => {
    const result = validateWishlistSource({ url: 'https://example.com' });
    assertEquals(result.ok, false);
    const err = result as Extract<typeof result, { ok: false }>;
    assertEquals(err.reason, 'missing_type');
});

Deno.test('validateWishlistSource: missing url rejected', () => {
    const result = validateWishlistSource({ type: 'web' });
    assertEquals(result.ok, false);
    const err = result as Extract<typeof result, { ok: false }>;
    assertEquals(err.reason, 'missing_url');
});

Deno.test('validateWishlistSource: unknown type rejected', () => {
    const result = validateWishlistSource({ type: 'instagram', url: 'https://instagram.com' });
    assertEquals(result.ok, false);
    const err = result as Extract<typeof result, { ok: false }>;
    assertEquals(err.reason, 'unknown_type');
});

Deno.test('validateWishlistSource: explicit null on optional field rejected', () => {
    const result = validateWishlistSource({ type: 'tiktok', url: 'https://tiktok.com/v/1', thumbnail_url: null });
    assertEquals(result.ok, false);
});

Deno.test('validateWishlistSource: array top-level rejected', () => {
    const result = validateWishlistSource([{ type: 'web', url: 'https://x.com' }]);
    assertEquals(result.ok, false);
    const err = result as Extract<typeof result, { ok: false }>;
    assertEquals(err.reason, 'not_an_object');
});

Deno.test('validateWishlistSource: wrong type for optional field rejected (tiktok)', () => {
    const result = validateWishlistSource({ type: 'tiktok', url: 'https://t.co', thumbnail_url: 42 });
    assertEquals(result.ok, false);
});

// ── TICKET-060: screenshot + vision variants ────────────────────────────────

Deno.test('validateWishlistSource: screenshot happy path (no url required)', () => {
    const input: Record<string, unknown> = {
        type: 'screenshot',
        upload_path: 'user123/1234567890-abc.jpg',
        caption: 'Joe Beef in Montreal',
    };
    const result = validateWishlistSource(input);
    assertEquals(result.ok, true);
    const ok = result as Extract<typeof result, { ok: true }>;
    assertEquals(ok.source.type, 'screenshot');
    assertNotStrictEquals(ok.source as unknown, input);
});

Deno.test('validateWishlistSource: screenshot missing upload_path rejected', () => {
    const result = validateWishlistSource({ type: 'screenshot' });
    assertEquals(result.ok, false);
    const err = result as Extract<typeof result, { ok: false }>;
    assertEquals(err.reason, 'missing_upload_path');
});

Deno.test('validateWishlistSource: screenshot extra key rejected', () => {
    const result = validateWishlistSource({ type: 'screenshot', upload_path: 'a/b.jpg', bad_key: 'nope' });
    assertEquals(result.ok, false);
    const err = result as Extract<typeof result, { ok: false }>;
    assertEquals(err.reason, 'extra_keys');
});

Deno.test('validateWishlistSource: vision happy path (all optional fields)', () => {
    const input: Record<string, unknown> = {
        type: 'vision',
        source_url: 'https://www.tiktok.com/@user/video/123',
        upload_path: 'user/abc.jpg',
        caption: 'great place',
    };
    const result = validateWishlistSource(input);
    assertEquals(result.ok, true);
    const ok = result as Extract<typeof result, { ok: true }>;
    assertEquals(ok.source.type, 'vision');
});

Deno.test('validateWishlistSource: vision with no fields is valid (all optional)', () => {
    const result = validateWishlistSource({ type: 'vision' });
    assertEquals(result.ok, true);
    const ok = result as Extract<typeof result, { ok: true }>;
    assertEquals(ok.source.type, 'vision');
});

Deno.test('validateWishlistSource: vision extra key rejected', () => {
    const result = validateWishlistSource({ type: 'vision', source_url: 'https://x.com', bad: true });
    assertEquals(result.ok, false);
});

// ── validateUrl ─────────────────────────────────────────────────────────────

Deno.test('validateUrl: valid https URL', () => {
    const result = validateUrl('https://www.google.com/maps/place/Nobu');
    assertEquals(result.ok, true);
});

Deno.test('validateUrl: valid http URL', () => {
    const result = validateUrl('http://restaurant.com');
    assertEquals(result.ok, true);
});

Deno.test('validateUrl: javascript: scheme rejected', () => {
    const result = validateUrl('javascript:alert(1)');
    assertEquals(result.ok, false);
    const err = result as Extract<typeof result, { ok: false }>;
    assertEquals(err.reason === 'scheme' || err.reason === 'parse', true);
});

Deno.test('validateUrl: data: scheme rejected', () => {
    const result = validateUrl('data:text/html,<h1>hello</h1>');
    assertEquals(result.ok, false);
});

Deno.test('validateUrl: length > 2048 rejected', () => {
    const long = 'https://example.com/' + 'a'.repeat(2100);
    const result = validateUrl(long);
    assertEquals(result.ok, false);
    const err = result as Extract<typeof result, { ok: false }>;
    assertEquals(err.reason, 'length');
});

Deno.test('validateUrl: localhost rejected', () => {
    const result = validateUrl('https://localhost:3000/api');
    assertEquals(result.ok, false);
    const err = result as Extract<typeof result, { ok: false }>;
    assertEquals(err.reason, 'host');
});

Deno.test('validateUrl: 127.0.0.1 rejected', () => {
    const result = validateUrl('http://127.0.0.1:8080/');
    assertEquals(result.ok, false);
    const err = result as Extract<typeof result, { ok: false }>;
    assertEquals(err.reason, 'host');
});

Deno.test('validateUrl: 192.168.x.x rejected', () => {
    const result = validateUrl('https://192.168.1.1/admin');
    assertEquals(result.ok, false);
    const err = result as Extract<typeof result, { ok: false }>;
    assertEquals(err.reason, 'host');
});

Deno.test('validateUrl: bare IPv4 rejected', () => {
    const result = validateUrl('https://1.2.3.4/page');
    assertEquals(result.ok, false);
    const err = result as Extract<typeof result, { ok: false }>;
    assertEquals(err.reason, 'host');
});

Deno.test('validateUrl: unparseable string rejected', () => {
    const result = validateUrl('not a url at all');
    assertEquals(result.ok, false);
    const err = result as Extract<typeof result, { ok: false }>;
    assertEquals(err.reason, 'parse');
});
