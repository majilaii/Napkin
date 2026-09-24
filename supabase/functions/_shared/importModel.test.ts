import { assertEquals, assertRejects, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
    aiConsentRefused, ExtractionError, EXTRACTION_TIMEOUT_MS, extractionCacheContract, extractionOutputFormat, getExtractionModel,
    isCurrentExtractionCache, parseAnthropicStructuredExtraction, parseOpenAIExtraction,
} from './importModel.ts';
import { extractFromText, extractFromTextMulti, extractFromVisionMulti } from './visionExtract.ts';

const venue = {
    name: 'Keiko Uchida', city: 'London', city_inferred: false, area: 'Notting Hill',
    cuisine: null, address: null, booking_url: null, hours: null,
    confidence: 'high', stance: 'recommended', google_place_id: null,
};
const second = { ...venue, name: 'Bao Soho', area: 'Soho' };
// OpenAI Responses API shape.
const response = (candidates: unknown[]) => ({
    status: 'completed',
    output: [
        { type: 'reasoning', summary: [] },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ candidates }) }] },
    ],
});
// Anthropic Messages API shape. Opus 5.5 always thinks, and under the default
// display the thinking block comes first with empty text.
const anthropicResponse = (candidates: unknown[], stopReason = 'end_turn') => ({
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    stop_reason: stopReason,
    content: [
        { type: 'thinking', thinking: '', signature: 'test-signature' },
        { type: 'text', text: JSON.stringify({ candidates }) },
    ],
    usage: { input_tokens: 1200, output_tokens: 180 },
});

type Requests = Array<{ url: string; init: RequestInit; body: any }>;

async function withModelTest(
    run: (requests: Requests) => Promise<void>,
    candidates: unknown[] = [venue],
    model: 'opus' | 'luna' = 'opus',
) {
    const keys = ['EXTRACTION_MODEL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
    const before = keys.map(key => Deno.env.get(key));
    const originalFetch = globalThis.fetch;
    const requests: Requests = [];
    try {
        Deno.env.delete('OPENAI_API_KEY');
        Deno.env.delete('ANTHROPIC_API_KEY');
        if (model === 'opus') {
            Deno.env.delete('EXTRACTION_MODEL');
            Deno.env.set('ANTHROPIC_API_KEY', 'test-only-anthropic');
        } else {
            Deno.env.set('EXTRACTION_MODEL', 'gpt-5.6-luna');
            Deno.env.set('OPENAI_API_KEY', 'test-only-openai');
        }
        globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
            requests.push({ url: String(url), init: init!, body: JSON.parse(String(init?.body)) });
            return Promise.resolve(Response.json(model === 'opus' ? anthropicResponse(candidates) : response(candidates)));
        }) as typeof fetch;
        await run(requests);
    } finally {
        globalThis.fetch = originalFetch;
        keys.forEach((key, i) => before[i] === undefined ? Deno.env.delete(key) : Deno.env.set(key, before[i]!));
    }
}

/** Every object in a structured-output schema must close its properties. */
function assertClosedObjects(schema: any) {
    if (!schema || typeof schema !== 'object') return;
    if (schema.type === 'object') assertEquals(schema.additionalProperties, false);
    for (const value of Object.values(schema)) {
        if (Array.isArray(value)) value.forEach(assertClosedObjects);
        else assertClosedObjects(value);
    }
}

