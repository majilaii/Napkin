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
    /** TICKET-069: Curtain all Rounds entry points for the skinny-five v1.
     *  Gates JSX only — hooks stay compiled. Routes remain for deep-link safety.
     *  Flip false to restore round UX. */
    hideRounds: true,
    /** TICKET-069 phase 2: Hide the People search mode tab.
     *  Restored 2026-07-02 (founder request): search = Restaurants ↔ People,
     *  Beli-style — the "add friends" path is search → profile → follow. */
    hidePeopleSearch: false,
    /** TICKET-082: Suppers — "the empty table" (v2). Kill-switch for every supper
     *  surface: the feed SupperCard + in-app nudge (tables.tsx, gated in BOTH the
     *  timelineItems filter and the leaf render so no orphan date headers), the
     *  restaurant-page "set a table here" entry + SetTableSheet, the supper/[id]
     *  gathered view, and the SupperTable render on entry-detail. (The old logger
     *  "make this a Supper" toggle was retired in v2 — suppers are now set as empty
     *  tables, not opted into on a review.) Default FALSE (live for the friend-test);
     *  flip TRUE to curtain. Gates JSX only — hooks/routes stay compiled & deep-linkable. */
    hideSuppers: false,
} as const;
