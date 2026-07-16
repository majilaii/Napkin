import { callEdgeFn } from './edgeInvoke';
import {
    getImportForUser,
    importManifestProtocol,
    pokeImportQueue,
    setLargeJob,
    type LargeImportJob,
} from './importQueue';
import {
    reconcileLargeJobCompleteness,
    type CompletenessJobSnapshot,
} from './largeImportJob';

const inFlight = new Map<string, Promise<LargeImportJob | null>>();

/** Fetch and durably apply the server routing ledger for one v2 large import. */
export function reconcileV2LargeImportManifest(
    jobId: string,
    ownerId: string,
): Promise<LargeImportJob | null> {
    const inFlightKey = `${ownerId}:${jobId}`;
    const existing = inFlight.get(inFlightKey);
    if (existing) return existing;

    const run = (async () => {
        const before = getImportForUser(jobId, ownerId);
        const serverJobId = before?.largeJob?.serverJobId;
        if (
            !before?.largeJob || importManifestProtocol(before) !== 'v2' ||
            typeof serverJobId !== 'string' || serverJobId.length === 0
        ) {
            return before?.largeJob ?? null;
        }
        const snapshot = await callEdgeFn<CompletenessJobSnapshot>('restaurant-completeness', {
            action: 'status',
            body: { job_id: serverJobId },
        });

        // Re-read after the request so a concurrent local chunk commit/correction
        // is never overwritten by the older pre-request manifest snapshot.
        const fresh = getImportForUser(jobId, ownerId);
        if (!fresh?.largeJob || fresh.largeJob.serverJobId !== snapshot.job_id) return null;
        const next = reconcileLargeJobCompleteness(fresh.largeJob, snapshot);
        if (JSON.stringify(next) !== JSON.stringify(fresh.largeJob)) {
            setLargeJob(jobId, next);
            pokeImportQueue();
        }
        return next;
    })().finally(() => {
        inFlight.delete(inFlightKey);
    });
    inFlight.set(inFlightKey, run);
    return run;
}