Deno.test('Opus 5.5 default sends structured text at low effort with thinking room and no sampling parameters', async () => {
    await withModelTest(async requests => {
        const signal = new AbortController().signal;
        const input = '[title]\nKeiko Uchida\n[caption]\nMatcha in London';
        const candidates = await extractFromTextMulti(input, signal, 12);
        assertEquals(candidates[0].name, venue.name);
        assertEquals(requests.length, 1);
        const { url, init, body } = requests[0];
        assertEquals(url, 'https://api.anthropic.com/v1/messages');
        assertEquals(getExtractionModel(), 'claude-opus-5-5');
        assertEquals(extractionOutputFormat(), 'object');
        assertEquals(body.model, 'claude-opus-5-5');
        // Opus 5.5 rejects sampling parameters and any thinking setting but adaptive.
        for (const field of ['temperature', 'top_p', 'top_k', 'thinking']) assertEquals(field in body, false);
        assertEquals(body.output_config.effort, 'low');
        assertEquals(body.output_config.format.type, 'json_schema');
        const schema = body.output_config.format.schema;
        assertEquals(schema.required, ['candidates']);
        // Array bounds are not accepted by Anthropic structured outputs.
        assertEquals('maxItems' in schema.properties.candidates, false);
        assertEquals(schema.properties.candidates.items.properties.name, { anyOf: [{ type: 'string' }, { type: 'null' }] });
        assertEquals(schema.properties.candidates.items.required.length, 11);
        assertClosedObjects(schema);
        // Listicle budget (2560) plus room for thinking, which counts toward max_tokens.
        assertEquals(body.max_tokens, 2560 + 4096);
        assertEquals(init.signal, signal);
        const headers = new Headers(init.headers);
        assertEquals(headers.get('x-api-key'), 'test-only-anthropic');
        assertEquals(headers.get('anthropic-version'), '2023-06-01');
        assertEquals(headers.get('Authorization'), null);
        assertEquals(body.messages[0].content[0].type, 'text');
        assertEquals(body.messages[0].content[0].text.includes(input), true);
        assertEquals(body.system.includes('JSON object containing a candidates array'), true);
        assertEquals(body.system.includes('no wrapper object'), false);
    });
});

Deno.test('Opus image and single-candidate wrappers use the same provider and candidate contract', async () => {
    await withModelTest(async requests => {
        const results = await extractFromVisionMulti('aGVsbG8=', 'image/jpeg', 'Keiko Uchida');
        assertEquals(results[0].area, 'Notting Hill');
        assertEquals(requests[0].body.messages[0].content[0], {
            type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'aGVsbG8=' },
        });
        assertEquals(requests[0].body.max_tokens, 2048 + 4096);
        assertEquals((await extractFromText('Keiko Uchida')).name, venue.name);
        assertEquals(requests.length, 2);
    });
});

Deno.test('valid empty Opus extraction stays empty without a paid retry', async () => {
    await withModelTest(async requests => {
        assertEquals(await extractFromTextMulti('Water bottle label'), []);
        assertEquals(requests.length, 1);
    }, []);
});

Deno.test('an Opus answer longer than the cap keeps the first places, as the prompt asks', async () => {
    await withModelTest(async requests => {
        const results = await extractFromTextMulti('Keiko Uchida then Bao Soho', undefined, 1);
        assertEquals(results.map(r => r.name), [venue.name]);
        assertEquals(requests.length, 1);
    }, [venue, second]);
});

Deno.test('missing credential and cancellation propagate instead of pretending no destinations exist', async () => {
    await withModelTest(async requests => {
        Deno.env.delete('ANTHROPIC_API_KEY');
        await assertRejects(() => extractFromText('A cafe'), ExtractionError, 'credential');
        Deno.env.set('ANTHROPIC_API_KEY', 'test-only-anthropic');
        const controller = new AbortController(); controller.abort();
        await assertRejects(() => extractFromTextMulti('A cafe', controller.signal), DOMException);
        assertEquals(requests.length, 0);
    });
});

