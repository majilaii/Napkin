/**
 * importSourceLabel — pure formatters for the import-history surfaces.
 * No React / native imports (unit-testable).
 */
import type { WishlistSource } from '@/lib/types/wishlistSource';

/** Human phrase for where an import came from, e.g. "from a video". */
export function importSourceLabel(source: WishlistSource | null | undefined): string {
    const type = (source as { type?: string } | null | undefined)?.type;
    switch (type) {
        case 'video':
            return 'from a video';
        case 'tiktok':
            return 'from TikTok';
        case 'google_maps':
            return 'from Google Maps';
        case 'web':
            return 'from a link';
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
