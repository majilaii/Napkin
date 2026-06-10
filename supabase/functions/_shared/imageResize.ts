/**
 * imageResize.ts — downscale an image to ≤768px long edge, JPEG re-encode.
 * TICKET-063 Step 1.
 *
 * ARCH-REVIEW-2 #11 (BINDING): if downscale fails or ImageScript won't load,
 * return null — the caller MUST skip the vision tier entirely.
 * Raw bytes are NEVER sent to the vision API.
 *
 * Constraints per AC:
 *   - content-type must be image/* (caller validates before calling)
 *   - raw size cap 8MB (caller validates before calling)
 *   - single attempt; on any failure returns null
 *   - ≤768px long edge after resize
 *
 * ImageScript is the preferred Deno decode/resize library.
 * On any import failure, decode failure, or resize failure: return null (fail-soft).
 */

const MAX_LONG_EDGE = 768;

/**
 * Downscale `bytes` (any image format ImageScript supports — JPEG/PNG/GIF/BMP/TIFF)
 * to ≤768px long edge and re-encode as JPEG.
 *
 * Returns { data: Uint8Array; mimeType: 'image/jpeg' } on success.
 * Returns null on any failure (import error, decode error, resize error).
 *
 * The `signal` parameter gates the resize against the request deadline:
 * if already aborted before calling, we return null immediately.
 */
export async function resizeImageToLimit(
    bytes: Uint8Array,
    signal?: AbortSignal,
): Promise<{ data: Uint8Array; mimeType: 'image/jpeg' } | null> {
    if (signal?.aborted) return null;

    try {
        // Dynamic import so a load failure is caught and returns null.
        // ImageScript is available in Deno Deploy as a deno.land/x module.
        const { Image } = await import(
            'https://deno.land/x/imagescript@1.2.15/mod.ts'
        ).catch(() => ({ Image: null }));

        if (!Image) return null; // module failed to load
        if (signal?.aborted) return null;

        let img: any;
        try {
            img = await Image.decode(bytes);
        } catch {
            return null; // not a supported image format
        }

        if (signal?.aborted) return null;

        const { width, height } = img;
        const longEdge = Math.max(width, height);

        if (longEdge > MAX_LONG_EDGE) {
            const scale = MAX_LONG_EDGE / longEdge;
            const newW = Math.max(1, Math.round(width * scale));
            const newH = Math.max(1, Math.round(height * scale));
            img.resize(newW, newH);
        }

        if (signal?.aborted) return null;

        const encoded: Uint8Array = await img.encodeJPEG(85);
        return { data: encoded, mimeType: 'image/jpeg' };
    } catch {
        // Any unexpected error: fail soft, return null
        return null;
    }
}
