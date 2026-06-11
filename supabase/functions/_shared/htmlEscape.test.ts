/**
 * htmlEscape.test.ts — TICKET-072
 *
 * Tests for escapeText, escapeAttr, safeHref.
 * Covers hostile input in body and attribute contexts (Codex #4 / ARCH-REVIEW-2 #10).
 */

import { assertEquals, assertStrictEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { escapeText, escapeAttr, safeHref } from './htmlEscape.ts';

// ── escapeText (body context) ─────────────────────────────────────────────────

Deno.test('escapeText: ampersand', () => {
    assertEquals(escapeText('A & B'), 'A &amp; B');
});

Deno.test('escapeText: less-than / greater-than', () => {
    assertEquals(escapeText('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

Deno.test('escapeText: XSS via sharer_name body', () => {
    const hostile = '<script>alert("xss")</script>';
    const escaped = escapeText(hostile);
    assertEquals(escaped.includes('<script>'), false);
    assertEquals(escaped, '&lt;script&gt;alert("xss")&lt;/script&gt;');
});

Deno.test('escapeText: does NOT escape double-quote (body context)', () => {
    assertEquals(escapeText('"hello"'), '"hello"');
});

Deno.test('escapeText: does NOT escape single-quote (body context)', () => {
    assertEquals(escapeText("it's"), "it's");
});

Deno.test('escapeText: empty string', () => {
    assertEquals(escapeText(''), '');
});

Deno.test('escapeText: plain text unchanged', () => {
    assertEquals(escapeText('Jacky Chan'), 'Jacky Chan');
});

// ── escapeAttr (attribute / OG context) ──────────────────────────────────────

Deno.test('escapeAttr: XSS via sharer_name in og:title attribute', () => {
    const hostile = '"onload="alert(1)';
    const escaped = escapeAttr(hostile);
    assertEquals(escaped.includes('"'), false);
    assertEquals(escaped, '&quot;onload=&quot;alert(1)');
});

Deno.test('escapeAttr: escapes all five HTML special chars', () => {
    assertEquals(escapeAttr('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
});

Deno.test('escapeAttr: quote-break injection in meta content attribute', () => {
    const hostile = 'my napkin" /><script>alert(1)</script><meta fake="';
    const escaped = escapeAttr(hostile);
    assertEquals(escaped.includes('"'), false);
    assertEquals(escaped.includes('<script>'), false);
});

Deno.test('escapeAttr: single-quote break injection', () => {
    const hostile = "name' onmouseover='evil";
    const escaped = escapeAttr(hostile);
    assertEquals(escaped.includes("'"), false);
});

Deno.test('escapeAttr: empty string', () => {
    assertEquals(escapeAttr(''), '');
});

// ── safeHref ──────────────────────────────────────────────────────────────────

Deno.test('safeHref: accepts https URL', () => {
    const result = safeHref('https://testflight.apple.com/join/abc123');
    assertEquals(result !== null, true);
    // Should also escape special chars for attribute context
    assertEquals(typeof result, 'string');
});

Deno.test('safeHref: rejects http URL', () => {
    assertStrictEquals(safeHref('http://example.com'), null);
});

Deno.test('safeHref: rejects javascript: scheme', () => {
    assertStrictEquals(safeHref('javascript:alert(1)'), null);
});

Deno.test('safeHref: rejects data: URI', () => {
    assertStrictEquals(safeHref('data:text/html,<script>alert(1)</script>'), null);
});

Deno.test('safeHref: rejects empty string', () => {
    assertStrictEquals(safeHref(''), null);
});

Deno.test('safeHref: rejects non-string', () => {
    assertStrictEquals(safeHref(null), null);
    assertStrictEquals(safeHref(undefined), null);
    assertStrictEquals(safeHref(42), null);
});

Deno.test('safeHref: rejects malformed URL', () => {
    assertStrictEquals(safeHref('not a url'), null);
});

Deno.test('safeHref: escapes attribute-special chars in https URL', () => {
    const url = 'https://example.com/path?a=1&b=2';
    const result = safeHref(url);
    assertEquals(result !== null, true);
    assertEquals(result!.includes('&amp;'), true);
    assertEquals(result!.includes('&'), true); // has &amp;
    assertEquals(result!.split('&amp;').length > 1, true);
});
