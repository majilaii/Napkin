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
     *  Doctrine: search = restaurant-only; invite flows have their own picker.
     *  Flip false to restore people search. */
    hidePeopleSearch: true,
    /** TICKET-082: Suppers — shared-table meal posts. Gates the logger "make this
     *  a Supper" toggle + the SupperTable render on entry-detail. Default FALSE
     *  (testable for the friend-test); flip TRUE to kill-switch the feature.
     *  Gates JSX only — hooks/routes stay compiled & deep-linkable. */
    hideSuppers: false,
} as const;
