/**
 * textHighlight.ts — pure text utilities for feed card depth (TICKET-010).
 *
 * Exports:
 *   extractHighlight(text) → string | null
 *     Pick the most evaluative sentence from a note for use as a 1-line
 *     pull-quote on feed cards. Returns null if no valid candidate exists.
 *
 *   formatRelativeTime(dateStr, now?) → string | null
 *     Return a relative-time label for same-day content. Returns null for
 *     anything ≥ 24h — the DateSectionHeader already labels older buckets.
 */

// ── Evaluative word list (locked per TICKET-010 AC) ────────────────────────
// 24 words, evenly positive/negative, no emojis, no slang that ages quickly.
// Case-insensitive, whole-word match only. Expand via follow-up ticket.
const EVALUATIVE_WORDS: ReadonlySet<string> = new Set([
    'amazing',
    'incredible',
    'insane',
    'unreal',
    'perfect',
    'best',
    'delicious',
    'dreamy',
    'fire',
    'solid',
    'wild',
    'stellar',
    'phenomenal',
    'sublime',
    'disappointing',
    'bland',
    'mid',
    'trash',
    'terrible',
    'worst',
    'overrated',
    'underrated',
    'forgettable',
    'skippable',
]);

// Pre-compiled whole-word matcher for each evaluative word.
// Built once at module-load time so scoring is cheap.
const EVALUATIVE_PATTERNS: ReadonlyArray<RegExp> = Array.from(EVALUATIVE_WORDS).map(
    (w) => new RegExp(`\\b${w}\\b`, 'i')
);

/**
 * Score a sentence by counting how many evaluative words appear in it
 * (whole-word, case-insensitive). Returns an integer ≥ 0.
 */
function scoreCandidate(sentence: string): number {
    return EVALUATIVE_PATTERNS.reduce(
        (n, re) => n + (re.test(sentence) ? 1 : 0),
        0
    );
}

/**
 * Truncate text to at most `maxLen` characters at the last full-word boundary.
 * Never cuts mid-word. Assumes the input is already trimmed.
 */
function truncateAtWordBoundary(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    const sliced = text.slice(0, maxLen);
    const lastSpace = sliced.lastIndexOf(' ');
    return lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced;
}

/**
 * extractHighlight — pick the most evaluative sentence from a note.
 *
 * Algorithm:
 * 1. Split on sentence-ending punctuation (.!?), keeping terminators attached.
 * 2. Filter to candidates that are 3–90 chars and have ≥ 3 words (whitespace-tokenized).
 * 3. Score each by evaluative-word count; return highest-scoring, ties broken by
 *    earliest position.
 * 4. If no candidate scores > 0, return the first candidate from the filtered list.
 * 5. If no candidate passes filters, return null.
 * 6. Truncate result to 80 chars at the last full-word boundary before returning.
 *
 * Output has no leading/trailing quote marks and is trimmed.
 */
export function extractHighlight(text: string | null | undefined): string | null {
    if (!text) return null;

    // Split on sentence-ending punctuation; keep the terminator with its sentence.
    // e.g. "Great food. So good!" → ["Great food.", " So good!"]
    const raw = text.split(/(?<=[.!?])\s*/);

    const candidates = raw
        .map((s) => s.trim())
        .filter((s) => {
            if (s.length < 3 || s.length > 90) return false;
            const words = s.split(/\s+/).filter(Boolean);
            return words.length >= 3;
        });

    if (candidates.length === 0) return null;

    let best: string = candidates[0];
    let bestScore = scoreCandidate(best);

    for (let i = 1; i < candidates.length; i++) {
        const score = scoreCandidate(candidates[i]);
        if (score > bestScore) {
            bestScore = score;
            best = candidates[i];
        }
    }

    const result = truncateAtWordBoundary(best.trim(), 80);
    return result.length > 0 ? result : null;
}

// ── Relative time ───────────────────────────────────────────────────────────

/**
 * formatRelativeTime — return a human-readable label for content posted
 * within the last 24 hours, or null for older content.
 *
 * Thresholds (locked per TICKET-010 AC):
 *   < 60s  → "now"
 *   < 60m  → "Nm ago"   (e.g. "5m ago")
 *   < 24h  → "Nh ago"   (e.g. "3h ago")
 *   ≥ 24h  → null       (DateSectionHeader labels the bucket)
 *
 * @param dateStr  ISO 8601 date string (e.g. item.sort_date)
 * @param now      Optional Date for testing; defaults to Date.now()
 */
export function formatRelativeTime(dateStr: string, now?: Date): string | null {
    const reference = now ?? new Date();
    const diffMs = reference.getTime() - new Date(dateStr).getTime();

    if (diffMs < 0) return 'now'; // future-dated edge case

    const diffS = Math.floor(diffMs / 1_000);
    const diffM = Math.floor(diffMs / 60_000);
    const diffH = Math.floor(diffMs / 3_600_000);

    if (diffS < 60) return 'now';
    if (diffM < 60) return `${diffM}m ago`;
    if (diffH < 24) return `${diffH}h ago`;
    return null;
}
