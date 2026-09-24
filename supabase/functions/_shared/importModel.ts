/** Server-only model transport and cache identity for restaurant imports. */
export const EXTRACTION_MODEL_DEFAULT = 'claude-opus-5-5';
export const EXTRACTION_CONTRACT_VERSION = 'featured-destinations-v2';
export const EXTRACTION_REASONING_EFFORT = 'medium';
// Opus 5.5 always thinks; effort is its only thinking control. Low keeps the
// wait short for an extraction the prompt already spells out.
export const ANTHROPIC_EXTRACTION_EFFORT = 'low';
// Thinking counts toward max_tokens, so the visible JSON needs room beyond it.
const ANTHROPIC_THINKING_HEADROOM = 4096;
// Opus answers slower than the models these waits were first sized for. One
// ceiling for a call that has no caller deadline; callers size their own stages.
export const EXTRACTION_TIMEOUT_MS = 45000;

const OPENAI_MODELS = ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'];
// Structured outputs guarantee the {candidates} object; Haiku stays the
// free-text rollback it was before (temperature 0, bare array).
const ANTHROPIC_STRUCTURED_MODELS = ['claude-opus-5-5'];
const ANTHROPIC_LEGACY_MODELS = ['claude-haiku-4-5-20251001'];

export interface ExtractionMessage {
    role: 'user';
    content: Array<
        | { type: 'text'; text: string }
        | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    >;
}

export class ExtractionError extends Error {
    constructor(
        public readonly code: 'EXTRACTION_NOT_CONFIGURED' | 'EXTRACTION_UNAVAILABLE' | 'EXTRACTION_INVALID',
        message: string,
    ) {
        super(message);
        this.name = 'ExtractionError';
    }
}

export function isExtractionAbort(error: unknown): boolean {
    return error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name);
}

export function getExtractionModel(): string {
    return Deno.env.get('EXTRACTION_MODEL')?.trim() || EXTRACTION_MODEL_DEFAULT;
}

export function getExtractionProvider(model = getExtractionModel()): 'openai' | 'anthropic' {
    if (OPENAI_MODELS.includes(model)) return 'openai';
    if (ANTHROPIC_STRUCTURED_MODELS.includes(model) || ANTHROPIC_LEGACY_MODELS.includes(model)) return 'anthropic';
    throw new ExtractionError('EXTRACTION_NOT_CONFIGURED', 'Unsupported extraction model');
}

/** 'object' = schema-enforced {candidates}; 'array' = the legacy free-text bare array. */
export function extractionOutputFormat(model = getExtractionModel()): 'object' | 'array' {
    return getExtractionProvider(model) === 'openai' || ANTHROPIC_STRUCTURED_MODELS.includes(model) ? 'object' : 'array';
}

/**
 * Guideline 5.1.2(i): the app asks before any import reaches the model and
 * sends the consent version it enforces (`import-v2:anthropic`). A request that
 * would reach the model is refused unless that version names the provider the
 * server uses now, so a build that asked about another provider (266 asked
 * about OpenAI) or never asked (263 to 265) cannot send content to this one.
 * A misconfigured model is left to fail as EXTRACTION_NOT_CONFIGURED.
 */
export function aiConsentRefused(consentVersion: unknown, model = getExtractionModel()): boolean {
    let provider: string;
    try {
        provider = getExtractionProvider(model);
    } catch {
        return false;
    }
    return !(typeof consentVersion === 'string' && consentVersion.endsWith(`:${provider}`));
}

export function extractionKeyName(model = getExtractionModel()): string {
    return getExtractionProvider(model) === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
}

export function extractionCacheContract(model = getExtractionModel()): string {
    const settings = getExtractionProvider(model) === 'openai'
        ? EXTRACTION_REASONING_EFFORT
        : ANTHROPIC_STRUCTURED_MODELS.includes(model) ? `effort-${ANTHROPIC_EXTRACTION_EFFORT}` : 'temperature-0';
    return `${EXTRACTION_CONTRACT_VERSION}:${settings}`;
}

