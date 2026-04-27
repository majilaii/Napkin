/**
 * parsePlacesAttribution unit tests — TICKET-057 AC 8a.
 *
 * Covers all 8 cases from the design:
 *   1. well-formed single anchor
 *   2. multiple anchors (first wins)
 *   3. no anchor (plain text)
 *   4. HTML entities (&amp;, &#39;)
 *   5. nested tags
 *   6. malformed/unclosed HTML (graceful — no exception)
 *   7. empty input (null, '', whitespace)
 *   8. non-http scheme → href: null, label preserved
 */

import { parsePlacesAttribution } from './parsePlacesAttribution';

describe('parsePlacesAttribution', () => {
    // 1. well-formed single anchor
    test('well-formed anchor: extracts label and href', () => {
        const result = parsePlacesAttribution('<a href="https://x.com/u">Jane Doe</a>');
        expect(result).toEqual({ label: 'Jane Doe', href: 'https://x.com/u' });
    });

    // 2. multiple anchors — first wins
    test('multiple anchors: first wins', () => {
        const result = parsePlacesAttribution(
            '<a href="https://first.com">First</a> and <a href="https://second.com">Second</a>',
        );
        expect(result).toEqual({ label: 'First', href: 'https://first.com' });
    });

    // 3. no anchor — plain text used as non-tappable label
    test('no anchor — plain text: returns label with null href', () => {
        const result = parsePlacesAttribution('Jane Doe');
        expect(result).toEqual({ label: 'Jane Doe', href: null });
    });

    // 4a. HTML entity &amp;
    test('HTML entity &amp; decoded in plain text', () => {
        const result = parsePlacesAttribution('Jane &amp; Co');
        expect(result).toEqual({ label: 'Jane & Co', href: null });
    });

    // 4b. HTML entity &#39; round-trips
    test('HTML entity &#39; decoded in label', () => {
        const result = parsePlacesAttribution('<a href="https://x.com">O&#39;Brien</a>');
        expect(result).toEqual({ label: "O'Brien", href: 'https://x.com' });
    });

    // 5. nested tags inside anchor — stripped to plain text
    test('nested tags inside anchor: stripped to plain text', () => {
        const result = parsePlacesAttribution('<a href="https://x.com"><b>Jane</b></a>');
        expect(result).toEqual({ label: 'Jane', href: 'https://x.com' });
    });

    // 6a. malformed/unclosed anchor tag — graceful, falls through to plain text
    test('unclosed anchor tag: graceful fallback to plain text', () => {
        // No </a> closing tag — anchorRe won't match, falls back to stripTags
        const result = parsePlacesAttribution('<a href="https://x.com">Jane');
        // Falls through to plain-text path: strips the partial open tag, leaves "Jane"
        expect(result).not.toBeNull();
        expect(result?.href).toBeNull();
        expect(result?.label).toBe('Jane');
    });

    // 6b. partial <a tag with no closing >
    test('partial <a with no closing bracket: treated as plain text', () => {
        const result = parsePlacesAttribution('<a Jane Doe');
        // stripTags won't remove the incomplete tag (no >), so the result is the raw string
        // with no anchor matched — graceful (non-null, non-tappable).
        expect(result).not.toBeNull();
        expect(result?.href).toBeNull();
        expect(result?.label.length).toBeGreaterThan(0);
    });

    // Codex review fix: href entity decoding before scheme validation
    test('href with &amp; entity: decoded before passing to Linking.openURL', () => {
        const result = parsePlacesAttribution(
            '<a href="https://example.com/?a=1&amp;b=2">Jane</a>',
        );
        expect(result).toEqual({
            label: 'Jane',
            href: 'https://example.com/?a=1&b=2',
        });
    });

    // 7a. null input
    test('null input: returns null', () => {
        expect(parsePlacesAttribution(null)).toBeNull();
    });

    // 7b. empty string
    test('empty string: returns null', () => {
        expect(parsePlacesAttribution('')).toBeNull();
    });

    // 7c. whitespace-only
    test('whitespace-only: returns null', () => {
        expect(parsePlacesAttribution('   ')).toBeNull();
    });

    // 8. non-http scheme: href set to null, label preserved (AC 8)
    test('javascript: scheme: href null, label preserved', () => {
        const result = parsePlacesAttribution('<a href="javascript:alert(1)">x</a>');
        expect(result).toEqual({ label: 'x', href: null });
    });

    test('data: scheme: href null, label preserved', () => {
        const result = parsePlacesAttribution('<a href="data:text/html,<h1>hi</h1>">label</a>');
        expect(result).toEqual({ label: 'label', href: null });
    });

    // Input > 1024 chars: defensive cap
    test('input longer than 1024 chars: returns null', () => {
        const long = '<a href="https://x.com">'.padEnd(2000, 'a');
        expect(parsePlacesAttribution(long)).toBeNull();
    });

    // Empty label after stripping → null
    test('anchor with empty label: returns null', () => {
        expect(parsePlacesAttribution('<a href="https://x.com">  </a>')).toBeNull();
    });

    // http (not https) is also valid
    test('http:// href is allowed', () => {
        const result = parsePlacesAttribution('<a href="http://maps.google.com/">Google</a>');
        expect(result).toEqual({ label: 'Google', href: 'http://maps.google.com/' });
    });

    // Single-quote href attribute
    test('single-quote href attribute: parsed correctly', () => {
        const result = parsePlacesAttribution("<a href='https://x.com/u'>Jane</a>");
        expect(result).toEqual({ label: 'Jane', href: 'https://x.com/u' });
    });
});
