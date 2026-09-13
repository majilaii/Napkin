import type { ImportManifest } from './importQueue';

export type ImportNoticeOutcome = 'saved' | 'review' | 'failed';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Old local notices have no owner; new push notices are rejected before routing. */
export function importNotificationMatchesOwner(url: string, currentUserId?: string | null): boolean {
    if (!url.startsWith('/import-progress')) return true;
    try {
        const owner = new URL(url, 'https://napkin.invalid').searchParams.get('owner');
        return !owner || (!!currentUserId && owner === currentUserId);
    } catch { return false; }
}

/** Land through the hub so a detail opened by an alert has a real parent. */
export function importNoticeUrl(jobId?: string | null, outcome: ImportNoticeOutcome = 'saved', ownerId?: string | null): string {
    if (!jobId) return '/import-progress';
    const params = [`openJob=${encodeURIComponent(jobId)}`, `outcome=${outcome}`];
    if (ownerId) params.push(`owner=${encodeURIComponent(ownerId)}`);
    return `/import-progress?${params.join('&')}`;
}

/** Re-evaluate device-local state when opening, since a notice may have aged. */
export function importNoticeDetail(input: {
    jobId?: string;
    outcome?: string;
    ownerId?: string;
    currentUserId?: string;
    manifests: ImportManifest[];
}): string | null {
    const { jobId, outcome, ownerId, currentUserId, manifests } = input;
    if (!jobId || !currentUserId || (ownerId && ownerId !== currentUserId) || outcome === 'failed') return null;
    const manifest = manifests.find((m) => m.userId === currentUserId && (m.jobId === jobId || m.largeJob?.serverJobId === jobId));
    if (manifest) {
        if (manifest.status === 'failed' || manifest.sourcePreparation === 'pending' || manifest.sourcePreparation === 'failed') return null;
        if (manifest.largeJob) {
            return manifest.largeJob.phase === 'done'
                ? `/import-digest?jobId=${encodeURIComponent(manifest.jobId)}` : null;
        }
        return manifest.mode === 'review' && !!manifest.spots?.length
            ? `/import-review?jobId=${encodeURIComponent(manifest.jobId)}` : null;
    }
    // Saved server batches remain available after local cleanup; the batch read is owner-scoped.
    return outcome === 'saved' && UUID.test(jobId) ? `/imports/${jobId}` : null;
}
