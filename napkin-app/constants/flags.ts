/**
 * Friend-test feature flags — TICKET-068
 *
 * Flip any value to `false` to restore that surface.
 * Routes stay registered and deep-linkable; this is a curtain, not a demolition.
 * Data hooks are never gated here — only JSX render paths.
 */
/**
 * TICKET-189 rollout flags — the two NEW For You discovery surfaces ship
 * FLAG-GATED OFF in the store build (Codex P1 rollout posture): the endpoints
 * deploy dark and soak in CI/prod smoke; flipping these to true lights the
 * client surfaces with no further deploy. With both OFF the build is a
 * complete, shippable slice (Manrope masthead + fixed lists block + existing
 * co-diner people block + empty-vs-error contract, no trending rail).
 *
 * Unlike FRIEND_TEST below these are ENABLE flags, not curtains.
 */
/** "on socials this week" For You module (feed-socials + OnSocialsBlock). */
export const FOR_YOU_SOCIALS = true;
/** People-to-follow v2 mixed rail (follow_candidates + public authors). */
export const FOR_YOU_PEOPLE_V2 = true;

export const FRIEND_TEST = {
    /** Hide Lists screen entry points (profile index + settings row).
     *  Flipped false 2026-07-03 (TICKET-092 profile revamp) — lists have been
     *  live on the wishlist tab since TICKET-084; the curtain was stale. */
    hideLists: false,
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
    /** TICKET-157: Places-hero trial on Top 4 plates ONLY (profile marquee +
     *  Table grid). When true, a persisted restaurant's mirrored `photo_url`
     *  (`photo_source === 'places'`) fills the plate with a warm wash; chosen-memory
     *  photos always win and are never washed. Default TRUE (founder's on-device
     *  verdict needs it live). Flip FALSE to restore current-prod rendering on both
     *  surfaces (chosen-memory-or-typographic on profile; ghost/typographic on the
     *  table grid) — one-line revert, no data change. Read at each render call site,
     *  never inside the resolver (keeps `resolveTilePhoto` pure). */
    topFourPlacesHero: true,
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
