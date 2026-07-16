/**
 * visionExtract.ts — Anthropic vision/text extraction for multimodal import.
 * TICKET-063 Step 2 (rewrites TICKET-060 Step 2).
 *
 * Exported functions (multi-candidate, TICKET-063):
 *   extractFromTextMulti(caption, signal?, max?, context?) → ExtractedCandidate[]
 *   extractFromVisionMulti(imageBase64, mimeType, caption?, signal?) → ExtractedCandidate[]
 *
 * Single-candidate wrappers (thin, for async screenshot path back-compat):
 *   extractFromText(caption) → ExtractedCandidate       (returns [0] ?? fallback)
 *   extractFromVision(imageBase64, mimeType, caption?) → ExtractedCandidate
 *
 * Model: claude-haiku-4-5-20251001 via EXTRACTION_MODEL env.
 * Returns content-derived fields ONLY — NO restaurant_id, NO already_wishlisted.
 * On any parse/model error → returns [] / confidence:'low' (never throws to the caller).
 *
 * TICKET-063 additions:
 *   - `city_inferred: boolean` on ExtractedCandidate
 *   - Multi-restaurant prompt: extract EVERY distinct restaurant per item
 *   - City inference: hashtags/handle/context → city (mark city_inferred=true)
 *   - Array JSON response format with malformed-tail salvage
 *   - MAX_TOKENS bumped to 1024
 *   - AbortSignal threading for budget compliance
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ExtractionConfidence = 'exact' | 'high' | 'low';

/**
 * Content-derived extraction result.
 * Deliberately omits user-specific fields (already_wishlisted, restaurant_id).
 * TICKET-063: added city_inferred.
 */
