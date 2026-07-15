/**
 * socialsPresentation — pure per-card signal-line derivation + the rail-kicker
 * reduction for the "on socials" For You module (TICKET-189). Kept out of the
 * component so window/count copy is unit-tested, not eyeballed.
 *
 * CLIENT MIRROR of supabase/functions/_shared/socialsLadder.ts — the server
 * computes rung/window/count/platform (resolveSocialsLadder) and ships them on
 * each card; this file renders the copy and re-reduces the rail kicker from
 * the visible cards (the server also sends `kicker`, but the client recompute
 * keeps the label honest if cards are ever filtered client-side). Any change
 * to the reduction MUST be mirrored in socialsLadder.ts (reduceRailKicker) —
 * both have mixed-rung-rail tests.
 *
 * Copy rules (spec AC§2, window-labeled, never a false window):
 *   Rung 1 — `{N} saved from {platform} this week`  (mixed → "socials")
 *   Rung 2 — `{N} saved from {platform} this month` (never a false "this week")
 *   Rung 3 — no count. Clip-as-content: `on {platform} · @{creator}` when the
 *            creator handle is stored, else `on {platform}`. Provenance is the
 *            platform creator, NEVER the Napkin saver.
 */

export interface SocialsCardPresentation {
    rung: 1 | 2 | 3;
    window: 'week' | 'month' | null;
    count: number | null;
    platform: 'tiktok' | 'instagram' | 'socials';
    creator_handle: string | null;
}

/** One honest line under the restaurant name. */
export function socialsSignalLine(card: SocialsCardPresentation): string {
    if (card.rung === 3 || card.count === null) {
        const handle = card.creator_handle?.replace(/^@/, '') ?? null;
        return handle ? `on ${card.platform} · @${handle}` : `on ${card.platform}`;
    }
    const window = card.window === 'month' ? 'this month' : 'this week';
    return `${card.count} saved from ${card.platform} ${window}`;
}

/**
 * Rail-level kicker — deterministic reduction over the visible cards (mirror
 * of socialsLadder.reduceRailKicker; Codex P1 — a single "this week" kicker
 * over a rail holding a demoted monthly/rung-3 card would be false):
 *   any rung-3 card → 'from socials'; else any rung-2 → 'on socials this
 *   month'; else 'on socials this week'.
 */
export function reduceRailKicker(cards: readonly { rung: 1 | 2 | 3 }[]): string {
    if (cards.some((c) => c.rung === 3)) return 'from socials';
    if (cards.some((c) => c.rung === 2)) return 'on socials this month';
    return 'on socials this week';
}
