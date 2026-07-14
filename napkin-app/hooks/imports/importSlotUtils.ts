/**
 * importSlotUtils — the pure derivation behind the "one import card, ever".
 *
 * Extracted from app/wishlist.tsx (TICKET-185) so the map-tab chip AND the
 * profile Explore "Imports" row read the exact same live state. No React /
 * native imports (unit-testable, same pattern as mapPinsUtils / listsSectionUtils).
 *
 * Precedence is deliberate and load-bearing: review > running > failed > recent,
 * then null when idle. Active states route to the imports hub; a recently-saved
 * batch (48h window, latest only) still routes via the hub — hierarchical
 * back-nav is sacred, so EVERY state deep-links to /import-progress, never past it.
 */
import type { ActiveImport } from '@/hooks/wishlist/useActiveImports';
import type { RecentImport } from '@/hooks/wishlist/useRecentImports';
import { importSourceIcon, importSourceLabel, relativeTime } from '@/components/wishlist/importSourceLabel';

/**
 * The single import affordance state. Discriminated on `kind` so `count` is a
 * number only for 'review' (byte-identical to the original inline useMemo).
 */
export type ImportSlot = NonNullable<ReturnType<typeof deriveImportSlot>>;

export function deriveImportSlot(
    activeImports: ActiveImport[],
    recentImports: RecentImport[] | undefined,
    nowMs: number = Date.now(),
) {
    const review = activeImports.filter((m) => m.phase === 'review');
    const working = activeImports.filter((m) => m.phase === 'reading' || m.phase === 'saving');
    const failed = activeImports.filter((m) => m.phase === 'failed');
    if (review.length > 0) {
        const n = review.reduce((sum, m) => sum + m.spotCount, 0);
        return {
            kind: 'review' as const,
            count: n,
            icon: 'sparkles-outline' as const,
            title: `${n} ${n === 1 ? 'spot' : 'spots'} ready to review`,
            sublabel: 'review and pin',
            // ALWAYS via the hub — deep-linking straight into the review screen
            // broke back-navigation (review → back should land on the hub, not
            // the wishlist; founder 2026-07-02).
            route: '/import-progress',
        };
    }
    if (working.length > 0) {
        return {
            kind: 'working' as const,
            count: null,
            icon: 'sync-outline' as const,
            title: working.length === 1 ? 'importing…' : `importing ${working.length}…`,
            sublabel: 'spots land here when done',
            route: '/import-progress',
        };
    }
    if (failed.length > 0) {
        return {
            kind: 'failed' as const,
            count: null,
            icon: 'alert-circle-outline' as const,
            title: 'an import needs attention',
            sublabel: 'try again or discard',
            route: '/import-progress',
        };
    }
    const cutoff = nowMs - 48 * 60 * 60 * 1000;
    const latest = (recentImports ?? []).find(
        (b) => new Date(b.created_at).getTime() > cutoff,
    );
    if (latest) {
        return {
            kind: 'recent' as const,
            count: null,
            icon: importSourceIcon(latest.source),
            title: `${latest.item_count} ${latest.item_count === 1 ? 'spot' : 'spots'} ${importSourceLabel(latest.source)}`,
            sublabel: `${relativeTime(latest.created_at, nowMs)} · fix or prune in imports`,
            // Hierarchical back-nav is sacred: EVERY state of this card goes via
            // the imports hub — never deep-link past the intermediate screen
            // (founder rule, 2026-07-02, twice).
            route: '/import-progress',
        };
    }
    return null;
}