export interface ExtractedCandidate {
    name: string | null;
    city: string | null;
    /** TICKET-063: true when city was inferred from hashtags/handle/context, not explicit. */
    city_inferred: boolean;
    /** TICKET-086b: neighborhood/district ("Dalston", "Belsize Park", "E11") —
     * sharpens the Places text query; distinct from city. Optional so legacy
     * candidate constructors (cache reads, google-maps path) stay valid. */
    area?: string | null;
    /** TICKET-086c: how the speaker frames the place. 'warned' = an
     * anti-recommendation ("most OVERRATED spot?", "skip it") — extracted but
     * never auto-saved; review UI surfaces it unticked. Optional so legacy
     * cache rows / constructors stay valid. */
    stance?: 'recommended' | 'warned' | 'neutral';
    cuisine: string | null;
    address: string | null;
    booking_url: string | null;
    hours: string | null;
    confidence: ExtractionConfidence;
    google_place_id: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Real Haiku model id. Never use the bare string "Haiku 4.5".
 * Read from env at runtime; this is the fallback default.
 */
export const EXTRACTION_MODEL_DEFAULT = 'claude-haiku-4-5-20251001';

// TICKET-063 bumped 512→1024; TICKET-086c →2048: six candidates with populated
// address/hours fields overflow 1024 and the truncation salvage silently drops
// the last spot. Haiku output is cheap; headroom costs nothing.
const MAX_TOKENS = 2048;

/**
 * Optional context for text extracted from a photo carousel. The slide count is
 * prompt context only: it preserves carousel boundaries for the per-slide noise
 * rules, but never determines the numeric candidate ceiling.
 */
export interface PhotoExtractionContext {
    sourceKind: 'photo';
    slideCount: number;
}

/** Shared numeric ceiling for video and photo listicles. */
export const LISTICLE_CANDIDATE_CAP = 12;

// Separate transport/context bound. It happens to equal the listicle ceiling,
// but changing the number of downloaded slides must never change candidate cap.
const MAX_PHOTO_SLIDE_COUNT = 12;

// ── System prompts ─────────────────────────────────────────────────────────────

/**
 * Multi-restaurant prompt (TICKET-063).
 * Instructs the model to:
 *   1. Extract EVERY distinct restaurant (not just the most prominent)
 *   2. Infer city from hashtags/handle/context when explicit city is absent
 *   3. Return a top-level JSON array, one object per restaurant
 */
export function validPhotoSlideCount(context?: PhotoExtractionContext): number | null {
    if (
        context?.sourceKind !== 'photo' ||
        !Number.isFinite(context.slideCount) ||
        !Number.isInteger(context.slideCount) ||
        context.slideCount < 1 ||
        context.slideCount > MAX_PHOTO_SLIDE_COUNT
    ) {
        return null;
    }
    return context.slideCount;
}

export function buildMultiSystemPrompt(
    cap: number,
    context?: PhotoExtractionContext,
): string {
    const photoSlideCount = validPhotoSlideCount(context);
    const effectiveCap = photoSlideCount === null ? cap : LISTICLE_CANDIDATE_CAP;
    const photoModeBlock = photoSlideCount === null
        ? ''
        : `

PHOTO CAROUSEL MODE — these rules OVERRIDE the video/general recall rules above:
- Recommendations live in the creator's OVERLAY text, typically a repeated style
  across slides with patterns such as "Name, Area" or "Name — dish". Use the
  explicit [slide N of ${photoSlideCount}] sections as slide boundaries.
- Incidental text visible in the photographed scene is scene noise, NOT a
  recommendation. Do NOT extract neighboring storefront signs, posters, banners,
  event/charity/foundation names, menu items, or text on street furniture merely
  because it looks name-shaped or belongs to a real place.
- Return AT MOST ONE venue per slide unless that slide's overlay or the [caption]
  explicitly lists multiple venue recommendations.
- When unsure whether a string is a creator recommendation or incidental scene
  text, OMIT it. Do not emit a low-confidence candidate for ambiguous scene text.`;

    return `You are a restaurant extraction assistant. Given an image and/or text, extract ALL distinct restaurants mentioned or visible.
Respond with ONLY a JSON array — no prose, no markdown, no wrapper object. Each element matches this schema:
{
  "name": string | null,
  "city": string | null,
  "city_inferred": boolean,
  "area": string | null,
  "cuisine": string | null,
  "address": string | null,
  "booking_url": string | null,
  "hours": string | null,
  "confidence": "high" | "low",
  "stance": "recommended" | "warned" | "neutral",
  "google_place_id": string | null
}

The text often combines TWO noisy channels from a food video:
- on-screen OCR fragments — the creator's own overlays, usually "Name, Area"
  with correct spelling ("Cinder, Belsize Park"), mixed with menu/sign noise
- an automatic speech-recognition (ASR) transcript — proper nouns get garbled
  ("the pickle ring" for "The Picklery"; "Lucky. Enjoy." for "Lucky & Joy";
  "Lang Zhou noodles" for "Lanzhou Lamian Noodle Bar")

Interview/Q&A videos overlay a QUESTION ("BEST PUB?", "MOST OVERRATED SPOT IN
LONDON?") immediately before the answer's "Name, Area" overlay — pair each name
with the question that precedes it; the question sets that place's stance.

Rules:
- stance: "warned" when the place is the answer to a negative question or the
  speaker warns against it ("most overrated?", "skip it", "don't bother",
  "worst") — STILL extract these, never omit them. "recommended" when endorsed
  (praise, any "best X" answer). "neutral" for passing mentions and comparisons
  ("is it a bit like Berenjak?" → Berenjak is neutral).
- Watermarks: a short token recurring through the text in garbled variants
  ("PICANTE", "PICAN", "PICA", "PICANTI") is on-screen channel branding, NOT a
  restaurant — ignore it unless it also appears with an area tag or a spoken
  endorsement.
- Extract EVERY distinct restaurant visible or mentioned. Do NOT collapse multiple restaurants into one.
- When the two channels describe the same place, they are ONE restaurant: prefer
  the OCR spelling ("Name, Area" patterns with proper capitalization) for the
  name; use the spoken context for cuisine/city hints.
- Reconstruct ASR-garbled names to the most plausible REAL restaurant name;
  use surrounding clues (dishes, comparisons, area) to denoise. If you cannot
  confidently reconstruct, keep the garbled name verbatim with confidence "low"
  — never invent a restaurant that isn't grounded in the text.
- area: the neighborhood/district if given ("Dalston", "Belsize Park", "Brixton",
  a UK postcode district like "E11") — distinct from city. Null when absent.
- confidence "high": you are reasonably certain of the restaurant name AND city.
- confidence "low": name is uncertain, or city cannot be determined even by inference.
- city: include the city name when known OR inferable. If the caption/title/hashtags signal a city (e.g. "#londonfood", "@nycfoodie", "my faves in soho"), use that city and set city_inferred=true.
- city_inferred: set true when you inferred the city from context clues (hashtags, handle, phrases like "in soho", "my nyc picks") rather than an explicit label. Set false when the city is stated outright.
- booking_url: only if explicitly visible (Resy, OpenTable URL). Otherwise null.
- google_place_id: only if a Google Maps place_id is visible. Otherwise null.
- If no restaurant is identifiable, return an empty array: []${photoModeBlock}
- Cap at ${effectiveCap} restaurants. If more are present, include only the first ${effectiveCap} mentioned.
- Output ONLY the JSON array. No explanation. No markdown fences.`;
}

// Default (6-cap) prompt — the URL/screenshot/vision callers. The video path
// builds a higher-cap prompt on the fly (listicles run to 10–11 spots).
const MULTI_SYSTEM_PROMPT = buildMultiSystemPrompt(6);

// ── Anthropic API call ────────────────────────────────────────────────────────

interface AnthropicMessage {
    role: 'user';
    content: Array<
        | { type: 'text'; text: string }
        | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
    >;
}

async function callAnthropic(
    messages: AnthropicMessage[],
    modelId: string,
    apiKey: string,
    signal?: AbortSignal,
    system: string = MULTI_SYSTEM_PROMPT,
    maxTokens: number = MAX_TOKENS,
    temperature = 0,
): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: modelId,
            max_tokens: maxTokens,
            // TICKET-086c: unset temperature (API default 1.0) made the same
            // fused text yield different candidate COUNTS run to run — the
            // founder-visible "1 spot on Tuesday, 3 on Wednesday" bug.
            temperature,
            system,
            messages,
        }),
        signal,
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Anthropic API error ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const textBlock = data?.content?.find((b: any) => b.type === 'text');
    if (!textBlock?.text) {
        throw new Error('Anthropic response missing text content');
    }
    return textBlock.text as string;
}

