/**
 * import-education — TICKET-122 import teaching surfaces.
 *   ImportActivationHub  — repeatable empty-state activation hub (Surface B).
 * The old share-sheet teach body (Surface A) was removed in TICKET-250: nothing
 * rendered it, and it drew other companies' app icons. Onboarding teaches with
 * components/onboarding/ShareWalkthrough.
 */
export { ImportActivationHub, type ImportActivationHubProps } from './ImportActivationHub';
export { ShareGlyph } from './ShareGlyph';
