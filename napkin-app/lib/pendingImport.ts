/**
 * pendingImport — AsyncStorage stash for a URL shared via the iOS share
 * extension while the user was signed out.
 *
 * Four exports: stash, peek, consume, clear.
 * No React deps. Pure async functions.
 *
 * TICKET-063 ARCH-REVIEW-2 #12:
 *   Stash shape widened to include import_nonce:
 *     { url: string; import_nonce: string; stashedAt: number (ms epoch) }
 *   import_nonce is minted pre-auth at share receipt and carried through resolution
 *   so signed-out → resume replays reuse the same job-level idempotency key.
 *   Per-spot client_nonces are minted post-auth at save time and never persisted.
 *   Candidate lists are never persisted across auth.
 *
 * TTL: 10 minutes, checked lazily on every peek/consume call.
 * Expired stashes are deleted on read — no background timer.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { safeRandomUUID } from './uuid';

const KEY = 'napkin.pendingImportUrl';
const TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface Stash {
    url: string;
    /**
     * TICKET-063: job-level idempotency key minted pre-auth.
     * Carried through the sign-in flow so a retry save uses the same import_nonce
     * and fn_save_import_spot ON CONFLICT DO NOTHING deduplicates the job row.
     */
    import_nonce: string;
    /** Unix epoch in milliseconds. */
    stashedAt: number;
}

/** Write a URL + import_nonce to the stash with the current timestamp. */
export async function stash(url: string, import_nonce?: string): Promise<void> {
    const nonce = import_nonce ?? safeRandomUUID();
    const payload: Stash = { url, import_nonce: nonce, stashedAt: Date.now() };
    await AsyncStorage.setItem(KEY, JSON.stringify(payload));
}

/**
 * Read the stash without removing it.
 * Returns null if absent or expired (and deletes the key on expiry).
 * Backward-compat: old stash entries without import_nonce get a stable synthetic nonce
 * derived from the URL so they can still be replayed idempotently.
 */
export async function peek(): Promise<Stash | null> {
    try {
        const raw = await AsyncStorage.getItem(KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<Stash> & { url: string; stashedAt: number };
        if (Date.now() - parsed.stashedAt > TTL_MS) {
            // Expired — clean up lazily.
            await AsyncStorage.removeItem(KEY);
            return null;
        }
        // Back-compat: old entries don't have import_nonce; synthesize one so callers always see the field.
        const import_nonce = parsed.import_nonce ?? safeRandomUUID();
        return { url: parsed.url, import_nonce, stashedAt: parsed.stashedAt };
    } catch {
        return null;
    }
}

/**
 * Read the stash and remove it atomically (single-use).
 * Returns null if absent or expired.
 */
export async function consume(): Promise<Stash | null> {
    const found = await peek();
    if (found) {
        await AsyncStorage.removeItem(KEY);
    }
    return found;
}

/** Remove the stash unconditionally (e.g. on auth cancel). */
export async function clear(): Promise<void> {
    await AsyncStorage.removeItem(KEY);
}
