/**
 * visionExtract.ts — Anthropic vision/text extraction for multimodal import.
 * TICKET-060 Step 2.
 *
 * Exported functions:
 *   extractFromVision(imageBase64, mimeType, caption?) → ExtractedCandidate
 *   extractFromText(caption) → ExtractedCandidate
 *
 * Model: claude-haiku-4-5-20251001 via EXTRACTION_MODEL env (R10).
 * Returns content-derived fields ONLY — NO restaurant_id, NO already_wishlisted.
 * On any parse/model error → returns confidence:'low' (never throws to the caller).
 *
 * The caller is responsible for the cache read/write (extraction_cache table).
 * This module is ONLY the Anthropic API call + response parser.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ExtractionConfidence = 'exact' | 'high' | 'low';

/**
 * Content-derived extraction result.
 * Deliberately omits user-specific fields (already_wishlisted, restaurant_id).
 * booking_url and hours are carried but not acted on in TICKET-060 (TICKET-061 seam).
 */
export interface ExtractedCandidate {
    name: string | null;
    city: string | null;
    cuisine: string | null;
    address: string | null;
    booking_url: string | null;
    hours: string | null;
    confidence: ExtractionConfidence;
    google_place_id: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Real Haiku model id (R10). Never use the bare string "Haiku 4.5".
 * Read from env at runtime; this is the fallback default.
 */
export const EXTRACTION_MODEL_DEFAULT = 'claude-haiku-4-5-20251001';

// Maximum tokens for the extraction response (small JSON output)
const MAX_TOKENS = 512;

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a restaurant extraction assistant. Given an image and/or text, extract restaurant information.
Respond with ONLY a JSON object matching this exact schema — no prose, no markdown:
{
  "name": string | null,
  "city": string | null,
  "cuisine": string | null,
  "address": string | null,
  "booking_url": string | null,
  "hours": string | null,
  "confidence": "high" | "low",
  "google_place_id": string | null
}
Rules:
- confidence "high": you are reasonably certain of the restaurant name and city.
- confidence "low": name is uncertain, multiple restaurants visible, or this is not clearly a restaurant.
- booking_url: only include if explicitly visible in the content (Resy, OpenTable, etc.).
- google_place_id: only if a Google Maps place_id is visible in the content (rare).
- Return null for any field you cannot extract. Never guess a city from context clues.
- If no restaurant is identifiable, return all null fields with confidence "low".
- Output ONLY the JSON object. No explanation.`;

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
            max_tokens: MAX_TOKENS,
            system: SYSTEM_PROMPT,
            messages,
        }),
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Anthropic API error ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    // Extract text from the first content block
    const textBlock = data?.content?.find((b: any) => b.type === 'text');
    if (!textBlock?.text) {
        throw new Error('Anthropic response missing text content');
    }
    return textBlock.text as string;
}

// ── Response parser ───────────────────────────────────────────────────────────

/**
 * Parse the model's JSON response into an ExtractedCandidate.
 * Any parse failure or schema mismatch → returns confidence:'low' with nulls.
 * Never throws — extraction must fail soft.
 */
function parseExtractionResponse(raw: string): ExtractedCandidate {
    const fallback: ExtractedCandidate = {
        name: null,
        city: null,
        cuisine: null,
        address: null,
        booking_url: null,
        hours: null,
        confidence: 'low',
        google_place_id: null,
    };

    let parsed: unknown;
    try {
        // Strip potential markdown code fences the model might emit
        const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
        parsed = JSON.parse(cleaned);
    } catch {
        return fallback;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return fallback;
    }

    const p = parsed as Record<string, unknown>;

    const confidence: ExtractionConfidence =
        p['confidence'] === 'high' ? 'high' : 'low';

    return {
        name: typeof p['name'] === 'string' ? p['name'].trim() || null : null,
        city: typeof p['city'] === 'string' ? p['city'].trim() || null : null,
        cuisine: typeof p['cuisine'] === 'string' ? p['cuisine'].trim() || null : null,
        address: typeof p['address'] === 'string' ? p['address'].trim() || null : null,
        booking_url: typeof p['booking_url'] === 'string' ? p['booking_url'].trim() || null : null,
        hours: typeof p['hours'] === 'string' ? p['hours'].trim() || null : null,
        confidence,
        google_place_id: typeof p['google_place_id'] === 'string' ? p['google_place_id'].trim() || null : null,
    };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Extract restaurant info from an image (± caption text).
 * Image must be pre-downscaled to ≤768px long edge, normalized to JPEG.
 * Returns content-derived fields only; confidence is at most 'high' (never 'exact').
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
        return {
            name: null, city: null, cuisine: null, address: null,
            booking_url: null, hours: null, confidence: 'low', google_place_id: null,
        };
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
        text: 'Extract the restaurant information from the image (and caption if provided). Output ONLY the JSON object.',
    });

    try {
        const raw = await callAnthropic(
            [{ role: 'user', content: contentBlocks }],
            modelId,
            apiKey,
        );
        return parseExtractionResponse(raw);
    } catch (e) {
        console.error('visionExtract.extractFromVision error:', e);
        return {
            name: null, city: null, cuisine: null, address: null,
            booking_url: null, hours: null, confidence: 'low', google_place_id: null,
        };
    }
}

/**
 * Extract restaurant info from text only (caption/title, ~10x cheaper than vision).
 * Used when text is sufficient (TikTok caption, web title) and no image is needed.
 * On any error → fails soft to confidence:'low'.
 */
export async function extractFromText(caption: string): Promise<ExtractedCandidate> {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
        console.warn('ANTHROPIC_API_KEY not set — text extraction returning needs_confirm');
        return {
            name: null, city: null, cuisine: null, address: null,
            booking_url: null, hours: null, confidence: 'low', google_place_id: null,
        };
    }

    const modelId = Deno.env.get('EXTRACTION_MODEL') ?? EXTRACTION_MODEL_DEFAULT;

    try {
        const raw = await callAnthropic(
            [{
                role: 'user',
                content: [{
                    type: 'text',
                    text: `Extract restaurant information from this text:\n\n${caption.trim()}\n\nOutput ONLY the JSON object.`,
                }],
            }],
            modelId,
            apiKey,
        );
        return parseExtractionResponse(raw);
    } catch (e) {
        console.error('visionExtract.extractFromText error:', e);
        return {
            name: null, city: null, cuisine: null, address: null,
            booking_url: null, hours: null, confidence: 'low', google_place_id: null,
        };
    }
}
