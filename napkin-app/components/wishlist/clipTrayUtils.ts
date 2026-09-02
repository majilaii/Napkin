/**
 * clipTrayUtils — pure presentation for the Places clip doorway.
 *
 * The pill deliberately reads only two signals: a manifest that is actively
 * reading/saving, then unresolved completeness items. Review, kickoff, digest,
 * and failed manifests remain reachable as tray rows without lighting the pill.
 * No React or native imports so the precedence and row mapping stay cheap to test.
 */
import type { ExhaustedCompletenessItem } from '@/hooks/imports/useCompletenessRetries';
import type { ActiveImport } from '@/hooks/wishlist/useActiveImports';
import type { RecentImport } from '@/hooks/wishlist/useRecentImports';
import {
    importSourceLabel,
    manifestDisplaySource,
    previewLine,
    relativeTime,
    spotCountLabel,
} from './importSourceLabel';

export type ClipPillState =
    | { kind: 'resting' }
    | { kind: 'clipping' }
    | { kind: 'needsLook'; count: number };

export interface ClipLedgerRow {
    key: string;
    kind: 'clipping' | 'landed';
    title: string;
    meta: string;
    needsLook: number;
    dot: 'terracotta' | 'amber' | 'ghost';
    progress: { cursor: number; total: number } | null;
    route: string | null;
}

export interface ClipLedgerInput {
    active: ActiveImport[];
    recent: RecentImport[] | undefined;
    exhausted: ExhaustedCompletenessItem[];
}

function isClipping(item: ActiveImport): boolean {
    return item.phase === 'reading' || item.phase === 'saving';
}

export function deriveClipPill(
    active: ActiveImport[],
    exhausted: ExhaustedCompletenessItem[],
): ClipPillState {
    if (active.some(isClipping)) return { kind: 'clipping' };
    if (exhausted.length > 0) return { kind: 'needsLook', count: exhausted.length };
    return { kind: 'resting' };
}

function activeRoute(item: ActiveImport): string | null {
    if (item.phase === 'kickoff') return `/import-kickoff?jobId=${item.jobId}`;
    if (item.large?.phase === 'done') return `/import-digest?jobId=${item.jobId}`;
    if (item.phase === 'review') return `/import-review?jobId=${item.jobId}`;
    if (item.phase === 'failed') return '/import-progress';
    return null;
}

function activePreviewNames(item: ActiveImport): string[] {
    if (item.large) {
        return (item.manifest.largeJob?.items ?? [])
            .map((spot) => spot.restaurant_name ?? spot.name)
            .filter((name): name is string => Boolean(name))
            .slice(0, 3);
    }
    return (item.manifest.spots ?? [])
        .map((spot) => spot.restaurant_name)
        .filter((name): name is string => Boolean(name))
        .slice(0, 3);
}

function activeTitle(item: ActiveImport): string {
    if (item.large?.title?.trim()) return item.large.title.trim();
    const names = activePreviewNames(item);
    if (names.length > 0) return previewLine(names, item.spotCount);
    return importSourceLabel(manifestDisplaySource(item.manifest));
}

function quietActiveMeta(item: ActiveImport): string {
    const source = importSourceLabel(manifestDisplaySource(item.manifest));
    if (item.phase === 'failed') {
        return item.manifest.stage
            ? `${source} · stopped while ${item.manifest.stage}`
            : `${source} · couldn't import`;
    }
    if (item.phase === 'kickoff') return `${source} · ready to import`;
    if (item.large?.phase === 'done') return `${source} · ready for digest`;
    return `${source} · ${spotCountLabel(item.spotCount)} ready to review`;
}

function activeRow(item: ActiveImport): ClipLedgerRow {
    const clipping = isClipping(item);
    const progress = clipping && item.large?.phase === 'running'
        ? { cursor: item.large.cursor, total: item.large.listCount }
        : null;
    return {
        key: item.jobId,
        kind: 'clipping',
        title: activeTitle(item),
        meta: clipping
            ? (item.manifest.stage ?? (item.large ? 'gathering the list…' : 'reading the video…'))
            : quietActiveMeta(item),
        needsLook: 0,
        dot: clipping ? 'terracotta' : 'ghost',
        progress,
        route: activeRoute(item),
    };
}

export function buildClipLedger(
    { active, recent, exhausted }: ClipLedgerInput,
    nowMs: number = Date.now(),
): { rows: ClipLedgerRow[]; hasOlder: boolean } {
    const needsLookByJob = new Map<string, number>();
    for (const item of exhausted) {
        needsLookByJob.set(item.job_id, (needsLookByJob.get(item.job_id) ?? 0) + 1);
    }

    const activeJobIds = new Set(active.map((item) => item.jobId));
    const activeRows = [
        ...active.filter(isClipping),
        ...active.filter((item) => !isClipping(item)),
    ].map(activeRow);
    const landedRows = [...(recent ?? [])]
        .filter((batch) => !activeJobIds.has(batch.job_id))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .map<ClipLedgerRow>((batch) => {
            const needsLook = needsLookByJob.get(batch.job_id) ?? 0;
            return {
                key: batch.job_id,
                kind: 'landed',
                title: previewLine(batch.preview_names, batch.item_count),
                meta: [
                    importSourceLabel(batch.source),
                    relativeTime(batch.created_at, nowMs),
                    spotCountLabel(batch.item_count),
                ].join(' · '),
                needsLook,
                dot: needsLook > 0 ? 'amber' : 'ghost',
                progress: null,
                route: `/imports/${batch.job_id}`,
            };
        });

    const allRows = [...activeRows, ...landedRows];
    const visibleRows = allRows.slice(0, 5);
    // Review P2-1: the pill counts every first-page exhausted item, but chips only
    // ride landed rows we actually render. When a needs-look item's batch isn't
    // among the visible rows (11+ imports, or a batch fully pruned), the pill would
    // read "N need a look" with no chip and no way through. Always keep the
    // "older ·" escape to /import-progress when visible chips don't cover the count.
    const totalNeedsLook = exhausted.length;
    const visibleNeedsLook = visibleRows.reduce((sum, row) => sum + row.needsLook, 0);
    return {
        rows: visibleRows,
        hasOlder: allRows.length > 5 || totalNeedsLook > visibleNeedsLook,
    };
}
