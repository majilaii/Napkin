/**
 * TICKET-026 — publication display-name map + sort rank.
 *
 * Two constants:
 *  - PUBLICATION_DISPLAY_NAME: raw key → human-readable name shown in the UI
 *  - PUBLICATION_RANK: lower = shown first. Unknown publications fall through
 *    to Infinity (sorted alphabetically by display name after known pubs).
 *
 * Updatable without a migration or edge-function redeploy.
 */

export const PUBLICATION_DISPLAY_NAME: Record<string, string> = {
    nyt: 'NYT',
    infatuation: 'The Infatuation',
    eater: 'Eater',
};

export const PUBLICATION_RANK: Record<string, number> = {
    nyt: 0,
    infatuation: 1,
    eater: 2,
};

/**
 * Returns the display name for a publication key.
 * Falls back to the raw key if unmapped.
 */
export function getPublicationDisplayName(publication: string): string {
    return PUBLICATION_DISPLAY_NAME[publication] ?? publication;
}

/**
 * Returns the sort rank for a publication key.
 * Unknown publications return Infinity so they sort after known ones.
 */
export function getPublicationRank(publication: string): number {
    return PUBLICATION_RANK[publication] ?? Infinity;
}