export function isCurrentExtractionCache(row: unknown, model = getExtractionModel()): boolean {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
    const r = row as Record<string, unknown>;
    const extracted = r.extracted;
    return r.model === model && !!extracted && typeof extracted === 'object' &&
        !Array.isArray(extracted) &&
        (extracted as Record<string, unknown>).contract === extractionCacheContract(model);
}

function candidateProperties(nullableString: Record<string, unknown>) {
    return {
        name: nullableString,
        city: nullableString,
        city_inferred: { type: 'boolean' },
        area: nullableString,
        cuisine: nullableString,
        address: nullableString,
        booking_url: nullableString,
        hours: nullableString,
        confidence: { type: 'string', enum: ['high', 'low'] },
        stance: { type: 'string', enum: ['recommended', 'warned', 'neutral'] },
        google_place_id: nullableString,
    };
}
const CANDIDATE_KEY_COUNT = Object.keys(candidateProperties({})).length;

function candidateSchema(nullableString: Record<string, unknown>, maxItems?: number) {
    const properties = candidateProperties(nullableString);
    return {
        type: 'object',
        properties: {
            candidates: {
                type: 'array',
                ...(maxItems === undefined ? {} : { maxItems }),
                items: {
                    type: 'object',
                    properties,
                    required: Object.keys(properties),
                    additionalProperties: false,
                },
            },
        },
        required: ['candidates'],
        additionalProperties: false,
    };
}

// OpenAI strict mode bounds the array itself.
const openAICandidateSchema = (cap: number) => candidateSchema({ type: ['string', 'null'] }, cap);
// Anthropic structured outputs take anyOf nullables and no array bounds, so
// the cap is applied after parsing.
const anthropicCandidateSchema = () => candidateSchema({ anyOf: [{ type: 'string' }, { type: 'null' }] });

function isCandidate(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const c = value as Record<string, unknown>;
    const strings = ['name', 'city', 'area', 'cuisine', 'address', 'booking_url', 'hours', 'google_place_id'];
    return Object.keys(c).length === CANDIDATE_KEY_COUNT &&
        strings.every(k => c[k] === null || typeof c[k] === 'string') &&
        typeof c.city_inferred === 'boolean' &&
        ['high', 'low'].includes(c.confidence as string) &&
        ['recommended', 'warned', 'neutral'].includes(c.stance as string);
}

const invalid = () => new ExtractionError('EXTRACTION_INVALID', 'Import model returned an incomplete or invalid answer');

function candidatesFromObjectJson(text: string, cap: number, overCap: 'reject' | 'truncate'): string {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw invalid(); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalid();
    const object = parsed as Record<string, unknown>;
    if (Object.keys(object).length !== 1 || !Array.isArray(object.candidates) ||
        !object.candidates.every(isCandidate)) throw invalid();
    if (object.candidates.length > cap && overCap === 'reject') throw invalid();
    return JSON.stringify(object.candidates.slice(0, cap));
}

/** Never salvage truncated structured output into a successful partial list. */
export function parseOpenAIExtraction(data: unknown, cap: number): string {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalid();
    const response = data as Record<string, unknown>;
    if (response.status !== 'completed' || !Array.isArray(response.output)) throw invalid();
    const texts: string[] = [];
    for (const item of response.output) {
        if (item?.type !== 'message') continue; // reasoning may precede the message
        if (!Array.isArray(item.content)) throw invalid();
        for (const block of item.content) {
            if (block?.type === 'refusal') throw invalid();
            if (block?.type === 'output_text' && typeof block.text === 'string') texts.push(block.text);
        }
    }
    return candidatesFromObjectJson(texts.join(''), cap, 'reject');
}

/**
 * Only a finished turn is an answer: a refusal may not match the schema and
 * max_tokens cuts the JSON off. Thinking blocks can precede the text, so read
 * blocks by type. The schema cannot bound the array; the prompt asks for the
 * first `cap` places, so a longer list keeps those.
 */
