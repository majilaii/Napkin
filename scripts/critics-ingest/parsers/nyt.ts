/**
 * NYT parser — Pete Wells stars + excerpt.
 * TICKET-033
 *
 * Structured-selector strategy (documented here; live tuning happens post-operator triage):
 *
 * search(): POST to NYT Community Site Search API
 *   https://api.nytimes.com/svc/search/v2/articlesearch.json
 *   with params: q="{name}", fq=section_name:"Dining", sort=relevance
 *   Picks the first result that matches the restaurant name + has "review" in its type_of_material.
 *   NOTE: NYT API key is NOT required for this endpoint — it's an older public API.
 *   If the search endpoint requires a key in future, add NYTIMES_API_KEY env var.
 *
 * parse():
 *   Stars — look for a data attribute or aria-label pattern like "X stars out of 4"
 *   on known star-rating selectors. Stable selectors change quarterly.
 *   Fallback: grep for "★" glyph repetitions in the article body.
 *
 *   Author — byline element, e.g. `[itemprop="name"]` inside `.css-byline`.
 *   Date — `[datetime]` on a `<time>` element in the article header.
 *   Excerpt — first paragraph after the byline inside `.css-53u6y8` or `.StoryBodyCompanionColumn`.
 *
 * Confidence rubric:
 *   95 — stars parsed from named selector + author + date + source_url all from stable selectors
 *   80 — stars from fallback glyph grep; author + date from stable selectors
 *   60 — stars from glyph grep; excerpt from first-<p> heuristic
 *   40 — no stars found; excerpt only
 *
 * SKELETON: This parser returns null for now. Live HTML parsing logic is
 * intentionally deferred to post-operator-triage (per builder instructions).
 * The selector strategy above documents the plan for the first real implementation pass.
 */

import type { PerVenueParser, ParsedRow } from './index.ts';

export const nytParser: PerVenueParser = {
    mode: 'venue',
    publication: 'nyt',

    async search(name: string, _address: string | null): Promise<string | null> {
        // SKELETON: returns null until live parsing is implemented.
        // Strategy: call NYT Article Search API with q=name, fq=section_name:"Dining"
        // Pick first result with a review URL pattern.
        void name;
        return null;
    },

    async parse(reviewUrl: string): Promise<ParsedRow | null> {
        // SKELETON: returns null until live parsing is implemented.
        // Strategy documented in module header above.
        void reviewUrl;
        return null;
    },
};

/**
 * Canonical star-to-glyph mapping.
 * NYT uses ★ characters in their article text.
 */
export function starsToGlyphs(stars: number): string {
    return '★'.repeat(Math.max(0, Math.min(4, stars)));
}
