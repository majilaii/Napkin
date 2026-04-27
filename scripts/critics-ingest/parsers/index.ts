/**
 * Parser registry for the critics ingest scraper.
 * TICKET-033
 *
 * Each parser implements either PerVenueParser or ListParser.
 * The CLI orchestrator iterates this registry.
 *
 * Confidence rubric (per-parser docs repeat this inline):
 *   95 — all four structured fields (publication, kind, score, source_url)
 *         parsed from named/stable CSS selectors
 *   80 — three parsed cleanly + one fallback heuristic
 *   60 — generic-text fallback for at least one structured field
 *   40 — excerpt extracted via first-<p> heuristic, no stable selector
 *
 * P1-5 ARCH-REVIEW: rate limiting is by publication ID (not hostname).
 * Each parser declares `publication: string` used as the throttle key.
 */

export type ParsedRow = {
    publication: string;
    kind: 'stars' | 'score' | 'essential' | 'feature';
    score: string | null;
    score_out_of: string | null;
    author: string | null;
    published_date: string | null;
    excerpt: string | null;
    source_url: string;
    scrape_confidence: number;
};

/**
 * A per-venue parser: given a restaurant name + address, finds a review URL
 * and parses it into a ParsedRow.
 */
export interface PerVenueParser {
    mode: 'venue';
    publication: string;
    /** Finds the review URL for a restaurant. Returns null if not found. */
    search(name: string, address: string | null): Promise<string | null>;
    /** Parses the review page into a row. Returns null if parse fails fatally. */
    parse(reviewUrl: string): Promise<ParsedRow | null>;
}

/**
 * A list-diff parser: fetches a city list once per run and returns
 * all entries on that list. Orchestrator matches against restaurants.
 */
export interface ListParser {
    mode: 'list';
    publication: string;
    /** Fetches the list for a city. Returns entries with name + optional address + year. */
    fetchList(city: string): Promise<Array<{ restaurant_name: string; address?: string; year: number }>>;
}

export type Parser = PerVenueParser | ListParser;

// ── Registry ──────────────────────────────────────────────────────────────────
// Import lazily so unused parsers don't bloat the module graph.
import { nytParser } from './nyt.ts';
import { infatuationParser } from './infatuation.ts';
import { eaterParser } from './eater.ts';

/**
 * Ordered list of parsers. NYT first (highest signal), Infatuation second,
 * Eater last (list-diff shape). This order is preserved by the orchestrator.
 */
export const parsers: Parser[] = [nytParser, infatuationParser, eaterParser];

export const perVenueParsers = parsers.filter((p): p is PerVenueParser => p.mode === 'venue');
export const listParsers = parsers.filter((p): p is ListParser => p.mode === 'list');
