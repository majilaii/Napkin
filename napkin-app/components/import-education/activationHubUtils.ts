/**
 * activationHubUtils — pure copy + variant + glyph logic for ImportActivationHub
 * (TICKET-122). Kept JSX-free so it's unit-testable without pulling the component's
 * Ionicons / expo-router imports into jest (mirrors the feed *Gate.ts convention).
 *
 * Copy is EXACT and cut hard (copy-economy doctrine): one line per idea, no
 * explanatory sentences. Source-app NAMES only (nominative use) — no brand icon
 * assets; the glyphs are neutral Ionicons outline drawings (locked decision #3).
 */

/** The four sources Napkin teaches saving from (locked #3). */
export type SourceApp = 'TikTok' | 'Instagram' | 'Photos' | 'Safari';
export const SOURCE_APPS: readonly SourceApp[] = ['TikTok', 'Instagram', 'Photos', 'Safari'];

/**
 * Neutral, theme-built share glyphs (Ionicons outline names — NOT brand marks).
 * Typed as a literal union so this stays free of the @expo/vector-icons import;
 * the component casts to the Ionicons `name` prop.
 */
export type GlyphName = 'arrow-redo-outline' | 'paper-plane-outline' | 'share-outline';
export const GLYPH_FOR_SOURCE: Record<SourceApp, GlyphName> = {
    TikTok: 'arrow-redo-outline', // repost/share curve
    Instagram: 'paper-plane-outline', // DM/share paper-plane
    Photos: 'share-outline', // iOS square-and-arrow-up
    Safari: 'share-outline', // iOS square-and-arrow-up
};

export type ImportMode = 'auto' | 'review';

/** Exact hub strings (cut hard). Assert these verbatim in tests. */
export const HUB_COPY = {
    kicker: 'SAVE SPOTS FROM',
    gesture: 'tap share, then napkin',
    modeAuto: 'we pin them for you.',
    modeReview: 'you confirm them first.',
    hubLink: 'your imports',
} as const;

/** The compact one-liner — derived from SOURCE_APPS so it can never drift. */
export const COMPACT_LINE = `save spots from ${SOURCE_APPS.join(' · ')}`;

/** `auto` picks compact once the user has imported, else full. */
export function resolveHubVariant(
    variant: 'full' | 'compact' | 'auto',
    hasImported: boolean,
): 'full' | 'compact' {
    if (variant === 'auto') return hasImported ? 'compact' : 'full';
    return variant;
}

/** The contextual mode line — auto pins for you, review waits for confirmation. */
export function modeLine(mode: ImportMode): string {
    return mode === 'review' ? HUB_COPY.modeReview : HUB_COPY.modeAuto;
}
