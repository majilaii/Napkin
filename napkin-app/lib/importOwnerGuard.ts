/** Auth-switch fence for work resumed from a durable import manifest. */

export class ImportOwnerChangedError extends Error {
    code = 'session_expired' as const;

    constructor() {
        super('The signed-in account changed while this import was running.');
        this.name = 'ImportOwnerChangedError';
    }
}

export function requireActiveImportOwner(
    manifestOwnerId: string | null | undefined,
    activeUserId: string | null | undefined,
): string {
    if (!manifestOwnerId || manifestOwnerId !== activeUserId) {
        throw new ImportOwnerChangedError();
    }
    return manifestOwnerId;
}

/**
 * Fence an awaited owner-bound operation on both sides. The pre-check prevents a
 * stale drain from starting work after an account switch; the post-check keeps a
 * response for the prior account from mutating/removing its durable manifest.
 */
export async function runWithActiveImportOwner<T>(
    manifestOwnerId: string | null | undefined,
    readActiveUserId: () => string | null | undefined,
    operation: (expectedOwnerId: string) => Promise<T>,
): Promise<T> {
    const expectedOwnerId = requireActiveImportOwner(manifestOwnerId, readActiveUserId());
    const result = await operation(expectedOwnerId);
    requireActiveImportOwner(expectedOwnerId, readActiveUserId());
    return result;
}
