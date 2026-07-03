/**
 * candidateDedupe.ts — pre-Places candidate normalize/dedupe/merge/rank.
 *
 * Extracted from resolve-url/index.ts (TICKET-086c) so the exact stage
 * implicated in the "video has 7 spots, import saved 1" Topjaw regressions is
 * unit-testable in the pre-commit deno pass (scripts/eval covers the LLM stage;
 * this covers the pure logic around it).
 *
 * 086c fixes over the original:
 *   - containment fold is token-boundary ("berenjak" ⊆ "berenjak soho" merges;
 *     "ria" no longer folds into "osteria" by substring accident)
 *   - containment fold requires compatible cities (equal, or one absent)
 *   - mergeExtracted carries `area` and `stance` (both were silently dropped,
 *     degrading Places queries and losing the overrated flag on merge)
 */
import type { ExtractedCandidate } from './visionExtract.ts';

export interface StagedCandidate {
    extracted: ExtractedCandidate;
    /** 0 = text-tier; 1 = vision-tier */
    tier: 0 | 1;
    /** Original position within tier (for ordinal sort) */
    ordinal: number;
    /** True if seen in both tiers (source-agreement) */
    inBothTiers: boolean;
}

/** Normalize a name for fuzzy pre-Places dedup. */
export function normalizeName(name: string | null | undefined): string {
    if (!name) return '';
    // Lowercase, strip diacritics, strip punctuation, collapse whitespace
    return name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Fuzzy dedup key: normalized_name + '|' + normalized_city. */
export function fuzzyKey(name: string | null, city: string | null): string {
    const n = normalizeName(name);
    const c = normalizeName(city);
    return `${n}|${c}`;
}

/** Cities are compatible for a merge when equal or one side is absent. */
function cityCompatible(a: string | null, b: string | null): boolean {
    const ca = normalizeName(a);
    const cb = normalizeName(b);
    return !ca || !cb || ca === cb;
}

/**
 * Token-boundary containment: every WORD of the shorter name appears in the
 * longer name's word set. Substring checks false-merged distinct restaurants
 * ("Ria" ⊂ "Osteria", "Norma" ⊂ "Norman's") — garbled ASR names are short, so
 * that was a direct N→N−1 spot loss.
 */
function nameContainsTokens(a: string, b: string): boolean {
    if (!a || !b) return false;
    const ta = a.split(' ');
    const tb = b.split(' ');
    const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
    const longSet = new Set(long);
    return short.every((w) => longSet.has(w));
}

/** Generic tokens that shouldn't count as evidence two names match. */
const GENERIC_TOKENS = new Set([
    'the', 'a', 'restaurant', 'cafe', 'caff', 'bar', 'kitchen', 'and', 'of',
    'london', 'pub', 'deli', 'bakery', 'grill', 'house',
]);

/**
 * Places-result similarity gate (TICKET-086c): does the returned place name
 * plausibly match the extracted name? A garbled name text-searched against
 * Places returns SOME popular place; accepting results[0] blind presents a
 * wrong match as "resolved" and the real spot silently leaves the funnel.
 * Requires one shared non-generic token of length ≥3 (or full containment).
 * Lenient by design: when the extracted name is ALL generic tokens there's no
 * signal to gate on — allow it rather than ghost legitimate matches.
 */
export function namesOverlap(a: string | null | undefined, b: string | null | undefined): boolean {
    const na = normalizeName(a);
    const nb = normalizeName(b);
    // No signal to gate on (CJK/emoji-only names normalize to '' — \w is
    // ASCII-only): stay lenient, keep the pre-gate behavior of trusting Places.
    if (!na || !nb) return true;
    if (nameContainsTokens(na, nb)) return true;
    const tokensA = na.split(' ').filter((t) => t.length >= 3 && !GENERIC_TOKENS.has(t));
    if (tokensA.length === 0) return true; // nothing distinctive to gate on
    const tokensB = new Set(nb.split(' '));
    return tokensA.some((t) => tokensB.has(t));
}

/** Merge two ExtractedCandidates: `primary` wins on non-null fields; `secondary` fills nulls. */
export function mergeExtracted(
    primary: ExtractedCandidate,
    secondary: ExtractedCandidate,
): ExtractedCandidate {
    return {
        name: primary.name ?? secondary.name,
        city: primary.city ?? secondary.city,
        city_inferred: primary.city !== null ? primary.city_inferred : secondary.city_inferred,
        area: primary.area ?? secondary.area ?? null,
        cuisine: primary.cuisine ?? secondary.cuisine,
        address: primary.address ?? secondary.address,
        booking_url: primary.booking_url ?? secondary.booking_url,
        hours: primary.hours ?? secondary.hours,
        confidence: primary.confidence === 'high' || primary.confidence === 'exact'
            ? primary.confidence
            : secondary.confidence,
        google_place_id: primary.google_place_id ?? secondary.google_place_id,
        // 'warned' must survive any merge — losing it turns an anti-recommendation
        // into a save. Warned wins over recommended/neutral from either side.
        stance: primary.stance === 'warned' || secondary.stance === 'warned'
            ? 'warned'
            : (primary.stance ?? secondary.stance),
    };
}

/**
 * Two-stage dedupe + rank:
 *   Stage 1 (pre-Places): fuzzy key = normalize(name) + city
 *     - containment fold: "Berenjak Soho" + "Berenjak" → merged (token-boundary,
 *       city-compatible)
 *   Stage 2 (post-Places, in the caller): by google_place_id
 *
 * Rank tuple: (confidence desc, source-agreement desc, list ordinal asc)
 * Field conflicts: text-tier wins; vision fills nulls.
 * Cap `cap` (silent tail drop — callers log/limit upstream).
 */
export function dedupeAndRank(
    textCandidates: ExtractedCandidate[],
    visionCandidates: ExtractedCandidate[],
    cap = 6,
): StagedCandidate[] {
    const staged: StagedCandidate[] = [];
    const fuzzySet = new Map<string, number>(); // fuzzyKey → staged index

    const addOrMerge = (ext: ExtractedCandidate, tier: 0 | 1, ordinal: number) => {
        const fk = fuzzyKey(ext.name, ext.city);

        // Containment fold: token-boundary containment + compatible city.
        let existingIdx: number | undefined;
        const normN = normalizeName(ext.name);
        for (const [existingKey, idx] of fuzzySet.entries()) {
            const [existingName] = existingKey.split('|');
            if (
                normN &&
                existingName &&
                nameContainsTokens(normN, existingName) &&
                cityCompatible(ext.city, staged[idx].extracted.city)
            ) {
                existingIdx = idx;
                break;
            }
        }

        if (existingIdx !== undefined) {
            // Merge: text-tier wins for fields; mark inBothTiers
            const existing = staged[existingIdx];
            if (tier === 0) {
                existing.inBothTiers = true;
                existing.extracted = mergeExtracted(ext, existing.extracted); // text wins
                existing.tier = 0;
            } else {
                existing.inBothTiers = true;
                existing.extracted = mergeExtracted(existing.extracted, ext); // existing wins
            }
            return;
        }

        // Check exact fuzzy key match
        if (fuzzySet.has(fk)) {
            const idx = fuzzySet.get(fk)!;
            const existing = staged[idx];
            if (tier === 0) {
                existing.inBothTiers = true;
                existing.extracted = mergeExtracted(ext, existing.extracted);
                existing.tier = 0;
            } else {
                existing.inBothTiers = true;
                existing.extracted = mergeExtracted(existing.extracted, ext);
            }
            return;
        }

        // New candidate
        fuzzySet.set(fk, staged.length);
        staged.push({ extracted: ext, tier, ordinal, inBothTiers: false });
    };

    textCandidates.forEach((c, i) => addOrMerge(c, 0, i));
    visionCandidates.forEach((c, i) => addOrMerge(c, 1, i + textCandidates.length));

    // Rank: confidence desc, inBothTiers desc, ordinal asc
    const confidenceOrder = { high: 0, exact: 0, low: 1 };
    staged.sort((a, b) => {
        const ca = confidenceOrder[a.extracted.confidence] ?? 1;
        const cb = confidenceOrder[b.extracted.confidence] ?? 1;
        if (ca !== cb) return ca - cb;
        if (a.inBothTiers !== b.inBothTiers) return a.inBothTiers ? -1 : 1;
        return a.ordinal - b.ordinal;
    });

    return staged.slice(0, cap);
}
