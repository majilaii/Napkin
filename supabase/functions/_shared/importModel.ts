/** Server-only model transport and cache identity for restaurant imports. */
export const EXTRACTION_MODEL_DEFAULT = 'gpt-5.6-luna';
export const EXTRACTION_CONTRACT_VERSION = 'featured-destinations-v2';
export const EXTRACTION_REASONING_EFFORT = 'low';

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
    if (['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'].includes(model)) return 'openai';
    if (model === 'claude-haiku-4-5-20251001') return 'anthropic';
    throw new ExtractionError('EXTRACTION_NOT_CONFIGURED', 'Unsupported extraction model');
}

export function extractionKeyName(model = getExtractionModel()): string {
    return getExtractionProvider(model) === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
}

export function extractionCacheContract(model = getExtractionModel()): string {
    return `${EXTRACTION_CONTRACT_VERSION}:${getExtractionProvider(model) === 'openai' ? EXTRACTION_REASONING_EFFORT : 'temperature-0'}`;
}

export function isCurrentExtractionCache(row: unknown, model = getExtractionModel()): boolean {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
    const r = row as Record<string, unknown>;
    const extracted = r.extracted;
    return r.model === model && !!extracted && typeof extracted === 'object' &&
        !Array.isArray(extracted) &&
        (extracted as Record<string, unknown>).contract === extractionCacheContract(model);
}

const nullableString = { type: ['string', 'null'] };
const candidateProperties = {
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

function candidateSchema(cap: number) {
    return {
        type: 'object',
        properties: {
            candidates: {
                type: 'array',
                maxItems: cap,
                items: {
                    type: 'object',
                    properties: candidateProperties,
                    required: Object.keys(candidateProperties),
                    additionalProperties: false,
                },
            },
        },
        required: ['candidates'],
        additionalProperties: false,
    };
}

function isCandidate(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const c = value as Record<string, unknown>;
    const strings = ['name', 'city', 'area', 'cuisine', 'address', 'booking_url', 'hours', 'google_place_id'];
    return Object.keys(c).length === Object.keys(candidateProperties).length &&
        strings.every(k => c[k] === null || typeof c[k] === 'string') &&
        typeof c.city_inferred === 'boolean' &&
        ['high', 'low'].includes(c.confidence as string) &&
        ['recommended', 'warned', 'neutral'].includes(c.stance as string);
}

/** Never salvage truncated structured output into a successful partial list. */
export function parseOpenAIExtraction(data: unknown, cap: number): string {
    const invalid = () => new ExtractionError('EXTRACTION_INVALID', 'Import model returned an incomplete or invalid answer');
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
    let parsed: unknown;
    try { parsed = JSON.parse(texts.join('')); } catch { throw invalid(); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalid();
    const object = parsed as Record<string, unknown>;
    if (Object.keys(object).length !== 1 || !Array.isArray(object.candidates) ||
        object.candidates.length > cap || !object.candidates.every(isCandidate)) throw invalid();
    return JSON.stringify(object.candidates);
}

export async function callExtractionModel(
    messages: ExtractionMessage[],
    system: string,
    cap: number,
    maxTokens: number,
    signal?: AbortSignal,
    temperature = 0,
): Promise<string> {
    signal ??= AbortSignal.timeout(15000);
    signal.throwIfAborted();
    const model = getExtractionModel();
    const provider = getExtractionProvider(model);
    const key = Deno.env.get(extractionKeyName(model))?.trim();
    if (!key) throw new ExtractionError('EXTRACTION_NOT_CONFIGURED', 'Import model credential is not configured');
    const openai = provider === 'openai';
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
                text: { format: { type: 'json_schema', name: 'import_destinations', strict: true, schema: candidateSchema(cap) } },
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
        const providerCode = errorBody?.error?.code;
        const safeCode = typeof providerCode === 'string' && /^[a-z_]{1,60}$/.test(providerCode) ? providerCode : 'unknown';
        throw new ExtractionError('EXTRACTION_UNAVAILABLE', `Import model request failed (${res.status}, ${safeCode})`);
    }
    let data: any;
    try { data = await res.json(); } catch (error) {
        if (signal.aborted || isExtractionAbort(error)) throw error;
        throw new ExtractionError('EXTRACTION_INVALID', 'Import model response was not JSON');
    }
    const raw = openai ? parseOpenAIExtraction(data, cap) : data?.content?.find((b: any) => b.type === 'text')?.text;
    if (typeof raw !== 'string' || !raw.trim()) throw new ExtractionError('EXTRACTION_INVALID', 'Import model response contained no answer');
    console.info('import_model_usage', {
        model, contract: extractionCacheContract(model), duration_ms: Date.now() - started,
        input_tokens: data?.usage?.input_tokens ?? null,
        output_tokens: data?.usage?.output_tokens ?? null,
        reasoning_tokens: data?.usage?.output_tokens_details?.reasoning_tokens ?? null,
    });
    return raw;
}