Deno.test('HTTP failures, refusals and cut-off answers never become successful empty or partial extraction', async () => {
    await withModelTest(async () => {
        globalThis.fetch = () => Promise.resolve(Response.json(
            { type: 'error', error: { type: 'invalid_request_error', message: 'private source text' } },
            { status: 400 },
        ));
        const rejected = await assertRejects(() => extractFromTextMulti('A cafe'), ExtractionError, '(400, invalid_request_error)');
        assertEquals(rejected.message.includes('private source text'), false);
        globalThis.fetch = () => Promise.resolve(Response.json({ error: { message: 'private source text' } }, { status: 429 }));
        await assertRejects(() => extractFromTextMulti('A cafe'), ExtractionError, '(429, unknown)');
        const cutOff = {
            ...anthropicResponse([venue], 'max_tokens'),
            content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: '{"candidates":[' }],
        };
        const thinkingOnly = { ...anthropicResponse([]), content: [{ type: 'thinking', thinking: '', signature: 's' }] };
        for (const body of [
            anthropicResponse([venue], 'refusal'),
            anthropicResponse([venue], 'max_tokens'),
            cutOff,
            thinkingOnly,
            anthropicResponse([{ name: 'invalid shape' }]),
        ]) {
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

Deno.test('a call with no caller deadline waits up to the shared model ceiling', async () => {
    const originalTimeout = AbortSignal.timeout;
    const ceilings: number[] = [];
    AbortSignal.timeout = (ms: number) => {
        ceilings.push(ms);
        return new AbortController().signal;
    };
    try {
        await withModelTest(async () => {
            await extractFromText('Keiko Uchida');
        });
    } finally {
        AbortSignal.timeout = originalTimeout;
    }
    assertEquals(ceilings, [EXTRACTION_TIMEOUT_MS]);
    assertEquals(EXTRACTION_TIMEOUT_MS, 45000);
});

Deno.test('structured response validation rejects unknown fields and malformed JSON for both providers', () => {
    assertThrows(() => parseOpenAIExtraction(response([venue, venue]), 1), ExtractionError);
    assertThrows(() => parseOpenAIExtraction(response([{ ...venue, restaurant_id: 'not-content-derived' }]), 6), ExtractionError);
    assertThrows(() => parseOpenAIExtraction({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"candidates":[' }] }] }, 6), ExtractionError);
    assertEquals(parseOpenAIExtraction(response([]), 6), '[]');

    assertThrows(() => parseAnthropicStructuredExtraction(anthropicResponse([{ ...venue, restaurant_id: 'not-content-derived' }]), 6), ExtractionError);
    assertThrows(() => parseAnthropicStructuredExtraction({ ...anthropicResponse([]), content: [{ type: 'text', text: '[]' }] }, 6), ExtractionError);
    assertThrows(() => parseAnthropicStructuredExtraction({ ...anthropicResponse([]), content: [{ type: 'text', text: '{"candidates":[],"extra":1}' }] }, 6), ExtractionError);
    assertThrows(() => parseAnthropicStructuredExtraction(null, 6), ExtractionError);
    assertEquals(parseAnthropicStructuredExtraction(anthropicResponse([]), 6), '[]');
    assertEquals(parseAnthropicStructuredExtraction(anthropicResponse([venue, second]), 1), JSON.stringify([venue]));
});

Deno.test('Luna stays selectable: bounded structured text with no Anthropic credential or sampling parameters', async () => {
    await withModelTest(async requests => {
        const signal = new AbortController().signal;
        const input = '[title]\nKeiko Uchida\n[caption]\nMatcha in London';
        const candidates = await extractFromTextMulti(input, signal, 12);
        assertEquals(candidates[0].name, venue.name);
        assertEquals(requests.length, 1);
        const { url, init, body } = requests[0];
        assertEquals(url, 'https://api.openai.com/v1/responses');
        assertEquals(getExtractionModel(), 'gpt-5.6-luna');
        assertEquals(extractionOutputFormat(), 'object');
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
        assertEquals(await extractFromVisionMulti('aGVsbG8=', 'image/jpeg', 'Keiko Uchida').then(r => r[0].area), 'Notting Hill');
        assertEquals(requests[1].body.input[0].content[0], {
            type: 'input_image', image_url: 'data:image/jpeg;base64,aGVsbG8=', detail: 'auto',
        });
    }, [venue], 'luna');
});

Deno.test('explicit Haiku rollback uses only the Anthropic endpoint, temperature 0 and the bare-array prompt', async () => {
    await withModelTest(async () => {
        Deno.env.set('EXTRACTION_MODEL', 'claude-haiku-4-5-20251001');
        assertEquals(extractionOutputFormat(), 'array');
        globalThis.fetch = (url, init) => {
            assertEquals(String(url), 'https://api.anthropic.com/v1/messages');
            assertEquals(new Headers(init?.headers).get('Authorization'), null);
            const body = JSON.parse(String(init?.body));
            assertEquals(body.temperature, 0);
            assertEquals(body.max_tokens, 2048);
            assertEquals('output_config' in body, false);
            assertEquals(body.system.includes('no wrapper object'), true);
            return Promise.resolve(Response.json({ content: [{ type: 'text', text: JSON.stringify([venue]) }] }));
        };
        assertEquals((await extractFromTextMulti('Keiko Uchida London'))[0].name, venue.name);
    });
});

Deno.test('unknown models fail as not configured instead of guessing a provider', async () => {
    await withModelTest(async requests => {
        Deno.env.set('EXTRACTION_MODEL', 'claude-opus-5');
        await assertRejects(() => extractFromTextMulti('A cafe'), ExtractionError, 'Unsupported');
        assertEquals(requests.length, 0);
    });
});

Deno.test('cache validity requires exact model and extraction contract for every content hash', () => {
    const opus = 'claude-opus-5-5';
    assertEquals(extractionCacheContract(opus), 'featured-destinations-v2:effort-low');
    const opusRow = { model: opus, extracted: { contract: extractionCacheContract(opus), candidates: [venue] } };
    assertEquals(isCurrentExtractionCache(opusRow, opus), true);
    assertEquals(isCurrentExtractionCache({ ...opusRow, model: 'gpt-5.6-luna' }, opus), false);
    assertEquals(isCurrentExtractionCache({ model: opus, extracted: { ...opusRow.extracted, contract: 'featured-destinations-v2:medium' } }, opus), false);

    const model = 'gpt-5.6-luna';
    const row = { model, extracted: { contract: extractionCacheContract(model), candidates: [venue] } };
    assertEquals(isCurrentExtractionCache(row, model), true);
    assertEquals(isCurrentExtractionCache({ ...row, model: 'claude-haiku-4-5-20251001' }, model), false);
    assertEquals(isCurrentExtractionCache({ model, extracted: { candidates: [venue] } }, model), false);
    assertEquals(isCurrentExtractionCache({ model, extracted: { ...row.extracted, contract: 'old' } }, model), false);
    assertEquals(isCurrentExtractionCache({ model, extracted: { ...row.extracted, contract: 'featured-destinations-v2:low' } }, model), false);
    assertEquals(isCurrentExtractionCache(null, model), false);
});

Deno.test('model work needs consent that names the provider the server uses now', () => {
    const opus = 'claude-opus-5-5';
    // Builds 263 to 265 send nothing; build 266 asked about OpenAI.
    assertEquals(aiConsentRefused(undefined, opus), true);
    assertEquals(aiConsentRefused('import-v1:openai', opus), true);
    assertEquals(aiConsentRefused({ version: 'import-v2:anthropic' }, opus), true);
    assertEquals(aiConsentRefused('import-v2:anthropic', opus), false);
    assertEquals(aiConsentRefused('import-v2:anthropic', 'claude-haiku-4-5-20251001'), false);
    // A rollback to OpenAI refuses Anthropic-only consent and honours 266's.
    assertEquals(aiConsentRefused('import-v2:anthropic', 'gpt-5.6-luna'), true);
    assertEquals(aiConsentRefused('import-v1:openai', 'gpt-5.6-luna'), false);
    // A misconfigured model fails later as EXTRACTION_NOT_CONFIGURED instead.
    assertEquals(aiConsentRefused(undefined, 'claude-opus-5'), false);
});
