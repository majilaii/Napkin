/**
 * ratingBins — half-star histogram helpers (TICKET-154).
 *
 * The histogram truth is 10 half-star bins [0.5, 1.0, …, 5.0]; index i holds
 * the count of ratings snapped to (i + 1) * 0.5 stars. The server builds
 * these (restaurant-history buildHalfDistribution); this module covers the
 * client-side degradation path for old server responses.
 */

export const HALF_BIN_COUNT = 10;

/**
 * Legacy 5-bucket → 10 half-star bins. Whole-star counts land on whole-star
 * bins (index i → bin 2i+1); half-star truth was already rounded away
 * server-side, so this is the best possible degradation.
 */
export function halfDistFromLegacy(legacy: number[]): number[] {
    const half = new Array(HALF_BIN_COUNT).fill(0);
    for (let i = 0; i < 5; i++) half[i * 2 + 1] = legacy[i] ?? 0;
    return half;
}
