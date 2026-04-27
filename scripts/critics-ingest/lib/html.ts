/**
 * HTML fetch + DOM parse utilities for the critics ingest scraper.
 * TICKET-033
 *
 * fetchHtml — polite HTTP GET with custom User-Agent
 * parseDom  — wraps deno-dom for CSS selector access
 * firstText — returns text content of the first matching element
 * wordCount — count whitespace-delimited tokens (used by license.ts)
 *
 * deno-dom is a pure-Deno HTML parser; no npm/cheerio dependency.
 * https://deno.land/x/deno_dom
 */

// deno-lint-ignore-file no-explicit-any
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.43/deno-dom-wasm.ts';

const USER_AGENT = 'NapkinCriticsBot/1.0 (+ops@napkin.app)';

/**
 * Fetch the raw HTML of a URL with the scraper User-Agent.
 * Returns the body text string.
 * Throws on non-2xx status.
 */
export async function fetchHtml(url: string): Promise<string> {
    const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
    });
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} fetching ${url}`);
    }
    return res.text();
}

/**
 * Parse an HTML string into a DOM document for CSS selector queries.
 */
export function parseDom(html: string): Document {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (!doc) throw new Error('Failed to parse HTML');
    return doc as unknown as Document;
}

/**
 * Returns the trimmed text content of the first element matching `selector`,
 * or null if no match.
 */
export function firstText(doc: Document, selector: string): string | null {
    const el = (doc as any).querySelector(selector);
    return el ? (el.textContent ?? '').trim() : null;
}

/**
 * Count whitespace-delimited tokens in a string.
 * Used by enforceLicense to verify 30-word cap.
 */
export function wordCount(s: string): number {
    return s.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Truncate a string to at most `maxWords` whitespace-delimited tokens.
 * Appends '…' if truncation occurred.
 */
export function truncateWords(s: string, maxWords: number): string {
    const tokens = s.trim().split(/\s+/).filter(Boolean);
    if (tokens.length <= maxWords) return s.trim();
    return tokens.slice(0, maxWords).join(' ') + '…';
}
