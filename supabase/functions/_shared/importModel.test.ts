import { assertEquals, assertRejects, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
    ExtractionError, extractionCacheContract, getExtractionModel,
    isCurrentExtractionCache, parseOpenAIExtraction,
} from './importModel.ts';
import { extractFromText, extractFromTextMulti, extractFromVisionMulti } from './visionExtract.ts';

const venue = {
    name: 'Keiko Uchida', city: 'London', city_inferred: false, area: 'Notting Hill',
    cuisine: null, address: null, booking_url: null, hours: null,
    confidence: 'high', stance: 'recommended', google_place_id: null,
};
const response = (candidates: unknown[]) => ({
    status: 'completed',
    output: [
        { type: 'reasoning', summary: [] },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ candidates }) }] },
    ],
});

async function withModelTest(run: (requests: Array<{ url: string; init: RequestInit; body: any }>) => Promise<void>, candidates: unknown[] = [venue]) {
    const keys = ['EXTRACTION_MODEL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
    const before = keys.map(key => Deno.env.get(key));
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; init: RequestInit; body: any }> = [];
    try {
        Deno.env.delete('EXTRACTION_MODEL');
        Deno.env.set('OPENAI_API_KEY', 'test-only-openai');
        Deno.env.delete('ANTHROPIC_API_KEY');
        globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
            requests.push({ url: String(url), init: init!, body: JSON.parse(String(init?.body)) });
            return Promise.resolve(Response.json(response(candidates)));
        }) as typeof fetch;
        await run(requests);
    } finally {
        globalThis.fetch = originalFetch;
        keys.forEach((key, i) => before[i] === undefined ? Deno.env.delete(key) : Deno.env.set(key, before[i]!));
    }
}

Deno.test('Luna default sends bounded structured text with no Anthropic credential or sampling parameters', async () => {
    await withModelTest(async requests => {
        const signal = new AbortController().signal;
        const input = '[title]\nKeiko Uchida\n[caption]\nMatcha in London';
        const candidates = await extractFromTextMulti(input, signal, 12);
        assertEquals(candidates[0].name, venue.name);
        assertEquals(requests.length, 1);
        const { url, init, body } = requests[0];
        assertEquals(url, 'https://api.openai.com/v1/responses');
        assertEquals(getExtractionModel(), 'gpt-5.6-luna');
        assertEquals(body.model, 'gpt-5.6-luna');
        assertEquals(body.store, false);
        assertEquals(body.reasoning, { effort: 'medium' });
        assertEquals(body.max_output_tokens, 4608);
        assertEquals('temperature' in body, false);
        assertEquals('max_tokens' in body, false);
        assertEquals(init.signal, signal);
        assertEquals(new Headers(init.headers).get('x-api-key'), null);
        assertEquals(body.input[0].content[0].type, 'input_text');
        assertEquals(body.input[0].content[0].text.includes(input), true);
        assertEquals(body.text.format.schema.properties.candidates.maxItems, 12);
        assertEquals(body.instructions.includes('JSON object containing a candidates array'), true);
        assertEquals(body.instructions.includes('no wrapper object'), false);
    });
});

Deno.test('Luna image and single-candidate wrappers use the same provider and candidate contract', async () => {
    await withModelTest(async requests => {
        const results = await extractFromVisionMulti('aGVsbG8=', 'image/jpeg', 'Keiko Uchida');
        assertEquals(results[0].area, 'Notting Hill');
        assertEquals(requests[0].body.input[0].content[0], {
            type: 'input_image', image_url: 'data:image/jpeg;base64,aGVsbG8=', detail: 'auto',
        });
        assertEquals((await extractFromText('Keiko Uchida')).name, venue.name);
        assertEquals(requests.length, 2);
    });
});

Deno.test('valid empty Luna extraction stays empty without a paid retry', async () => {
    await withModelTest(async requests => {
        assertEquals(await extractFromTextMulti('Water bottle label'), []);
        assertEquals(requests.length, 1);
    }, []);
});

