/**
 * pendingInvite — AsyncStorage stash for a table-invite code received while signed out.
 *
 * Stores only the code (no table data). After auth the join-table screen redeems
 * the code server-side so a revoked code resolves to the in-app tombstone.
 *
 * When pendingImport / pendingHandoff / pendingInvite coexist, postAuthResume.ts
 * picks the most-recent stashedAt. The losers are preserved for the next cycle.
 *
 * TTL: 10 minutes (matches pendingImport / pendingHandoff). Expired stashes
 * deleted on read.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'napkin.pendingInviteCode';
const TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface InviteStash {
    code: string;
    /** Unix epoch in milliseconds. */
    stashedAt: number;
}

/** Write a code to the stash with the current timestamp. */
export async function stash(code: string): Promise<void> {
    const payload: InviteStash = { code, stashedAt: Date.now() };
    await AsyncStorage.setItem(KEY, JSON.stringify(payload));
}

/**
 * Read the stash without removing it.
 * Returns null if absent or expired (and deletes the key on expiry).
 */
export async function peek(): Promise<InviteStash | null> {
    try {
        const raw = await AsyncStorage.getItem(KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<InviteStash>;
        if (!parsed.code || typeof parsed.code !== 'string') return null;
        if (!parsed.stashedAt || Date.now() - parsed.stashedAt > TTL_MS) {
            await AsyncStorage.removeItem(KEY);
            return null;
        }
        return { code: parsed.code, stashedAt: parsed.stashedAt };
    } catch {
        return null;
    }
}

/**
 * Read the stash and remove it atomically (single-use).
 * Returns null if absent or expired.
 */
export async function consume(): Promise<InviteStash | null> {
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
