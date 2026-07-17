/** Context sent only for TikTok photo-mode imports. */
export interface PhotoImportContext {
    source_kind: 'photo';
    slide_count: number;
}

/** Numeric output ceiling shared with server-side photo/video listicle extraction. */
export const PHOTO_LISTICLE_CANDIDATE_CAP = 12;

/**
 * Client compatibility guard for generic fallbacks / older servers. Carousel
 * slide count is boundary context only and must never become the output ceiling.
 */
export function capPhotoImportCandidates<T>(
    candidates: T[],
    context: PhotoImportContext | null,
): T[] {
    return context ? candidates.slice(0, PHOTO_LISTICLE_CANDIDATE_CAP) : candidates;
}

/** A generic URL retry lacks photo scene-noise rules and may not bypass them. */
export function allowsGenericUrlFallback(context: PhotoImportContext | null): boolean {
    return context === null;
}

/**
 * Keep each slide's OCR in its own labelled section. In particular, do not
 * dedupe repeated lines across slides: repetition is useful evidence that a
 * string is a watermark rather than a recommendation.
 */
export function fusePhotoSlideText(
    slides: ReadonlyArray<ReadonlyArray<string>>,
    caption: string | null | undefined,
): string {
    const total = slides.length;
    const sections = slides.map((lines, index) => {
        const body = lines.map((line) => line.trim()).filter(Boolean).join('\n');
        return body
            ? `[slide ${index + 1} of ${total}]\n${body}`
            : `[slide ${index + 1} of ${total}]`;
    });
    const cleanCaption = caption?.trim() ?? '';
    sections.push(cleanCaption ? `[caption]\n${cleanCaption}` : '[caption]');
    return sections.join('\n');
}

/**
 * Restore photo context after a review hold from the diagnostic checkpoint.
 * `photo_slides` is a back-compat fallback for a manifest written by the first
 * photo-slide build before the exact `slide_count` key existed.
 */
export function photoImportContextFromDiagnostics(
    diag: Record<string, unknown> | null | undefined,
): PhotoImportContext | null {
    if (diag?.photo_post !== true) return null;
    const raw = diag.slide_count ?? diag.photo_slides;
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 12) return null;
    return { source_kind: 'photo', slide_count: raw };
}
