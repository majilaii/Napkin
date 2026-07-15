/**
 * Tests for socialHost.ts — TS copy of the exact-hostname Instagram predicate
 * (TICKET-189). The SAME fixture table is asserted against the SQL copy
 * (fn_is_instagram_url) in supabase/tests/socials_privacy.spec.sql — the two
 * copies must return byte-identical verdicts on every row.
 *
 * Run with: deno test supabase/functions/_shared/socialHost.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { isInstagramUrl, SOCIAL_HOST_FIXTURES } from './socialHost.ts';

Deno.test('isInstagramUrl: the shared parity fixture table (TS side)', () => {
    for (const [url, expected] of SOCIAL_HOST_FIXTURES) {
        assertEquals(
            isInstagramUrl(url),
            expected,
            `fixture mismatch for ${JSON.stringify(url)} — expected ${expected}`,
        );
    }
});

Deno.test('isInstagramUrl: substring matching stays banned', () => {
    // Explicit re-assertions of the deception rows the old inline regex in
    // restaurant-history ACCEPTED — this file is the tripwire against a
    // regression back to substring matching.
    assertEquals(isInstagramUrl('https://notinstagram.com/x'), false);
    assertEquals(isInstagramUrl('https://example.com/?next=instagram.com/x'), false);
    assertEquals(isInstagramUrl('https://instagram.com@evil.com/x'), false);
    assertEquals(isInstagramUrl('https://instagram.com.evil.com/x'), false);
});

Deno.test('isInstagramUrl: scheme-less input is false even for a real IG host', () => {
    assertEquals(isInstagramUrl('instagram.com/reel/x'), false);
    assertEquals(isInstagramUrl('www.instagram.com/p/x'), false);
    // Leading whitespace makes the raw string scheme-less by contract (1) —
    // new URL() would trim and accept; the SQL regex anchor will not.
    assertEquals(isInstagramUrl(' https://instagram.com/reel/x'), false);
});
