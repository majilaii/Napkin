/**
 * Tests for socialsLadder.ts — rung boundaries + window-honest platform labels
 * + the deterministic rail-kicker reduction (TICKET-189).
 *
 * Run with: deno test supabase/functions/_shared/socialsLadder.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
    reduceRailKicker,
    resolveSocialsLadder,
    type SocialsLadderInput,
} from './socialsLadder.ts';

function input(partial: Partial<SocialsLadderInput>): SocialsLadderInput {
    return {
        k7: 0,
        k30: 0,
        platform_7d: 'none',
        platform_30d: 'none',
        rep_source_type: 'tiktok',
        ...partial,
    };
}

// ── Rung boundaries ───────────────────────────────────────────────────────────

Deno.test('k7=3 → rung 1 / week, uses the 7d platform fact', () => {
    const r = resolveSocialsLadder(
        input({ k7: 3, k30: 5, platform_7d: 'tiktok', platform_30d: 'mixed' }),
    );
    assertEquals(r, { rung: 1, window: 'week', count: 3, platform: 'tiktok' });
});

Deno.test('k7=2, k30=3 → rung 2 / month, uses the 30d platform fact', () => {
    const r = resolveSocialsLadder(
        input({ k7: 2, k30: 3, platform_7d: 'tiktok', platform_30d: 'instagram' }),
    );
    assertEquals(r, { rung: 2, window: 'month', count: 3, platform: 'instagram' });
});

Deno.test('k7=2, k30=2 → rung 3: no count, no window, rep-clip platform', () => {
    const r = resolveSocialsLadder(
        input({ k7: 2, k30: 2, platform_7d: 'mixed', platform_30d: 'mixed', rep_source_type: 'instagram' }),
    );
    assertEquals(r, { rung: 3, window: null, count: null, platform: 'instagram' });
});

Deno.test('the selected window names its OWN platform — monthly never inherits the weekly fact', () => {
    // 7d rows were tiktok-only, but the 30d population is mixed: a demoted
    // monthly card must say 'socials' (the 30d fact), never 'tiktok'.
    const r = resolveSocialsLadder(
        input({ k7: 1, k30: 4, platform_7d: 'tiktok', platform_30d: 'mixed' }),
    );
    assertEquals(r.window, 'month');
    assertEquals(r.platform, 'socials');
});

Deno.test('mixed platform fact → the neutral socials label (never one platform for a combined count)', () => {
    const r = resolveSocialsLadder(
        input({ k7: 4, k30: 6, platform_7d: 'mixed', platform_30d: 'mixed' }),
    );
    assertEquals(r.platform, 'socials');
});

Deno.test('single-platform fact names the platform', () => {
    assertEquals(
        resolveSocialsLadder(input({ k7: 3, k30: 3, platform_7d: 'instagram', platform_30d: 'instagram' })).platform,
        'instagram',
    );
});

Deno.test('k floor is exactly 3 — k=2 in both windows never shows a count', () => {
    const r = resolveSocialsLadder(input({ k7: 2, k30: 2, platform_7d: 'tiktok', platform_30d: 'tiktok' }));
    assertEquals(r.count, null);
    assertEquals(r.rung, 3);
});

// ── reduceRailKicker — mixed-rung rails (Codex P1) ────────────────────────────

Deno.test('reduceRailKicker: [rung1, rung2] → this month', () => {
    assertEquals(reduceRailKicker([{ rung: 1 }, { rung: 2 }]), 'on socials this month');
});

Deno.test('reduceRailKicker: [rung1, rung3] → from socials', () => {
    assertEquals(reduceRailKicker([{ rung: 1 }, { rung: 3 }]), 'from socials');
});

Deno.test('reduceRailKicker: [rung1, rung1] → this week', () => {
    assertEquals(reduceRailKicker([{ rung: 1 }, { rung: 1 }]), 'on socials this week');
});

Deno.test('reduceRailKicker: rung 3 wins over rung 2 in the same rail', () => {
    assertEquals(reduceRailKicker([{ rung: 2 }, { rung: 3 }, { rung: 1 }]), 'from socials');
});

Deno.test('reduceRailKicker: empty rail → weekly label (rail self-hides anyway)', () => {
    assertEquals(reduceRailKicker([]), 'on socials this week');
});
