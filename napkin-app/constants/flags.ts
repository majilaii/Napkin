/**
 * Friend-test feature flags — TICKET-068
 *
 * Flip any value to `false` to restore that surface.
 * Routes stay registered and deep-linkable; this is a curtain, not a demolition.
 * Data hooks are never gated here — only JSX render paths.
 */
export const FRIEND_TEST = {
    /** Hide Lists screen entry points (profile index + settings row). */
    hideLists: true,
    /** Hide Top 4s — personal grid on profile, table grid/placeholder, edit sheet, FoundedHero placeholder. */
    hideTopFours: true,
    /** Hide Atlas tab on Tables screen + AtlasCrossLinkChip on restaurant page. */
    hideAtlas: true,
    /** Hide ProfessionalTakesBand ("PROFESSIONAL TAKES") on restaurant page. Admin /critics already self-gates. */
    // Professional takes on restaurant pages are reading CONTENT (TICKET-065),
    // not a maintained surface — keep visible. Flip true if testers find it noisy.
    hideCritics: false,
    /** Hide Looking-back anniversary tick + seed-from-solo entry points (EmptyChairInvitation, TableSwitcherSheet gather CTA). */
    hideEmergenceArc: true,
} as const;
