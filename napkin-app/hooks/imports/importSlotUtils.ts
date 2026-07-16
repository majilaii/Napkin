/**
 * importSlotUtils — the pure derivation behind the "one import card, ever".
 *
 * Extracted from app/wishlist.tsx (TICKET-185) so the map-tab chip AND the
 * profile Imports strip read the exact same live state. No React / native
 * imports (unit-testable, same pattern as mapPinsUtils / listsSectionUtils).
 *
 * TICKET-191 extends the ladder to the large-job path. Precedence is
 * deliberate and load-bearing — attention strictly before calm:
 *
 *   review > failed > kickoff > digest(needsLook>0) > working > digest(clean) > recent
 *
 * then null when idle. LANDMINE: large jobs are partitioned on `m.large.phase`,
 * never `m.phase` — a large "done" job reports phase 'review' and a running one
 * reports 'saving' (useActiveImports.phaseOf), so the normal review/working
 * filters MUST exclude large jobs or a completed manifest renders the wrong
 * "N spots ready to review" card.
 *
 * Every tier carries `accent` so no consumer re-derives color: 'attention' →
 * terracotta (review / failed / kickoff / digest-with-needsLook), 'calm' →
 * neutral (working / digest-clean / recent). Active states route to the imports
 * hub; a recently-saved batch (48h window, latest only) still routes via the
 * hub — hierarchical back-nav is sacred, so EVERY state deep-links to
 * /import-progress, never past it.
 */
import type { ActiveImport } from '@/hooks/wishlist/useActiveImports';
import type { RecentImport } from '@/hooks/wishlist/useRecentImports';
import { importSourceIcon, importSourceLabel, relativeTime } from '@/components/wishlist/importSourceLabel';

/**
 * The single import affordance state. Discriminated on `kind` so `count` is a
 * number only for 'review'.
 */
export type ImportSlot = NonNullable<ReturnType<typeof deriveImportSlot>>;

/** "117 places" / "1 place". */
function placesLabel(n: number): string {
    return `${n} ${n === 1 ? 'place' : 'places'}`;
}

export function deriveImportSlot(
    activeImports: ActiveImport[],
    recentImports: RecentImport[] | undefined,
    nowMs: number = Date.now(),
) {
    // Partition — large jobs branch on m.large.phase (see the docstring landmine).
    const normalReview = activeImports.filter((m) => !m.large && m.phase === 'review');
    const failed = activeImports.filter((m) => m.phase === 'failed');
    const largeKickoff = activeImports.filter((m) => m.large?.phase === 'kickoff');
    const largeDone = activeImports.filter((m) => m.large?.phase === 'done');
    const normalWorking = activeImports.filter(
        (m) => !m.large && (m.phase === 'reading' || m.phase === 'saving'),
    );
    const largeRunning = activeImports.filter((m) => m.large?.phase === 'running');

    // 1 — review (attention): normal batches awaiting your confirmation.
    if (normalReview.length > 0) {
        const n = normalReview.reduce((sum, m) => sum + m.spotCount, 0);
        return {
            kind: 'review' as const,
            count: n,
            accent: 'attention' as const,
            icon: 'sparkles-outline' as const,
            title: `${n} ${n === 1 ? 'spot' : 'spots'} ready to review`,
            sublabel: 'review and pin',
            // ALWAYS via the hub — deep-linking straight into the review screen
            // broke back-navigation (review → back should land on the hub, not
            // the wishlist; founder 2026-07-02).
            route: '/import-progress',
        };
    }
    // 2 — failed (attention): outranks anything still running (TICKET-191 flip —
    // a stuck import needs a decision more than a spinner needs an audience).
    if (failed.length > 0) {
        return {
            kind: 'failed' as const,
            count: null,
            accent: 'attention' as const,
            icon: 'alert-circle-outline' as const,
            title: 'an import needs attention',
            sublabel: 'try again or discard',
            route: '/import-progress',
        };
    }
    // 3 — kickoff (attention): a large batch awaiting YOUR start action. Nothing
    // runs yet, so it must never read as "importing…".
    if (largeKickoff.length > 0) {
        const n = largeKickoff.reduce((sum, m) => sum + (m.large?.listCount ?? 0), 0);
        return {
            kind: 'kickoff' as const,
            count: null,
            accent: 'attention' as const,
            icon: 'play-outline' as const,
            title: 'ready to import',
            sublabel: `${placesLabel(n)} · tap to start`,
            route: '/import-progress',
        };
    }
    const digestImported = largeDone.reduce((sum, m) => sum + (m.large?.imported ?? 0), 0);
    const digestQueued = largeDone.reduce((sum, m) => sum + (m.large?.queued ?? 0), 0);
    const digestNeedsLook = largeDone.reduce((sum, m) => sum + (m.large?.needsLook ?? 0), 0);
    // 4 — digest with needsLook (attention): a completed large job whose digest
    // is still active and flags rows worth a look.
    if (largeDone.length > 0 && digestNeedsLook > 0) {
        return {
            kind: 'digest' as const,
            count: null,
            accent: 'attention' as const,
            icon: 'checkmark-circle-outline' as const,
            title: `${digestImported} imported`,
            sublabel: `${digestNeedsLook} worth a look`,
            route: '/import-progress',
        };
    }
    if (largeDone.length > 0 && digestQueued > 0) {
        return {
            kind: 'working' as const,
            count: null,
            accent: 'calm' as const,
            icon: 'sync-outline' as const,
            title: `${digestQueued} ${digestQueued === 1 ? 'spot is' : 'spots are'} completing…`,
            sublabel: digestImported > 0 ? `${digestImported} already imported` : 'finishing in the background',
            route: '/import-progress',
        };
    }
    // 5 — working (calm): normal in-flight batches ∪ running large jobs.
    const workingCount = normalWorking.length + largeRunning.length;
    if (workingCount > 0) {
        const soloLarge = workingCount === 1 && largeRunning.length === 1 ? largeRunning[0].large : null;
        return {
            kind: 'working' as const,
            count: null,
            accent: 'calm' as const,
            icon: 'sync-outline' as const,
            title: soloLarge
                ? `importing ${soloLarge.cursor} of ${soloLarge.listCount}…`
                : workingCount === 1
                  ? 'importing…'
                  : `importing ${workingCount}…`,
            sublabel: 'spots land here when done',
            route: '/import-progress',
        };
    }
    // 6 — digest, clean (calm): a real rendered state — a completed large
    // manifest stays active in the App-Group queue until its digest is
    // dismissed, and it outranks the recent fallback.
    if (largeDone.length > 0) {
        return {
            kind: 'digest' as const,
            count: null,
            accent: 'calm' as const,
            icon: 'checkmark-circle-outline' as const,
            title: `${digestImported} imported`,
            sublabel: placesLabel(digestImported),
            route: '/import-progress',
        };
    }
    // 7 — recent (calm): latest batch inside the 48h window.
    const cutoff = nowMs - 48 * 60 * 60 * 1000;
    const latest = (recentImports ?? []).find(
        (b) => new Date(b.created_at).getTime() > cutoff,
    );
    if (latest) {
        return {
            kind: 'recent' as const,
            count: null,
            accent: 'calm' as const,
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
