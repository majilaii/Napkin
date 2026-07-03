/**
 * Extraction regression eval (TICKET-086c).
 *
 * Replays checked-in FUSED PERCEPTION TEXT fixtures (caption + on-device OCR
 * lines + ASR transcript — exactly what the client ships as `extracted_text`)
 * through the real server extractor (extractFromTextMulti) and scores recall /
 * forbidden-name violations. No videos needed in the corpus; a bad real-world
 * import becomes a fixture by copying `raw_text` out of extraction_cache.
 *
 * Run:
 *   ANTHROPIC_API_KEY=sk-… npm run eval:extraction
 *   # optionally: EXTRACTION_MODEL=claude-sonnet-5 npm run eval:extraction
 *
 * Skips green when no key is set (safe for CI / pre-commit shells).
 * Deliberately OUTSIDE supabase/functions/ — the pre-commit deno pass runs
 * without --allow-net and must never hit the Anthropic API.
 *
 * Fixture schema (fixtures/*.json):
 *   {
 *     "name": string, "source_url": string, "notes": string,
 *     "fused_text": string, "cap": number,
 *     "expected":  [{ "name": string, "area"?: string }],   // must be extracted
 *     "optional":  [{ "name": string }],                    // fine either way
 *     "forbidden": [{ "name": string, "why": string,
 *                     "allow_if_warned"?: boolean }],       // must be absent
 *                     // (or extracted with stance 'warned' when allowed)
 *     "min_recall": number                                  // 0..1
 *   }
 */
import { extractFromTextMulti } from '../../../supabase/functions/_shared/visionExtract.ts';

interface FixtureSpot { name: string; area?: string }
interface ForbiddenSpot { name: string; why: string; allow_if_warned?: boolean }
interface Fixture {
    name: string;
    source_url: string;
    notes?: string;
    fused_text: string;
    cap: number;
    expected: FixtureSpot[];
    optional?: FixtureSpot[];
    forbidden?: ForbiddenSpot[];
    min_recall: number;
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
function namesMatch(a: string, b: string): boolean {
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

if (!Deno.env.get('ANTHROPIC_API_KEY')) {
    console.log('eval:extraction — ANTHROPIC_API_KEY not set, skipping (export it to run).');
    Deno.exit(0);
}

const model = Deno.env.get('EXTRACTION_MODEL') ?? '(default)';
const fixturesDir = new URL('./fixtures/', import.meta.url);
const fixtures: Fixture[] = [];
for await (const entry of Deno.readDir(fixturesDir)) {
    if (!entry.isFile || !entry.name.endsWith('.json')) continue;
    const raw = await Deno.readTextFile(new URL(entry.name, fixturesDir));
    fixtures.push(JSON.parse(raw) as Fixture);
}
fixtures.sort((a, b) => a.name.localeCompare(b.name));

console.log(`eval:extraction — ${fixtures.length} fixtures, model ${model}\n`);

let failed = false;

for (const f of fixtures) {
    const candidates = await extractFromTextMulti(f.fused_text, undefined, f.cap);
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
            `${fb.name} (${fb.why}) extracted${fb.allow_if_warned ? ` with stance '${match.stance ?? 'none'}'` : ''}`,
        );
    }

    const recall = f.expected.length === 0 ? 1 : hits.length / f.expected.length;
    const pass = recall >= f.min_recall && violations.length === 0;
    if (!pass) failed = true;

    console.log(`${pass ? 'PASS' : 'FAIL'}  ${f.name}`);
    console.log(`      recall ${hits.length}/${f.expected.length} (min ${Math.ceil(f.min_recall * f.expected.length)})  ·  ${candidates.length} candidates`);
    if (misses.length) console.log(`      missed: ${misses.join(' · ')}`);
    if (violations.length) console.log(`      FORBIDDEN: ${violations.join(' · ')}`);
    if (extras.length) console.log(`      extras: ${extras.map((e) => `${e.name}${e.stance === 'warned' ? ' (warned)' : ''}`).join(' · ')}`);
    console.log('');
}

if (failed) {
    console.error('eval:extraction — REGRESSION (see FAIL lines above)');
    Deno.exit(1);
}
console.log('eval:extraction — all fixtures pass');
