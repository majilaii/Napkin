/**
 * pendingImport — AsyncStorage stash for a URL shared via the iOS share
 * extension while the user was signed out.
 *
 * Four exports: stash, peek, consume, clear.
 * No React deps. Pure async functions.
 *
 * Stash shape: { url: string; stashedAt: number (ms epoch) }
 * TTL: 10 minutes, checked lazily on every peek/consume call.
 * Expired stashes are deleted on read — no background timer.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'napkin.pendingImportUrl';
const TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface Stash {
    url: string;
    /** Unix epoch in milliseconds. */
    stashedAt: number;
}

/** Write a URL to the stash with the current timestamp. */
export async function stash(url: string): Promise<void> {
    const payload: Stash = { url, stashedAt: Date.now() };
    await AsyncStorage.setItem(KEY, JSON.stringify(payload));
}

/**
 * Read the stash without removing it.
 * Returns null if absent or expired (and deletes the key on expiry).
 */
export async function peek(): Promise<Stash | null> {
    try {
        const raw = await AsyncStorage.getItem(KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Stash;
        if (Date.now() - parsed.stashedAt > TTL_MS) {
            // Expired — clean up lazily.
            await AsyncStorage.removeItem(KEY);
            return null;
        }
        return parsed;
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
