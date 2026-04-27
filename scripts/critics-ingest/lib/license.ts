/**
 * License enforcement for the critics ingest scraper.
 * TICKET-033 / P1-6 ARCH-REVIEW
 *
 * enforceLicense(row) — the single write-boundary gate. Every parser pipes
 * its row through this before insertion. Rules enforced:
 *
 * 1. `source_url` MUST be present (regardless of excerpt). Hard throw.
 * 2. `publication` MUST be present. Hard throw.
 * 3. `excerpt` is truncated to ≤30 words if longer.
 * 4. Failures count toward a separate `license_failed` bucket (NOT `skipped_not_found`).
 *
 * Design note: parsers should never reach this function without both source_url
 * and publication set — they validate upstream. This is a defence-in-depth gate.
 */

import { truncateWords, wordCount } from './html.ts';

export class LicenseError extends Error {
    constructor(msg: string) {
        super(msg);
        this.name = 'LicenseError';
    }
}

export interface LicenseableRow {
    publication: string | null | undefined;
    source_url: string | null | undefined;
    excerpt: string | null | undefined;
}

/**
 * Validates licensing constraints and returns a (potentially mutated) copy
 * of `row` with the excerpt clamped to ≤30 words.
 *
 * Throws LicenseError if `source_url` or `publication` is missing.
 *
 * @param row — the row about to be written to professional_critic_reviews
 * @returns a copy of `row` with excerpt truncated if needed
 */
export function enforceLicense<T extends LicenseableRow>(row: T): T {
    // P1-6: throw when source_url is missing regardless of excerpt
    if (!row.source_url || row.source_url.trim() === '') {
        throw new LicenseError(
            `License violation: source_url is missing for publication='${row.publication}'`
        );
    }

    // P1-6: throw when publication is missing regardless of excerpt
    if (!row.publication || row.publication.trim() === '') {
        throw new LicenseError(
            `License violation: publication is missing for source_url='${row.source_url}'`
        );
    }

    let excerpt = row.excerpt ?? null;
    if (excerpt !== null && wordCount(excerpt) > 30) {
        excerpt = truncateWords(excerpt, 30);
    }

    return { ...row, excerpt };
}