Deno.test('missing credential and cancellation propagate instead of pretending no destinations exist', async () => {
    await withModelTest(async requests => {
        Deno.env.delete('OPENAI_API_KEY');
        await assertRejects(() => extractFromText('A cafe'), ExtractionError, 'credential');
        const controller = new AbortController(); controller.abort();
        await assertRejects(() => extractFromTextMulti('A cafe', controller.signal), DOMException);
        assertEquals(requests.length, 0);
    });
});

Deno.test('HTTP failures and incomplete/refused answers never become successful empty or partial extraction', async () => {
    await withModelTest(async () => {
        globalThis.fetch = () => Promise.resolve(Response.json({ error: { message: 'private source text' } }, { status: 429 }));
        await assertRejects(() => extractFromTextMulti('A cafe'), ExtractionError, '(429, unknown)');
        const incomplete = { ...response([venue]), status: 'incomplete' };
        const refusal = { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'refused' }] }] };
        for (const body of [incomplete, refusal, response([{ name: 'invalid shape' }])]) {
            globalThis.fetch = () => Promise.resolve(Response.json(body));
            await assertRejects(() => extractFromTextMulti('A cafe'), ExtractionError);
        }
    });
});

Deno.test('default fetch timeout remains a timeout through text, image and single wrappers', async () => {
    await withModelTest(async () => {
        const timeout = new DOMException('Deadline expired', 'TimeoutError');
        globalThis.fetch = () => Promise.reject(timeout);
        for (const extract of [
            () => extractFromTextMulti('A cafe'),
            () => extractFromVisionMulti('aGVsbG8='),
            () => extractFromText('A cafe'),
        ]) {
            assertEquals(await assertRejects(extract), timeout);
        }
    });
});

Deno.test('structured response validation rejects over-cap, unknown fields and malformed JSON', () => {
    assertThrows(() => parseOpenAIExtraction(response([venue, venue]), 1), ExtractionError);
    assertThrows(() => parseOpenAIExtraction(response([{ ...venue, restaurant_id: 'not-content-derived' }]), 6), ExtractionError);
    assertThrows(() => parseOpenAIExtraction({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"candidates":[' }] }] }, 6), ExtractionError);
    assertEquals(parseOpenAIExtraction(response([]), 6), '[]');
});

Deno.test('explicit Haiku rollback uses only the Anthropic endpoint and credential', async () => {
    await withModelTest(async () => {
        Deno.env.set('EXTRACTION_MODEL', 'claude-haiku-4-5-20251001');
        Deno.env.set('ANTHROPIC_API_KEY', 'test-only-anthropic');
        Deno.env.delete('OPENAI_API_KEY');
        globalThis.fetch = (url, init) => {
            assertEquals(String(url), 'https://api.anthropic.com/v1/messages');
            assertEquals(new Headers(init?.headers).get('Authorization'), null);
            assertEquals(JSON.parse(String(init?.body)).temperature, 0);
            return Promise.resolve(Response.json({ content: [{ type: 'text', text: JSON.stringify([venue]) }] }));
        };
        assertEquals((await extractFromTextMulti('Keiko Uchida London'))[0].name, venue.name);
    });
});

Deno.test('cache validity requires exact model and extraction contract for every content hash', () => {
    const model = 'gpt-5.6-luna';
    const row = { model, extracted: { contract: extractionCacheContract(model), candidates: [venue] } };
    assertEquals(isCurrentExtractionCache(row, model), true);
    assertEquals(isCurrentExtractionCache({ ...row, model: 'claude-haiku-4-5-20251001' }, model), false);
    assertEquals(isCurrentExtractionCache({ model, extracted: { candidates: [venue] } }, model), false);
    assertEquals(isCurrentExtractionCache({ model, extracted: { ...row.extracted, contract: 'old' } }, model), false);
    assertEquals(isCurrentExtractionCache({ model, extracted: { ...row.extracted, contract: 'featured-destinations-v2:low' } }, model), false);
    assertEquals(isCurrentExtractionCache(null, model), false);
});