// ── Array response parser ─────────────────────────────────────────────────────

/**
 * Coerce a raw parsed object element into an ExtractedCandidate.
 * Any parse failure → returns a low-confidence null candidate.
 */
function coerceCandidate(p: unknown): ExtractedCandidate {
    const obj = (p && typeof p === 'object' && !Array.isArray(p))
        ? p as Record<string, unknown>
        : {};

    const confidence: ExtractionConfidence =
        obj['confidence'] === 'high' ? 'high' : 'low';

    const stanceRaw = obj['stance'];
    const stance: ExtractedCandidate['stance'] =
        stanceRaw === 'recommended' || stanceRaw === 'warned' || stanceRaw === 'neutral'
            ? stanceRaw
            : undefined;

    return {
        name: typeof obj['name'] === 'string' ? obj['name'].trim() || null : null,
        city: typeof obj['city'] === 'string' ? obj['city'].trim() || null : null,
        city_inferred: obj['city_inferred'] === true,
        area: typeof obj['area'] === 'string' ? obj['area'].trim() || null : null,
        cuisine: typeof obj['cuisine'] === 'string' ? obj['cuisine'].trim() || null : null,
        address: typeof obj['address'] === 'string' ? obj['address'].trim() || null : null,
        booking_url: typeof obj['booking_url'] === 'string' ? obj['booking_url'].trim() || null : null,
        hours: typeof obj['hours'] === 'string' ? obj['hours'].trim() || null : null,
        confidence,
        stance,
        google_place_id: typeof obj['google_place_id'] === 'string' ? obj['google_place_id'].trim() || null : null,
    };
}

/**
 * Parse the model's JSON array response into ExtractedCandidate[].
 *
 * Strategy:
 *   1. Strip markdown fences if present.
 *   2. Try full JSON.parse on the cleaned string.
 *   3. On failure, attempt malformed-tail salvage: find the longest valid
 *      `[...]` prefix and parse that (handles truncated 1024-token output).
 *   4. If salvage also fails → return [] (never throws; fail-soft preserved).
 *
 * Elements that don't have a parseable name are filtered out.
 * Result is capped at `max` (6 by default; listicle callers pass 12).
 */
export function parseMultiExtractionResponse(raw: string, max = 6): ExtractedCandidate[] {
    const cleaned = raw
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();

    let parsed: unknown;

    // ── Attempt 1: full parse ─────────────────────────────────────────────────
    try {
        parsed = JSON.parse(cleaned);
    } catch {
        // ── Attempt 2: malformed-tail salvage ─────────────────────────────────
        parsed = salvageTruncatedArray(cleaned);
    }

    if (!Array.isArray(parsed)) return [];

    const candidates = (parsed as unknown[])
        .map(coerceCandidate)
        .filter((c) => c.name !== null) // drop unnamed entries
        .slice(0, max);                 // cap (default 6; video path passes 12)

    return candidates;
}

