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

/**
 * TICKET-177 — locality-consistency guard for Places text-search acceptance.
 *
 * A garbled name can EXACT-match a real venue in the wrong town: ASR heard
 * "Cartouche" for Kartuli (East Dulwich); Places returned Cartouche in
 * HERTFORD; namesOverlap passed (names identical) and the wrong county got
 * pinned (founder repro 2026-07-12). The extraction already carries the
 * video's locality signal (city + area) — a result whose own locality shares
 * NO token with it is not the place the video meant.
 *
 * Lenient by design (mirrors namesOverlap's contract):
 *   - no extracted city/area → true (no signal to gate on);
 *   - place has no city/address info → true (can't judge);
 *   - ANY extracted locality sharing ANY token with the place's city +
 *     formattedAddress → true.
 * Trade-off (documented): a Greater-London venue whose Google address omits
 * "London" (outer-borough postal towns, e.g. "Croydon CR0") can false-ghost
 * against an extracted city "London" — a visible, fixable ghost in review
 * beats a confident wrong-town pin.
 */
export function localityConsistent(
    extracted: { city?: string | null; area?: string | null },
    place: { city?: string | null; formattedAddress?: string | null },
    options: { requireCity?: boolean } = {},
): boolean {
    // The background completeness resolver is intentionally stricter than the
    // interactive review flow. It may only auto-accept when the extracted CITY
    // is present and a city token is present in Google's locality/address. An
    // area-only or missing-provider signal is not enough for an unattended
    // write. Existing interactive callers keep the historical lenient default.
    if (options.requireCity) {
        const wantedCity = new Set(
            normalizeName(extracted.city).split(' ').filter(Boolean),
        );
        const providerCity = normalizeName(place.city);
        // Prefer Google's structured locality. Falling back to the full address
        // while a structured city exists would accept "London Road, Hertford"
        // for an extracted city London.
        const providerLocality = new Set(
            normalizeName(providerCity || place.formattedAddress)
                .split(' ')
                .filter(Boolean),
        );
        if (wantedCity.size === 0 || providerLocality.size === 0) return false;
        return [...wantedCity].some((token) => providerLocality.has(token));
    }

    const wanted = [extracted.city, extracted.area]
        .map((w) => normalizeName(w))
        .filter((w) => w.length > 0);
    if (wanted.length === 0) return true;
    const hay = new Set(
        normalizeName([place.city, place.formattedAddress].filter(Boolean).join(' '))
            .split(' ')
            .filter(Boolean),
    );
    if (hay.size === 0) return true;
    return wanted.some((w) => w.split(' ').some((tok) => hay.has(tok)));
}

export type InteractiveCandidateDecision =
    | 'matched'
    | 'no_result'
    | 'name_reject'
    | 'locality_reject';

/**
 * Preserve the exact interactive Places gates as an explicit provenance
 * decision. Callers used to collapse all three non-match branches to `null`,
 * which made a terminal name/locality rejection indistinguishable from an
 * ordinary empty result.
 */
export function classifyInteractiveCandidate(
    extracted: { name?: string | null; city?: string | null; area?: string | null },
    place: { name?: string | null; city?: string | null; formattedAddress?: string | null } | null,
): InteractiveCandidateDecision {
    if (!place) return 'no_result';
    if (!namesOverlap(extracted.name, place.name)) return 'name_reject';
    if (!localityConsistent(extracted, place)) return 'locality_reject';
    return 'matched';
}

// ── TICKET-195: unattended deferred-resolution scorer ───────────────────────

/** Frozen completeness thresholds. Changing one is a product-contract change. */
export const DEFERRED_NAME_THRESHOLD = 0.85;
export const DEFERRED_AMBIGUITY_MARGIN = 0.1;

/** Set-token Jaccard over the same normalizer used by the import deduper. */
export function tokenJaccard(
    a: string | null | undefined,
    b: string | null | undefined,
): number {
    const left = new Set(normalizeName(a).split(' ').filter(Boolean));
    const right = new Set(normalizeName(b).split(' ').filter(Boolean));
    if (left.size === 0 || right.size === 0) return 0;

    let intersection = 0;
    for (const token of left) {
        if (right.has(token)) intersection += 1;
    }
    const union = new Set([...left, ...right]).size;
    return union === 0 ? 0 : intersection / union;
}

export interface DeferredPlaceCandidate {
    externalId: string;
    name: string | null;
    city?: string | null;
    formattedAddress?: string | null;
}

export interface DeferredCandidateScore extends DeferredPlaceCandidate {
    nameScore: number;
    cityConfirmed: boolean;
}

export type DeferredResolutionDecision =
    | 'matched'
    | 'no_result'
    | 'name_reject'
    | 'locality_reject'
    | 'ambiguous';

export interface DeferredResolutionResult {
    decision: DeferredResolutionDecision;
    match: DeferredCandidateScore | null;
    scores: DeferredCandidateScore[];
}

/**
 * Score Google Text Search candidates for an unattended completeness repair.
 *
 * Decision ordering is deliberate and produces an actionable provenance
 * reason: first establish that any name clears 0.85, then require the city,
 * then reject a top-two margin below 0.1. Only the final eligible set can be
 * auto-matched. Interactive import review continues using its lenient guards.
 */
export function scoreDeferredCandidates(
    extracted: { name?: string | null; city?: string | null },
    candidates: DeferredPlaceCandidate[],
): DeferredResolutionResult {
    if (candidates.length === 0) {
        return { decision: 'no_result', match: null, scores: [] };
    }

    const scores = candidates.map((candidate): DeferredCandidateScore => ({
        ...candidate,
        nameScore: tokenJaccard(extracted.name, candidate.name),
        cityConfirmed: localityConsistent(
            { city: extracted.city ?? null },
            { city: candidate.city ?? null, formattedAddress: candidate.formattedAddress ?? null },
            { requireCity: true },
        ),
    })).sort((a, b) => {
        if (b.nameScore !== a.nameScore) return b.nameScore - a.nameScore;
        return a.externalId.localeCompare(b.externalId);
    });

    const nameEligible = scores.filter((candidate) =>
        candidate.nameScore >= DEFERRED_NAME_THRESHOLD
    );
    if (nameEligible.length === 0) {
        return { decision: 'name_reject', match: null, scores };
    }

    const localityEligible = nameEligible.filter((candidate) => candidate.cityConfirmed);
    if (localityEligible.length === 0) {
        return { decision: 'locality_reject', match: null, scores };
    }

    if (
        localityEligible.length > 1 &&
        localityEligible[0].nameScore - localityEligible[1].nameScore <
            DEFERRED_AMBIGUITY_MARGIN
    ) {
        return { decision: 'ambiguous', match: null, scores };
    }

    return { decision: 'matched', match: localityEligible[0], scores };
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
