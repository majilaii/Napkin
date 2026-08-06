/**
 * Extraction regression eval (TICKET-086c).
 *
 * Replays checked-in FUSED PERCEPTION TEXT fixtures (caption + on-device OCR
 * lines + ASR transcript — exactly what the client ships as `extracted_text`,
 * post-TICKET-209 in its labeled `[caption]` / `[video text]` sections) through
 * the real server extractor (extractFromTextMulti) and scores recall /
 * forbidden-name violations. No videos needed in the corpus; a bad real-world
 * import becomes a fixture by copying `raw_text` out of extraction_cache.
 *
 * Run:
 *   ANTHROPIC_API_KEY=sk-… npm run eval:extraction
 *   # optionally: EXTRACTION_MODEL=claude-sonnet-5 npm run eval:extraction
 *
 * Skips green when no key is set (safe for CI / pre-commit shells).
 * Deliberately OUTSIDE supabase/functions/ — the pre-commit deno pass runs
 * without --allow-net and must never hit the Anthropic API. The scoring rules
 * live in score.ts (pure, unit-tested by score.test.ts).
 *
 * Fixture schema (fixtures/*.json):
 *   {
 *     "name": string, "source_url": string, "notes": string,
 *     "fused_text": string, "cap": number,
 *     "context": {                                          // optional, TICKET-209
 *       "source_kind": "video" | "photo",
 *       "has_video_text"?: boolean, "caption_cap"?: number | null,  // video
 *       "slide_count"?: number                                      // photo
 *     },
 *     "expected":  [{ "name": string, "area"?: string }],   // must be extracted
 *     "optional":  [{ "name": string }],                    // fine either way
 *     "forbidden": [{ "name": string, "why": string,
 *                     "allow_if_warned"?: boolean }],       // must be absent
 *                     // (or extracted with stance 'warned' when allowed)
 *     "fail_on_extras": boolean,                            // TICKET-209
 *     "min_recall": number                                  // 0..1
 *   }
 *
 * TICKET-209: `fail_on_extras` promotes ANY unlisted candidate to a violation.
 * Named `forbidden` entries only catch hallucinations we already predicted; an
 * over-detection nobody anticipated (the exact bug this ticket fixes) used to
 * print as a harmless "extras:" line and still PASS. `context` replays the real
 * extraction context so a fixture exercises the prompt block the server would
 * actually have sent.
 */
import { extractFromTextMulti } from '../../../supabase/functions/_shared/visionExtract.ts';
import { type Fixture, scoreFixture, toExtractionContext } from './score.ts';

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
    const candidates = await extractFromTextMulti(
        f.fused_text,
        undefined,
        f.cap,
        toExtractionContext(f.context),
    );
    const { pass, hits, misses, extras, violations } = scoreFixture(f, candidates);
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