export function parseAnthropicStructuredExtraction(data: unknown, cap: number): string {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalid();
    const response = data as Record<string, unknown>;
    if (response.stop_reason !== 'end_turn' || !Array.isArray(response.content)) throw invalid();
    const texts = response.content
        .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
        .map((block: any) => block.text as string);
    return candidatesFromObjectJson(texts.join(''), cap, 'truncate');
}

export async function callExtractionModel(
    messages: ExtractionMessage[],
    system: string,
    cap: number,
    maxTokens: number,
    signal?: AbortSignal,
    temperature = 0,
): Promise<string> {
    signal ??= AbortSignal.timeout(EXTRACTION_TIMEOUT_MS);
    signal.throwIfAborted();
    const model = getExtractionModel();
    const provider = getExtractionProvider(model);
    const key = Deno.env.get(extractionKeyName(model))?.trim();
    if (!key) throw new ExtractionError('EXTRACTION_NOT_CONFIGURED', 'Import model credential is not configured');
    const openai = provider === 'openai';
    const structuredAnthropic = ANTHROPIC_STRUCTURED_MODELS.includes(model);
    const started = Date.now();
    let res: Response;
    try {
        res = await fetch(openai ? 'https://api.openai.com/v1/responses' : 'https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: openai
                ? { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }
                : { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify(openai ? {
                model,
                store: false,
                reasoning: { effort: EXTRACTION_REASONING_EFFORT },
                // Total includes hidden reasoning; preserve visible JSON headroom.
                max_output_tokens: maxTokens + 2048,
                instructions: system,
                input: messages.map(message => ({
                    role: message.role,
                    content: message.content.map(block => block.type === 'text'
                        ? { type: 'input_text', text: block.text }
                        : { type: 'input_image', image_url: `data:${block.source.media_type};base64,${block.source.data}`, detail: 'auto' }),
                })),
                text: { format: { type: 'json_schema', name: 'import_destinations', strict: true, schema: openAICandidateSchema(cap) } },
            } : structuredAnthropic ? {
                // No sampling parameters: Opus 5.5 rejects temperature.
                model,
                max_tokens: maxTokens + ANTHROPIC_THINKING_HEADROOM,
                output_config: {
                    effort: ANTHROPIC_EXTRACTION_EFFORT,
                    format: { type: 'json_schema', schema: anthropicCandidateSchema() },
                },
                system,
                messages,
            } : { model, max_tokens: maxTokens, temperature, system, messages }),
            signal,
        });
    } catch (error) {
        if (signal.aborted || isExtractionAbort(error)) throw error;
        throw new ExtractionError('EXTRACTION_UNAVAILABLE', 'Import model request failed');
    }
    if (!res.ok) {
        // Do not log provider response bodies: they can echo private input.
        const errorBody = await res.json().catch(() => null);
        // OpenAI names the failure in error.code, Anthropic in error.type.
        const providerCode = errorBody?.error?.code ?? errorBody?.error?.type;
        const safeCode = typeof providerCode === 'string' && /^[a-z_]{1,60}$/.test(providerCode) ? providerCode : 'unknown';
        throw new ExtractionError('EXTRACTION_UNAVAILABLE', `Import model request failed (${res.status}, ${safeCode})`);
    }
    let data: any;
    try { data = await res.json(); } catch (error) {
        if (signal.aborted || isExtractionAbort(error)) throw error;
        throw new ExtractionError('EXTRACTION_INVALID', 'Import model response was not JSON');
    }
    const raw = openai
        ? parseOpenAIExtraction(data, cap)
        : structuredAnthropic
        ? parseAnthropicStructuredExtraction(data, cap)
        : data?.content?.find((b: any) => b.type === 'text')?.text;
    if (typeof raw !== 'string' || !raw.trim()) throw new ExtractionError('EXTRACTION_INVALID', 'Import model response contained no answer');
    console.info('import_model_usage', {
        model, contract: extractionCacheContract(model), duration_ms: Date.now() - started,
        input_tokens: data?.usage?.input_tokens ?? null,
        output_tokens: data?.usage?.output_tokens ?? null,
        reasoning_tokens: data?.usage?.output_tokens_details?.reasoning_tokens ?? null,
    });
    return raw;
}
