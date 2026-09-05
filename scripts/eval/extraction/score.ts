/**
 * score.ts — pure scoring for the extraction eval (TICKET-209).
 *
 * Split out of run.ts so the fixture schema, the fuzzy matcher and the
 * pass/fail rule are unit-testable WITHOUT an ANTHROPIC_API_KEY and without
 * run.ts's top-level Deno.exit(). run.ts stays the IO shell (read fixtures →
 * call the real extractor → print).
 */
import type {
    ExtractedCandidate,
    ExtractionContext,
} from '../../../supabase/functions/_shared/visionExtract.ts';

export interface FixtureSpot {
    name: string;
    area?: string;
}
export interface ForbiddenSpot {
    name: string;
    why: string;
    allow_if_warned?: boolean;
}
export interface FixtureContext {
    source_kind: 'video' | 'photo';
    /** Default true — set false to replay an old-client/fused-body shape. */
    caption_present?: boolean;
    has_video_text?: boolean;
    caption_cap?: number | null;
    slide_count?: number;
}
export interface Fixture {
    name: string;
    source_url: string;
    notes?: string;
    fused_text: string;
    cap: number;
    /** TICKET-209: replays the extraction context the server would have sent. */
    context?: FixtureContext;
    expected: FixtureSpot[];
    optional?: FixtureSpot[];
    forbidden?: ForbiddenSpot[];
    /** TICKET-209: promote ANY unlisted candidate to a violation. */
    fail_on_extras?: boolean;
    min_recall: number;
}

export interface FixtureScore {
    pass: boolean;
    recall: number;
    hits: string[];
    misses: string[];
    extras: ExtractedCandidate[];
    violations: string[];
}

/** Fixture wire shape → the extractor's context union. */
export function toExtractionContext(
    c: FixtureContext | undefined,
): ExtractionContext | undefined {
    if (!c) return undefined;
    if (c.source_kind === 'photo') {
        return { sourceKind: 'photo', slideCount: c.slide_count ?? 1 };
    }
    return {
        sourceKind: 'video',
        // Fixtures model the post-209 labeled-body shape; a fused/no-caption
        // fixture opts out of caption authority explicitly; scene-noise rules
        // still apply to video without a caption.
        captionPresent: c.caption_present ?? true,
        hasVideoText: c.has_video_text ?? true,
        captionCap: c.caption_cap ?? null,
    };
}

function normalize(name: string): string {
    return name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^the /, '');
}

/** Fuzzy name match: equality, or every token of the shorter name in the longer. */
export function namesMatch(a: string, b: string): boolean {
    const na = normalize(a);
    const nb = normalize(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    const ta = na.split(' ');
    const tb = nb.split(' ');
    const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
    const longSet = new Set(long);
    return short.every((t) => longSet.has(t));
}

/**
 * Score one fixture against the candidates the extractor returned.
 *
 * TICKET-209: `fail_on_extras` is the teeth. Before it, `violations` came
 * SOLELY from explicitly-named `forbidden` entries, so an unpredictable
 * hallucination — the exact founder-repro bug — printed as a harmless
 * "extras:" line and the fixture still PASSED.
 */
export function scoreFixture(
    f: Fixture,
    candidates: ExtractedCandidate[],
): FixtureScore {
    const names = candidates.map((c) => c.name ?? '');

    const hits: string[] = [];
    const misses: string[] = [];
    for (const exp of f.expected) {
        if (names.some((n) => namesMatch(n, exp.name))) hits.push(exp.name);
        else misses.push(exp.name);
    }

    const knowns = [...f.expected, ...(f.optional ?? []), ...(f.forbidden ?? [])];
    const extras = candidates.filter(
        (c) => c.name && !knowns.some((k) => namesMatch(c.name!, k.name)),
    );

    const violations: string[] = [];
    for (const fb of f.forbidden ?? []) {
        const match = candidates.find((c) => c.name && namesMatch(c.name, fb.name));
        if (!match) continue;
        if (fb.allow_if_warned && match.stance === 'warned') continue;
        violations.push(
            `${fb.name} (${fb.why}) extracted${
                fb.allow_if_warned ? ` with stance '${match.stance ?? 'none'}'` : ''
            }`,
        );
    }

    // On a fixture whose ground truth is complete (an enumerated caption), ANY
    // unlisted candidate is a hallucination — no need to have guessed its name.
    if (f.fail_on_extras) {
        for (const extra of extras) {
            violations.push(`${extra.name} (unexpected extra — fail_on_extras)`);
        }
    }

    const recall = f.expected.length === 0 ? 1 : hits.length / f.expected.length;
    return {
        pass: recall >= f.min_recall && violations.length === 0,
        recall,
        hits,
        misses,
        extras,
        violations,
    };
}
