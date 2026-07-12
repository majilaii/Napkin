/**
 * importSourceLabel — pure formatters for the import-history surfaces.
 * No React / native imports (unit-testable).
 */
import { isInstagramUrl } from '@/lib/instagramPerception';
import { isMapsShareUrl } from '@/lib/mapsShare';

/**
 * The minimal structural shape the label/icon formatters read (type + url). Both a
 * persisted WishlistSource and a synthesized ManifestDisplaySource satisfy it, so
 * these formatters serve the saved-import surfaces AND the in-flight hub rows.
 */
type SourceLike = { type?: string | null; url?: string | null } | null | undefined;

/**
 * True when a 'web' source is actually an Instagram post/reel. Instagram saves
 * as type 'web' + the reel URL (the wishlist_items_source_shape DB CHECK has no
 * first-class 'instagram' variant) — so provenance surfaces detect it from the
 * URL host, which also covers rows saved before this helper existed.
 */
export function isInstagramSource(source: SourceLike): boolean {
    const s = source as { type?: string; url?: string } | null | undefined;
    return s?.type === 'web' && !!s.url && isInstagramUrl(s.url);
}

/**
 * TICKET-180: the display source for an in-flight import manifest — the SAME type
 * mapping the drain applies when it saves (tiktok / google_maps / web+IG / video),
 * synthesized purely for the review card + hub identity line so provenance is
 * legible before you approve. Carries the manifest-only `author_handle`
 * (m.sourceHandle) that the saved wishlist source shape doesn't persist. Feeds
 * importSourceIcon/importSourceLabel (which read type/url) directly.
 */
export interface ManifestDisplaySource {
    type: 'tiktok' | 'google_maps' | 'web' | 'video';
    url?: string;
    author_handle?: string | null;
}

export function manifestDisplaySource(m: {
    kind: 'video' | 'url';
    url?: string;
    sourceHandle?: string | null;
}): ManifestDisplaySource {
    if (m.kind === 'url' && m.url) {
        const url = m.url;
        if (/tiktok\.com/i.test(url)) {
            return { type: 'tiktok', url, author_handle: m.sourceHandle ?? null };
        }
        if (isMapsShareUrl(url)) {
            return { type: 'google_maps', url };
        }
        // Instagram + plain web both save as 'web' (importSourceIcon/Label detect IG
        // from the url host); the manifest handle rides for the IG @handle row.
        return { type: 'web', url, author_handle: m.sourceHandle ?? null };
    }
    // kind 'video' (a shared file) — no url, no handle, no tap-out.
    return { type: 'video' };
}

/**
 * TICKET-180: true when a display source is a re-watchable clip (tiktok, or an
 * Instagram reel/post) carrying a url — the only sources the "watch again ↗"
 * tap-out fits. A maps / plain-web / shared-video-file source returns false (no
 * link, or "watch again" would be the wrong verb).
 */
export function isWatchableClip(source: SourceLike): boolean {
    const s = source as { type?: string; url?: string } | null | undefined;
    if (!s?.url) return false;
    return s.type === 'tiktok' || isInstagramSource(s);
}

/** Ionicons glyph for where an import came from (pairs with importSourceLabel). */
export function importSourceIcon(
    source: SourceLike,
): 'logo-tiktok' | 'logo-instagram' | 'map-outline' | 'download-outline' {
    const type = (source as { type?: string } | null | undefined)?.type;
    if (type === 'tiktok') return 'logo-tiktok';
    if (isInstagramSource(source)) return 'logo-instagram';
    if (type === 'google_maps') return 'map-outline';
    return 'download-outline';
}

/** Human phrase for where an import came from, e.g. "from a video". */
export function importSourceLabel(source: SourceLike): string {
    const type = (source as { type?: string } | null | undefined)?.type;
    switch (type) {
        case 'video':
            return 'from a video';
        case 'tiktok':
            return 'from TikTok';
        case 'google_maps':
            return 'from Google Maps';
        case 'web':
            return isInstagramSource(source) ? 'from Instagram' : 'from a link';
        case 'screenshot':
            return 'from a screenshot';
        case 'vision':
            return 'from a photo';
        case 'handoff':
            return 'from a shared napkin';
        default:
            return 'imported';
    }
}

/** "11 spots" / "1 spot". */
export function spotCountLabel(n: number): string {
    return `${n} ${n === 1 ? 'spot' : 'spots'}`;
}

/** Preview line: "Salvo, NATE, Zero Zero +8". */
export function previewLine(names: string[], total: number): string {
    if (names.length === 0) return spotCountLabel(total);
    const shown = names.join(', ');
    const remainder = total - names.length;
    return remainder > 0 ? `${shown} +${remainder}` : shown;
}

/** Compact relative time. `nowMs` injectable for tests; defaults to wall clock. */
export function relativeTime(iso: string, nowMs?: number): string {
    const then = new Date(iso).getTime();
    const now = nowMs ?? new Date().getTime();
    const diffMin = Math.floor((now - then) / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
