/**
 * WishlistSource — discriminated union for wishlist_items.source (jsonb column).
 * Canonical file: lives on the Deno side so both edge functions and the RN shim share
 * the same type without cross-runtime import risk.
 *
 * Rule: no Deno-only or Node-only imports. Structural types + globals only.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export type WishlistSourceType = 'tiktok' | 'google_maps' | 'web' | 'screenshot' | 'vision' | 'video' | 'handoff';

export interface WishlistSourceTikTok {
    type: 'tiktok';
    url: string;
    thumbnail_url?: string;
    author_handle?: string;
    author_name?: string;
    embed_product_id?: string;
    // embed_html is intentionally NOT included (TICKET-053 arch decision H2)
}

export interface WishlistSourceGoogleMaps {
    type: 'google_maps';
    url: string;
    place_id?: string;
}

export interface WishlistSourceWeb {
    type: 'web';
    url: string;
    title?: string;
}

export interface WishlistSourceScreenshot {
    type: 'screenshot';
    upload_path: string;
    caption?: string;
}

export interface WishlistSourceVision {
    type: 'vision';
    source_url?: string;
    upload_path?: string;
    caption?: string;
}

/**
 * TICKET-082: pinned from a video imported + extracted on-device (Vision OCR +
 * voiceover). url-optional like screenshot/vision — the user shared/picked a file.
 */
export interface WishlistSourceVideo {
    type: 'video';
    caption?: string;
}

/**
 * TICKET-072: pinned via a wishlist handoff (share link).
 * sharer_name is frozen at share time; url is not applicable.
 * DB CHECK: source ? 'sharer_name' must be true.
 */
export interface WishlistSourceHandoff {
    type: 'handoff';
    sharer_name: string;
}

export type WishlistSource =
    | WishlistSourceTikTok
    | WishlistSourceGoogleMaps
    | WishlistSourceWeb
    | WishlistSourceScreenshot
    | WishlistSourceVision
    | WishlistSourceVideo
    | WishlistSourceHandoff;

// ── Validator ─────────────────────────────────────────────────────────────────

/**
 * Canonicalizing validator — returns a freshly-constructed object with ONLY
 * whitelisted keys per variant. Returns null on any validation failure.
 *
 * Architecture decision [H1]:
 * - Unknown top-level keys on a valid variant → rejection (not silent strip),
 *   so tests can assert rejection via the `extra_keys` error detail.
 * - Optional fields accepted as missing OR string; explicit null is rejected.
 *
 * The returned object is NEVER reference-equal to the input — always a new object.
 */
