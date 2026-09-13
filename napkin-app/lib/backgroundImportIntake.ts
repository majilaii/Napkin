import { callEdgeFn } from '@/lib/edgeInvoke';
import {
    clearBackgroundImportCredential,
    getBackgroundImportCredential,
    getBackgroundImportInstallationId,
    getPendingBackgroundImportRevocations,
    isBackgroundImportIntakeAvailable,
    revokeBackgroundImportCredential,
    setNativeBackgroundImportOwner,
    writeBackgroundImportCredential,
    type BackgroundImportCredential,
} from '@/modules/media-extract';

const RENEW_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;
let activeOwner: string | null = null;
let ownerGeneration = 0;
let registering: { owner: string; promise: Promise<void> } | null = null;
let flushing: Promise<void> | null = null;

/** Run synchronously at every auth identity change, before React renders. */
export function setBackgroundImportOwner(userId?: string | null): void {
    const owner = userId ?? null;
    if (owner !== activeOwner) ownerGeneration += 1;
    activeOwner = owner;
    // Native clears the old active credential and retains a separate revocation
    // record. Offline sign-out must never leave the extension able to use it.
    try { setNativeBackgroundImportOwner(owner); } catch { /* unlinked/locked */ }
}

/** Revocations use their own scoped token, including after the user signs out. */
export function flushBackgroundImportRevocations(): Promise<void> {
    if (flushing) return flushing;
    const work = async () => {
        if (!isBackgroundImportIntakeAvailable()) return;
        for (const credential of getPendingBackgroundImportRevocations().slice(0, 3)) {
            try { await revokeBackgroundImportCredential(credential); } catch { /* retained natively for retry */ }
        }
    };
    flushing = work().finally(() => { flushing = null; });
    return flushing;
}

/** Called before Supabase sign-out; clearing is immediate even while offline. */
export async function unlinkBackgroundImportIntake(expectedOwnerId?: string): Promise<void> {
    if (expectedOwnerId && activeOwner !== expectedOwnerId) return;
    const credential = getBackgroundImportCredential();
    setBackgroundImportOwner(null);
    try { clearBackgroundImportCredential(); } catch { /* native method unavailable */ }
    // Bound logout to the current token's single native request (8s maximum).
    // Older offline revocations are replayed by the root lifecycle separately.
    if (credential && (!expectedOwnerId || credential.userId === expectedOwnerId)) {
        try { await revokeBackgroundImportCredential(credential); } catch { /* retained natively */ }
    }
}

interface RegisteredIntakeCredential {
    credential_id: string;
    token: string;
    expires_at: string;
}

/** Mint through normal JWT auth, then expose only the narrow intake credential. */
export function ensureBackgroundImportIntake(userId: string): Promise<void> {
    if (!isBackgroundImportIntakeAvailable() || activeOwner !== userId) return Promise.resolve();
    if (registering?.owner === userId) return registering.promise;
    const generation = ownerGeneration;
    const work = async () => {
        const baseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
        const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
        if (!baseUrl?.startsWith('https://') || !anonKey) return;
        const endpoint = `${baseUrl.replace(/\/$/, '')}/functions/v1/background-imports`;
        const existing = getBackgroundImportCredential();
        // Keep a healthy credential stable while iOS may still be uploading a
        // share using it. Rotation is needed only near expiry or after switching.
        if (existing?.userId === userId && existing.endpoint === endpoint
            && existing.expiresAt > Date.now() + RENEW_WITHIN_MS) return;
        const installationId = getBackgroundImportInstallationId();
        if (!installationId) return;
        const pending = getPendingBackgroundImportRevocations();
        const previous = existing?.token ?? pending[pending.length - 1]?.token;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        try {
            const result = await callEdgeFn<RegisteredIntakeCredential>('background-imports', {
                action: 'register_intake',
                signal: controller.signal,
                body: { installation_id: installationId, expected_owner_id: userId,
                    ...(previous ? { previous_credential: previous } : {}) },
            });
            const expiresAt = Date.parse(result.expires_at);
            if (!Number.isFinite(expiresAt)) throw new Error('Invalid intake credential expiry');
            const credential: BackgroundImportCredential = {
                credentialId: result.credential_id, token: result.token, expiresAt,
                userId, installationId, endpoint, anonKey,
            };
            if (generation !== ownerGeneration || activeOwner !== userId) {
                // A register reply can race a logout/account switch. Never make
                // it active for the next account; revoke by secret possession.
                await revokeBackgroundImportCredential(credential);
                return;
            }
            if (!writeBackgroundImportCredential(credential)) {
                await revokeBackgroundImportCredential(credential);
            }
        } finally {
            clearTimeout(timeout);
        }
    };
    const promise = work().finally(() => {
        if (registering?.promise === promise) registering = null;
    });
    registering = { owner: userId, promise };
    return promise;
}
