/**
 * pendingHandoff — AsyncStorage stash for a handoff token received while signed out.
 *
 * Stores only the token (no snapshot). After auth the receive screen re-resolves the
 * token server-side so a revoked token resolves to the in-app tombstone (Codex #1).
 *
 * TICKET-072 ARCH-REVIEW-2 #11:
 *   When both pendingImport and pendingHandoff exist, postAuthResume.ts picks the
 *   most-recent stashedAt. The loser is preserved for the next resume cycle.
 *
 * TTL: 10 minutes (matches pendingImport). Expired stashes deleted on read.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'napkin.pendingHandoffToken';
const TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface HandoffStash {
    token: string;
    /** Unix epoch in milliseconds. */
    stashedAt: number;
}

/** Write a token to the stash with the current timestamp. */
export async function stash(token: string): Promise<void> {
    const payload: HandoffStash = { token, stashedAt: Date.now() };
    await AsyncStorage.setItem(KEY, JSON.stringify(payload));
}

/**
 * Read the stash without removing it.
 * Returns null if absent or expired (and deletes the key on expiry).
 */
export async function peek(): Promise<HandoffStash | null> {
    try {
        const raw = await AsyncStorage.getItem(KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<HandoffStash>;
        if (!parsed.token || typeof parsed.token !== 'string') return null;
        if (!parsed.stashedAt || Date.now() - parsed.stashedAt > TTL_MS) {
            await AsyncStorage.removeItem(KEY);
            return null;
        }
        return { token: parsed.token, stashedAt: parsed.stashedAt };
    } catch {
        return null;
    }
}

/**
 * Read the stash and remove it atomically (single-use).
 * Returns null if absent or expired.
 */
export async function consume(): Promise<HandoffStash | null> {
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
