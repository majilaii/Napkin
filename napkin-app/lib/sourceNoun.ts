/**
 * sourceNoun — maps an import source to the noun used in user-facing copy.
 *
 * TICKET-079: the import flow used to hardcode "video" in its loading / empty /
 * picker-title copy regardless of what was actually shared (a Google Maps link
 * still read "reading the video…"). This helper derives the right noun from the
 * resolved `source_type` — and, before the resolver returns, infers it from the
 * URL host so the loading copy is already correct.
 *
 * Pure: no I/O, no React, no native imports — unit-tested in sourceNoun.test.ts.
 *
 * Noun mapping:
 *   tiktok            → "video"
 *   instagram         → "post"
 *   google_maps       → "map"
 *   reddit            → "post"
 *   substack          → "page"
 *   web               → "page"
 *   screenshot/vision → "screenshot"
 *   (unknown)         → "link"
 */

/** The source_type values the resolver can return (mirrors ResolveUrlData['source_type']). */
export type SourceNounType =
    | 'tiktok'
    | 'google_maps'
    | 'web'
    | 'instagram'
    | 'reddit'
    | 'substack'
    | 'screenshot'
    | 'vision'
    | 'video';

/**
 * Map a known `source_type` to its copy noun.
 * When `sourceType` is undefined/null (resolver hasn't returned yet), falls back
 * to inferring from `url` host; if that fails too, returns "link".
 */
export function sourceNoun(
    sourceType: SourceNounType | string | null | undefined,
    url?: string | null,
): string {
    switch (sourceType) {
        case 'tiktok':
            return 'video';
        case 'video':
            return 'video';
        case 'instagram':
            return 'post';
        case 'google_maps':
            return 'map';
        case 'reddit':
            return 'post';
        case 'substack':
            return 'page';
        case 'web':
            return 'page';
        case 'screenshot':
        case 'vision':
            return 'screenshot';
        default:
            // Unknown / not-yet-resolved: infer from the URL host if we can.
            return url ? nounFromUrl(url) : 'link';
    }
}

/**
 * Best-effort noun from a raw URL host, used during 'loading' before the
 * resolver returns a source_type. Recognizes the same hosts resolve-url's
 * detectSourceType does, plus reddit/substack. Unknown host → "link".
 */
export function nounFromUrl(url: string): string {
    let host: string;
    try {
        host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
        return 'link';
    }

    if (host === 'tiktok.com' || host === 'vm.tiktok.com' || host === 'm.tiktok.com') {
        return 'video';
    }
    if (
        host === 'maps.app.goo.gl' ||
        host === 'maps.google.com' ||
        host === 'google.com' || // /maps path; treat google.com share host as a map
        host === 'goo.gl'
    ) {
        return 'map';
    }
    if (host === 'instagram.com') {
        return 'post';
    }
    if (host === 'reddit.com' || host === 'redd.it' || host.endsWith('.reddit.com')) {
        return 'post';
    }
    if (host === 'substack.com' || host.endsWith('.substack.com')) {
        return 'page';
    }
    return 'link';
}
