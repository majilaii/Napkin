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

    // Pattern 2: "N best/spots/places/restaurants/must/favourites"
    const nBestMatch = trimmed.match(/\b(\d+)\s+(?:best|spots?|places?|restaurants?|must(?:\s+try)?|favou?rites?)\b/i);
    if (nBestMatch) {
        const n = parseInt(nBestMatch[1], 10);
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
