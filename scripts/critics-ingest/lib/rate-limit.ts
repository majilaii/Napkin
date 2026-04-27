/**
 * Per-publication rate limiter for the critics ingest scraper.
 * TICKET-033
 *
 * P1-5 ARCH-REVIEW: throttle by publicationKey, not raw hostname.
 * NYT search hits api.nytimes.com while articles are on www.nytimes.com —
 * two hostnames but one publication budget. Throttling by publication ID
 * keeps the 1-req/sec guarantee per publisher regardless of CDN split.
 *
 * Usage:
 *   const limiter = createPublicationLimiter(1000);  // 1s default
 *   const result = await limiter.withThrottle('nyt', () => fetchHtml(url));
 */

export interface PublicationLimiter {
    withThrottle<T>(publication: string, fn: () => Promise<T>): Promise<T>;
}

/**
 * Creates a publication-keyed serial throttle.
 * Each publication gets its own promise chain so calls to the same
 * publication are serialized with a politeness delay between them.
 * Different publications run concurrently (they're separate chains).
 *
 * @param intervalMs — minimum ms between calls to the same publication (default 1000)
 */
export function createPublicationLimiter(intervalMs = 1000): PublicationLimiter {
    // Map of publication → tail of the chain for that publication
    const chains = new Map<string, Promise<unknown>>();

    function withThrottle<T>(publication: string, fn: () => Promise<T>): Promise<T> {
        const tail = chains.get(publication) ?? Promise.resolve();

        const next = tail
            .catch(() => {}) // don't let prior errors block the chain
            .then(() => new Promise<void>((resolve) => {
                // Politeness delay before this call runs
                setTimeout(resolve, intervalMs);
            }))
            .then(fn);

        // Store the new tail (drop the leading sleep so the chain doesn't grow unboundedly)
        chains.set(publication, next.catch(() => {}));

        return next;
    }

    return { withThrottle };
}
