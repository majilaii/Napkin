/**
 * Infatuation parser — 10-point score + short summary.
 * TICKET-033
 *
 * Structured-selector strategy (live tuning post-operator triage):
 *
 * search():
 *   Fetch https://www.theinfatuation.com/api/search?q={name}&city=new-york
 *   (Infatuation has an internal search API used by their own site).
 *   Picks the first result that name-matches the restaurant.
 *   Fallback: fetch https://www.theinfatuation.com/new-york/reviews/{slug}
 *   where slug is derived from the restaurant name (lowercase, spaces → hyphens).
 *
 * parse():
 *   Score — look for `[data-testid="rating"]` or `.rating-score` or a
 *   `<span class="...score...">` element containing a decimal number.
 *   score_out_of is always '10'.
 *   Author — `.author-name`, `[itemprop="author"]`, or byline `a` inside `.post-author`.
 *   Date — `<time datetime="...">` or `.published-date`.
 *   Excerpt — first paragraph of `.review-body` or `.body-content p:first-of-type`.
 *
 * Confidence rubric:
 *   95 — score from named selector + author + date + source_url
 *   80 — score from fallback text scan; author + date stable
 *   60 — score missing; excerpt from first-<p>
 *   40 — nothing structured found; excerpt only
 *
 * SKELETON: returns null. Live HTML parsing deferred to post-operator-triage.
 */

import type { PerVenueParser, ParsedRow } from './index.ts';

export const infatuationParser: PerVenueParser = {
    mode: 'venue',
    publication: 'infatuation',

    async search(name: string, _address: string | null): Promise<string | null> {
        // SKELETON: returns null until live parsing is implemented.
        void name;
        return null;
    },

    async parse(reviewUrl: string): Promise<ParsedRow | null> {
        // SKELETON: returns null until live parsing is implemented.
        void reviewUrl;
        return null;
    },
};