/**
 * Bracket-balance salvage: find the longest `[...]` prefix that is valid JSON.
 * Used when the model output is truncated mid-element.
 * Returns parsed array or null on total failure.
 *
 * Two-pass strategy:
 *   1. Walk brackets tracking depth; if the array closes naturally, parse that slice.
 *   2. If truncated (no closing `]` found), trim at the last *array-level* comma
 *      (depth === 1) and close the array. This correctly discards the incomplete
 *      last element without cutting inside a nested object.
 */
function salvageTruncatedArray(text: string): unknown[] | null {
    const start = text.indexOf('[');
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escape = false;
    // Track the last comma that appears at array depth (depth === 1).
    // This marks the end of the last *complete* element.
    let lastArrayLevelCommaAt = -1;

    for (let i = start; i < text.length; i++) {
        const ch = text[i];

        if (escape) {
            escape = false;
            continue;
        }
        if (ch === '\\' && inString) {
            escape = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString) continue;

        if (ch === '[' || ch === '{') {
            depth++;
        } else if (ch === ']' || ch === '}') {
            depth--;
            if (depth === 0) {
                // Found the balanced closing bracket — parse the full slice.
                const candidate = text.slice(start, i + 1);
                try {
                    const result = JSON.parse(candidate);
                    return Array.isArray(result) ? result : null;
                } catch {
                    return null;
                }
            }
        } else if (ch === ',' && depth === 1) {
            // Comma at array level: marks boundary between complete elements.
            lastArrayLevelCommaAt = i;
        }
    }

    // String ended without finding the closing `]` — truncated output.
    // Trim at the last array-level comma and close the array.
    if (lastArrayLevelCommaAt > start) {
        const trimmed = text.slice(start, lastArrayLevelCommaAt) + ']';
        try {
            const result = JSON.parse(trimmed);
            return Array.isArray(result) ? result : null;
        } catch {
            // nothing
        }
    }

    return null;
}

// ── Public multi-candidate API ────────────────────────────────────────────────

/**
 * Extract ALL restaurant info from text (caption/title/hashtags).
 * Returns ExtractedCandidate[] capped by `max`, or by the standard listicle cap
 * when valid photo-carousel context is present. Slide count is prompt context only.
 * On any error → fails soft to [].
 *
 * TICKET-063: multi-candidate, city inference, AbortSignal threading.
 */
export async function extractFromTextMulti(
    caption: string,
    signal?: AbortSignal,
    max = 6,
    context?: PhotoExtractionContext,
): Promise<ExtractedCandidate[]> {
    if (signal?.aborted) return [];

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
        console.warn('ANTHROPIC_API_KEY not set — text extraction returning []');
        return [];
    }

    const modelId = Deno.env.get('EXTRACTION_MODEL') ?? EXTRACTION_MODEL_DEFAULT;
    // Photo carousels use the same 12-candidate budget as video listicles. The
    // validated slide count only enables prompt boundaries/noise rules.
    const photoSlideCount = validPhotoSlideCount(context);
    const effectiveMax = photoSlideCount === null ? max : LISTICLE_CANDIDATE_CAP;
    // A higher listicle cap needs a matching prompt instruction
    // AND a bigger token budget so the JSON array isn't truncated.
    const system = context === undefined && max === 6
        ? MULTI_SYSTEM_PROMPT
        : buildMultiSystemPrompt(max, context);
    const maxTokens = effectiveMax > 6 ? 2560 : MAX_TOKENS;

    const messages: AnthropicMessage[] = [{
        role: 'user',
        content: [{
            type: 'text',
            text: `Extract all restaurant information from this text:\n\n${caption.trim()}\n\nOutput ONLY the JSON array.`,
        }],
    }];

    try {
        const raw = await callAnthropic(messages, modelId, apiKey, signal, system, maxTokens);
        let parsed = parseMultiExtractionResponse(raw, effectiveMax);
        // TICKET-086c: a malformed response used to fail soft to [] with no
        // retry — the entire import silently read as "no spots found". One
        // re-ask at temperature 1 (temp-0 would reproduce the same malformed
        // output) rescues the batch. A VALID empty array is a real answer —
        // don't burn a retry on it.
        const cleanedRaw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
        let rawIsValidArray = false;
        try {
            rawIsValidArray = Array.isArray(JSON.parse(cleanedRaw));
        } catch {
            /* malformed — retry below */
        }
        if (parsed.length === 0 && !rawIsValidArray && !signal?.aborted) {
            const retryRaw = await callAnthropic(
                messages, modelId, apiKey, signal, system, maxTokens, 1,
            );
            parsed = parseMultiExtractionResponse(retryRaw, effectiveMax);
            if (parsed.length > 0) {
                console.warn('visionExtract: first parse yielded 0, retry rescued', parsed.length);
            }
        }
        return parsed;
    } catch (e) {
        if ((e as Error)?.name === 'AbortError') throw e;
        console.error('visionExtract.extractFromTextMulti error:', e);
        return [];
    }
}

