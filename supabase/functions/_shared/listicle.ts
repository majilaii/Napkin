/**
 * listicle.ts — detect "top N" / numbered-list markers in a caption/title.
 * TICKET-063 Step 1.
 *
 * Pure function — no Deno deps, fully unit-testable in isolation.
 *
 * Returns { isList: boolean; count: number | null }
 *   isList:  true when the text signals a listicle format
 *   count:   the advertised N if parseable (clamped 1–6), otherwise null
 *
 * False positives (e.g. "top tier ramen") trigger a vision call we don't need —
 * acceptable bounded cost; the vision tier is fail-soft so no correctness harm.
 */

export interface ListMarkerResult {
    isList: boolean;
    count: number | null;
    /**
     * TICKET-164: the UNCLAMPED advertised N. `count` clamps to ≤6 (advisory,
     * TICKET-063 — a listicle only ever triggers ≤6 vision retries), but the
     * import fast-path count gate needs the TRUE number: a "top 12" caption whose
     * clamped count read 6 would let a 6-candidate cheap tier fast-path a 12-spot
     * list. null whenever no count is parseable (same condition as count === null).
     */
    countRaw: number | null;
}

/**
 * TICKET-209 pattern 2: `N` + up to four intervening words + a list-noun.
 *
 * `u` is load-bearing: the gap class uses \p{L}/\p{M} so accented city names
 * ("San Sebastián") count as ordinary words. `\p{L}` is inert without `u`.
 * Group 1 = the digits, group 2 = the (possibly empty) intervening words.
 */
const N_LIST_RE =
    /\b(\d+)\s+((?:[\p{L}\p{M}'’-]+\s+){0,4})(?:best|spots?|places?|restaurants?|must(?:\s+try)?|favou?rites?)\b/giu;

/**
 * Units of time/distance/percentage. A digit qualifying one of these is a
 * duration or a measure, never an advertised spot count.
 */
const UNIT_TOKEN_RE =
    /^(?:days?|nights?|hours?|hrs?|mins?|minutes?|weeks?|months?|years?|km|miles?|%)$/iu;

/**
 * Detect a listicle marker in text.
 * Returns isList=true and count=N when the text mentions "top N" / "N best spots"
 * or has at least 2 numbered lines (1. … 2. …).
 */
export function detectListMarker(text: string): ListMarkerResult {
    if (!text || typeof text !== 'string') {
        return { isList: false, count: null, countRaw: null };
    }

    const trimmed = text.trim();

    // Pattern 1: "top N" — e.g. "top 5 restaurants in Soho"
    const topNMatch = trimmed.match(/\btop\s*(\d+)\b/i);
    if (topNMatch) {
        const n = parseInt(topNMatch[1], 10);
        const finite = Number.isFinite(n);
        return {
            isList: true,
            count: finite ? Math.min(Math.max(n, 1), 6) : null,
            countRaw: finite ? n : null,
        };
    }

    // Pattern 2: "N [up to 4 words] best/spots/places/restaurants/must/favourites"
    // TICKET-209: the digit no longer has to sit adjacent to the list-noun —
    // "10 San Sebastián food spots", "7 underrated Lisbon restaurants". Two
    // guards keep the widened gap from reading a DURATION as a spot count:
    //   - unit/measure blocklist on every token in the gap (which includes the
    //     token immediately after the digit): "3 days in Lisbon spots" → 3 would
    //     truncate a 10-spot video to 3.
    //   - currency prefix: "£10 spots in London" is a price, not a count.
    // A rejected match NEVER nulls the whole caption — scanning continues so a
    // mixed caption stays countable ("24 hours in NYC: 8 spots you need" → 8).
    N_LIST_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = N_LIST_RE.exec(trimmed)) !== null) {
        // Currency-prefixed digits are prices, never counts.
        const prevChar = m.index > 0 ? trimmed[m.index - 1] : '';
        if (prevChar === '£' || prevChar === '$' || prevChar === '€') continue;
        // Every gap token (the first of which is the token right after the
        // digit) must be a plain word, not a unit of time/distance.
        const gapTokens = (m[2] ?? '').split(/\s+/).filter(Boolean);
        if (gapTokens.some((t) => UNIT_TOKEN_RE.test(t))) continue;

        const n = parseInt(m[1], 10);
        const finite = Number.isFinite(n);
        return {
            isList: true,
            count: finite ? Math.min(Math.max(n, 1), 6) : null,
            countRaw: finite ? n : null,
        };
    }

    // Pattern 3: numbered list items (at least 2 lines starting with "1." / "2." etc.)
    const numberedLines = trimmed.split(/\n/).filter((line) =>
        /^\s*\d+[\.\)]\s/.test(line)
    );
    if (numberedLines.length >= 2) {
        const n = numberedLines.length;
        return { isList: true, count: Math.min(n, 6), countRaw: n };
    }

    // Pattern 4: phrases like "part 1", "part 2" or "episode N" that imply a series
    // — not a listicle per se but a series; skip (too many false positives)

    return { isList: false, count: null, countRaw: null };
}
