/**
 * socialsLadder — the pure honesty-vs-liveness ladder for the "on socials"
 * For You module (TICKET-189). Lives in _shared so rung selection is
 * unit-tested, not eyeballed (the forYouBlocks / trendingRailGate pure-arbiter
 * rationale). feed-socials calls this per candidate AFTER the stage-2 viewer
 * pass; the client mirrors the presentation copy in
 * napkin-app/components/feed/socialsPresentation.ts.
 *
 * The degradation ladder (spec AC§2 — window-labeled, never a false window):
 *   Rung 1 — k7 ≥ 3 distinct public savers (viewer excluded): identity-free
 *            weekly count. Platform label = the 7d window's platform fact.
 *   Rung 2 — k7 < 3 but k30 ≥ 3: widen to 30d, label says "this month".
 *            Platform label = the 30d window's platform fact (Codex P1: a
 *            monthly card must never claim a platform that only appeared in
 *            the excluded 7d rows — hence PER-WINDOW facts, not a
 *            window-agnostic has_tiktok/has_instagram).
 *   Rung 3 — no window clears the floor: NO COUNT. The clip is presented as
 *            content; provenance = the platform creator (rep clip's platform),
 *            never the Napkin saver.
 *
 * Platform mapping: a single-platform window names the platform; 'mixed' →
 * 'socials' (a combined count is never attributed to one platform).
 */

export type SocialsPlatformFact = 'tiktok' | 'instagram' | 'mixed' | 'none';
export type SocialsPlatformLabel = 'tiktok' | 'instagram' | 'socials';
export type SocialsWindow = 'week' | 'month' | null;

export interface SocialsLadderInput {
    /** Viewer-adjusted distinct public savers, 7d window (self excluded). */
    k7: number;
    /** Viewer-adjusted distinct public savers, 30d window (self excluded). */
    k30: number;
    /** Platform fact computed over the 7d window's surviving savers. */
    platform_7d: SocialsPlatformFact;
    /** Platform fact computed over the 30d window's surviving savers. */
    platform_30d: SocialsPlatformFact;
    /** The representative clip's platform (rung-3 provenance). */
    rep_source_type: 'tiktok' | 'instagram';
}

export interface SocialsLadderResolution {
    rung: 1 | 2 | 3;
    window: SocialsWindow;
    count: number | null;
    platform: SocialsPlatformLabel;
}

/** The identity floor — never show a saves count below k ≥ 3 post-exclusion. */
export const SOCIALS_K_FLOOR = 3;

function labelForWindow(
    fact: SocialsPlatformFact,
    repPlatform: 'tiktok' | 'instagram',
): SocialsPlatformLabel {
    if (fact === 'mixed') return 'socials';
    if (fact === 'tiktok' || fact === 'instagram') return fact;
    // 'none' cannot occur for a window that cleared the k-floor (a counted
    // window has savers, and every saver row carries a platform) — fall back
    // to the representative clip's platform defensively.
    return repPlatform;
}

export function resolveSocialsLadder(input: SocialsLadderInput): SocialsLadderResolution {
    if (input.k7 >= SOCIALS_K_FLOOR) {
        return {
            rung: 1,
            window: 'week',
            count: input.k7,
            platform: labelForWindow(input.platform_7d, input.rep_source_type),
        };
    }
    if (input.k30 >= SOCIALS_K_FLOOR) {
        return {
            rung: 2,
            window: 'month',
            count: input.k30,
            platform: labelForWindow(input.platform_30d, input.rep_source_type),
        };
    }
    return {
        rung: 3,
        window: null,
        count: null,
        // Rung 3 is clip-as-content — the label is the rep clip's platform.
        platform: input.rep_source_type,
    };
}

/**
 * Rail-level kicker — a deterministic reduction over the VISIBLE cards
 * (Codex P1: a single "this week" kicker over a rail holding a demoted
 * monthly/rung-3 card would be false):
 *   any rung-3 card present  → 'from socials'
 *   else any rung-2 (month)  → 'on socials this month'
 *   else                     → 'on socials this week'
 */
export function reduceRailKicker(cards: ReadonlyArray<{ rung: 1 | 2 | 3 }>): string {
    if (cards.some((c) => c.rung === 3)) return 'from socials';
    if (cards.some((c) => c.rung === 2)) return 'on socials this month';
    return 'on socials this week';
}