/**
 * Extract ALL restaurant info from an image (± caption text).
 * Image must be pre-downscaled to ≤768px long edge, normalized to JPEG.
 * Returns content-derived fields only; confidence is at most 'high' (never 'exact').
 * On any error → fails soft to [].
 *
 * TICKET-063: multi-candidate, city inference, AbortSignal threading.
 */
export async function extractFromVisionMulti(
    imageBase64: string,
    mimeType: string = 'image/jpeg',
    caption?: string,
    signal?: AbortSignal,
): Promise<ExtractedCandidate[]> {
    if (signal?.aborted) return [];

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
        console.warn('ANTHROPIC_API_KEY not set — vision extraction returning []');
        return [];
    }

    const modelId = Deno.env.get('EXTRACTION_MODEL') ?? EXTRACTION_MODEL_DEFAULT;

    const contentBlocks: AnthropicMessage['content'] = [
        {
            type: 'image',
            source: { type: 'base64', media_type: mimeType, data: imageBase64 },
        },
    ];

    if (caption?.trim()) {
        contentBlocks.push({
            type: 'text',
            text: `Caption/context text: ${caption.trim()}`,
        });
    }

    contentBlocks.push({
        type: 'text',
        text: 'Extract all restaurant information from the image (and caption if provided). Output ONLY the JSON array.',
    });

    try {
        const raw = await callAnthropic(
            [{ role: 'user', content: contentBlocks }],
            modelId,
            apiKey,
            signal,
        );
        return parseMultiExtractionResponse(raw);
    } catch (e) {
        if ((e as Error)?.name === 'AbortError') throw e;
        console.error('visionExtract.extractFromVisionMulti error:', e);
        return [];
    }
}

// ── Single-candidate wrappers (back-compat for async screenshot path) ─────────

const SINGLE_FALLBACK: ExtractedCandidate = {
    name: null,
    city: null,
    city_inferred: false,
    cuisine: null,
    address: null,
    booking_url: null,
    hours: null,
    confidence: 'low',
    google_place_id: null,
};

/**
 * Single-candidate wrapper — returns the first result or a low-confidence fallback.
 * Used by the async screenshot path (handleAsyncExtract) which expects one candidate.
 * On any error → fails soft to confidence:'low'.
 */
export async function extractFromVision(
    imageBase64: string,
    mimeType: string = 'image/jpeg',
    caption?: string,
): Promise<ExtractedCandidate> {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
        console.warn('ANTHROPIC_API_KEY not set — vision extraction returning needs_confirm');
        return SINGLE_FALLBACK;
    }

    try {
        const results = await extractFromVisionMulti(imageBase64, mimeType, caption);
        return results[0] ?? SINGLE_FALLBACK;
    } catch (e) {
        console.error('visionExtract.extractFromVision error:', e);
        return SINGLE_FALLBACK;
    }
}

/**
 * Single-candidate wrapper — returns the first result or a low-confidence fallback.
 * Used by the async screenshot path which expects one candidate.
 * On any error → fails soft to confidence:'low'.
 */
export async function extractFromText(caption: string): Promise<ExtractedCandidate> {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
        console.warn('ANTHROPIC_API_KEY not set — text extraction returning needs_confirm');
        return SINGLE_FALLBACK;
    }

    try {
        const results = await extractFromTextMulti(caption);
        return results[0] ?? SINGLE_FALLBACK;
    } catch (e) {
        console.error('visionExtract.extractFromText error:', e);
        return SINGLE_FALLBACK;
    }
}
