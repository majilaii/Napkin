import { callEdgeFn } from './edgeInvoke';
import { getBackgroundImportInstallationId } from '@/modules/media-extract';
import { getImportForUser, listRetiredRemoteImports, finishRetiredRemoteImport,
    type ImportManifest } from './importQueue';
import type { ResolveUrlData } from '@/hooks/wishlist/useResolveUrl';

export interface RemoteImport {
    job_id: string;
    owner_id: string;
    import_nonce: string;
    url: string;
    status: 'pending' | 'processing' | 'ready' | 'needs_device' | 'failed' | 'dismissed' | 'acknowledged';
    result?: ResolveUrlData | null;
    reason?: string | null;
    created_at: string;
}
export class BackgroundImportRejectedError extends Error {
    constructor() { super("couldn't accept that link"); this.name = 'BackgroundImportRejectedError'; }
}
function assertOwner(ownerId: string, activeOwner: () => string | null): void {
    if (activeOwner() !== ownerId) throw new Error('Import owner changed');
}
export async function backgroundImportCall<T>(ownerId: string, activeOwner: () => string | null,
    action: string, body: Record<string, unknown>): Promise<T> {
    assertOwner(ownerId, activeOwner);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
        const result = await callEdgeFn<T>('background-imports', { action,
            body: { ...body, expected_owner_id: ownerId }, signal: controller.signal });
        assertOwner(ownerId, activeOwner);
        return result;
    } finally { clearTimeout(timer); }
}
/** Flush originating-device cancellations. Results are read by its serialized drain.
 * Do not adopt another installation's reviews: save nonces belong to its manifest. */
export async function syncBackgroundImports(ownerId: string, activeOwner: () => string | null): Promise<void> {
    assertOwner(ownerId, activeOwner);
    for (const retired of listRetiredRemoteImports(ownerId)) {
        await backgroundImportCall(ownerId, activeOwner, 'dismiss', { job_id: retired.remoteJobId,
            import_nonce: retired.importNonce, url: retired.url });
        finishRetiredRemoteImport(retired.jobId, ownerId);
    }
}

/** A timeout never authorizes local extraction: the server might already own it. */
export async function readBackgroundImport(manifest: ImportManifest,
    activeOwner: () => string | null): Promise<RemoteImport | null> {
    const ownerId = manifest.userId;
    if (!ownerId || !manifest.remoteJobId) return null;
    let job: RemoteImport;
    try {
        job = await backgroundImportCall<RemoteImport>(ownerId, activeOwner, 'status', { job_id: manifest.remoteJobId });
    } catch (error) {
        const status = (error as { cause?: { status?: number } })?.cause?.status;
        if (status !== 404) throw error;
        // The native upload may still be in flight. The exact same request identity
        // makes this authenticated retry safe even if that upload arrives later.
        if (!getImportForUser(manifest.jobId, ownerId)) return null;
        try {
            await backgroundImportCall(ownerId, activeOwner, 'enqueue', { job_id: manifest.remoteJobId,
                import_nonce: manifest.importNonce, url: manifest.url, protocol_generation: 'v2',
                installation_id: getBackgroundImportInstallationId?.() ?? null });
        } catch (error) {
            const rejected = (error as { cause?: { status?: number } })?.cause?.status;
            if (rejected && [400, 403, 409, 413, 422].includes(rejected)) throw new BackgroundImportRejectedError();
            throw error;
        }
        return null;
    }
    if (!getImportForUser(manifest.jobId, ownerId)) return null;
    if (job.owner_id !== ownerId || job.job_id?.toLowerCase() !== manifest.remoteJobId.toLowerCase()
        || job.import_nonce?.toLowerCase() !== manifest.importNonce.toLowerCase() || job.url !== manifest.url) throw new Error('Background import identity mismatch');
    return job;
}

export function validRemoteResult(result: ResolveUrlData | null | undefined): result is ResolveUrlData {
    return !!result && Array.isArray(result.candidates) && result.candidates.length > 0 && result.candidates.length <= 20
        && result.candidates.every(candidate => candidate && typeof candidate === 'object'
            && candidate.restaurant && typeof candidate.restaurant === 'object'
            && typeof candidate.restaurant.name === 'string' && typeof candidate.resolution_id === 'string');
}
