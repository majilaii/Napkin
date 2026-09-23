import { callEdgeFn } from './edgeInvoke';
import { listRetiredRemoteImports, finishRetiredRemoteImport, type ImportManifest } from './importQueue';

// TICKET-248: the server intake lane is retired. New shares never create server
// jobs; this module only tells the server to drop jobs that builds 262+ created,
// so a late server result can never notify for an import this device processed.

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
/** Flush originating-device cancellations of retired server-lane jobs. */
export async function syncBackgroundImports(ownerId: string, activeOwner: () => string | null): Promise<void> {
    assertOwner(ownerId, activeOwner);
    for (const retired of listRetiredRemoteImports(ownerId)) {
        await backgroundImportCall(ownerId, activeOwner, 'dismiss', { job_id: retired.remoteJobId,
            import_nonce: retired.importNonce, url: retired.url });
        finishRetiredRemoteImport(retired.jobId, ownerId);
    }
}

/**
 * Tombstone a server-lane job this device now processes itself. The capture
 * identity rides along so an upload that arrives later still lands dismissed.
 */
export async function dismissBackgroundImport(manifest: ImportManifest,
    activeOwner: () => string | null): Promise<void> {
    if (!manifest.userId || !manifest.remoteJobId) return;
    await backgroundImportCall(manifest.userId, activeOwner, 'dismiss', { job_id: manifest.remoteJobId,
        import_nonce: manifest.importNonce, url: manifest.url });
}