export function validateWishlistSource(
    value: unknown,
): { ok: true; source: WishlistSource } | { ok: false; reason: string; extra_keys?: string[] } {
    // Must be a plain object (not array, not null, not primitive)
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, reason: 'not_an_object' };
    }

    const raw = value as Record<string, unknown>;

    if (typeof raw['type'] !== 'string') {
        return { ok: false, reason: 'missing_type' };
    }

    // url is required for url-sourced types; optional for screenshot/vision
    const type = raw['type'];
    const urlRequired = type !== 'screenshot' && type !== 'vision' && type !== 'video';
    if (urlRequired && (typeof raw['url'] !== 'string' || raw['url'].trim() === '')) {
        return { ok: false, reason: 'missing_url' };
    }

    if (type === 'screenshot') {
        const whitelist = new Set(['type', 'upload_path', 'caption']);
        const extraKeys = Object.keys(raw).filter((k) => !whitelist.has(k));
        if (extraKeys.length > 0) {
            return { ok: false, reason: 'extra_keys', extra_keys: extraKeys };
        }
        if (typeof raw['upload_path'] !== 'string' || raw['upload_path'].trim() === '') {
            return { ok: false, reason: 'missing_upload_path' };
        }
        if ('caption' in raw && raw['caption'] !== undefined && typeof raw['caption'] !== 'string') {
            return { ok: false, reason: 'invalid_field_type:caption' };
        }
        const source: WishlistSourceScreenshot = { type: 'screenshot', upload_path: raw['upload_path'] as string };
        if (typeof raw['caption'] === 'string') source.caption = raw['caption'];
        return { ok: true, source };
    }

    if (type === 'vision') {
        const whitelist = new Set(['type', 'source_url', 'upload_path', 'caption']);
        const extraKeys = Object.keys(raw).filter((k) => !whitelist.has(k));
        if (extraKeys.length > 0) {
            return { ok: false, reason: 'extra_keys', extra_keys: extraKeys };
        }
        for (const field of ['source_url', 'upload_path', 'caption'] as const) {
            if (field in raw && raw[field] !== undefined && typeof raw[field] !== 'string') {
                return { ok: false, reason: `invalid_field_type:${field}` };
            }
        }
        const source: WishlistSourceVision = { type: 'vision' };
        if (typeof raw['source_url'] === 'string') source.source_url = raw['source_url'];
        if (typeof raw['upload_path'] === 'string') source.upload_path = raw['upload_path'];
        if (typeof raw['caption'] === 'string') source.caption = raw['caption'];
        return { ok: true, source };
    }

    if (type === 'video') {
        const whitelist = new Set(['type', 'caption']);
        const extraKeys = Object.keys(raw).filter((k) => !whitelist.has(k));
        if (extraKeys.length > 0) {
            return { ok: false, reason: 'extra_keys', extra_keys: extraKeys };
        }
        if ('caption' in raw && raw['caption'] !== undefined && typeof raw['caption'] !== 'string') {
            return { ok: false, reason: 'invalid_field_type:caption' };
        }
        const source: WishlistSourceVideo = { type: 'video' };
        if (typeof raw['caption'] === 'string') source.caption = raw['caption'];
        return { ok: true, source };
    }

    if (type === 'tiktok') {
        const whitelist = new Set(['type', 'url', 'thumbnail_url', 'author_handle', 'author_name', 'embed_product_id']);
        const extraKeys = Object.keys(raw).filter((k) => !whitelist.has(k));
        if (extraKeys.length > 0) {
            return { ok: false, reason: 'extra_keys', extra_keys: extraKeys };
        }
        // Validate optional string fields — explicit null is rejected
        for (const field of ['thumbnail_url', 'author_handle', 'author_name', 'embed_product_id'] as const) {
            if (field in raw && raw[field] !== undefined) {
                if (typeof raw[field] !== 'string') {
                    return { ok: false, reason: `invalid_field_type:${field}` };
                }
            }
        }
        // Build canonical object (never passthrough — identity !== input)
        const source: WishlistSourceTikTok = { type: 'tiktok', url: raw['url'] as string };
        if (typeof raw['thumbnail_url'] === 'string') source.thumbnail_url = raw['thumbnail_url'];
        if (typeof raw['author_handle'] === 'string') source.author_handle = raw['author_handle'];
        if (typeof raw['author_name'] === 'string') source.author_name = raw['author_name'];
        if (typeof raw['embed_product_id'] === 'string') source.embed_product_id = raw['embed_product_id'];
        return { ok: true, source };
    }

    if (type === 'google_maps') {
        const whitelist = new Set(['type', 'url', 'place_id']);
        const extraKeys = Object.keys(raw).filter((k) => !whitelist.has(k));
        if (extraKeys.length > 0) {
            return { ok: false, reason: 'extra_keys', extra_keys: extraKeys };
        }
        if ('place_id' in raw && raw['place_id'] !== undefined && typeof raw['place_id'] !== 'string') {
            return { ok: false, reason: 'invalid_field_type:place_id' };
        }
        const source: WishlistSourceGoogleMaps = { type: 'google_maps', url: raw['url'] as string };
        if (typeof raw['place_id'] === 'string') source.place_id = raw['place_id'];
        return { ok: true, source };
    }

    if (type === 'web') {
        const whitelist = new Set(['type', 'url', 'title']);
        const extraKeys = Object.keys(raw).filter((k) => !whitelist.has(k));
        if (extraKeys.length > 0) {
            return { ok: false, reason: 'extra_keys', extra_keys: extraKeys };
        }
        if ('title' in raw && raw['title'] !== undefined && typeof raw['title'] !== 'string') {
            return { ok: false, reason: 'invalid_field_type:title' };
        }
        const source: WishlistSourceWeb = { type: 'web', url: raw['url'] as string };
        if (typeof raw['title'] === 'string') source.title = raw['title'];
        return { ok: true, source };
    }

    if (type === 'handoff') {
        const whitelist = new Set(['type', 'sharer_name']);
        const extraKeys = Object.keys(raw).filter((k) => !whitelist.has(k));
        if (extraKeys.length > 0) {
            return { ok: false, reason: 'extra_keys', extra_keys: extraKeys };
        }
        if (typeof raw['sharer_name'] !== 'string' || raw['sharer_name'].trim() === '') {
            return { ok: false, reason: 'missing_sharer_name' };
        }
        const source: WishlistSourceHandoff = { type: 'handoff', sharer_name: raw['sharer_name'] as string };
        return { ok: true, source };
    }

    return { ok: false, reason: 'unknown_type' };
}
