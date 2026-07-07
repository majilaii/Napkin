/**
 * importActivation — the "has imported before" durable flag (TICKET-122).
 *
 * The activation hub renders `full` on an empty Wishlist / hub and collapses to a
 * one-line `compact` entry point once the user has landed a first import. That
 * collapse needs a cheap, durable, offline signal. This is it: a single boolean in
 * AsyncStorage, mirrored in a module-level cache so the hub variant can be seeded
 * SYNCHRONOUSLY on first render (no full→compact flash for repeat users).
 *
 * Mirrors the AsyncStorage discipline of lib/localNotify.ts + lib/importQueue.ts:
 * try/catch, never throw, best-effort persist, in-memory mirror for sync reads.
 * NO native, NO network — unit-testable without a build.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const IMPORT_COMPLETED_KEY = 'napkin.import.completedOnce';
/** The stored truthy sentinel (any non-'1' value reads as "not yet"). */
const FLAG_VALUE = '1';

// In-memory mirror so useHasImported can seed the hub variant synchronously on the
// FIRST render. Primed once at module load; flipped to true (and persisted) the
// first time an import completes. `primed` keeps a slow-resolving load read from
// clobbering an explicit markImportCompleted() that raced ahead of it.
let cachedCompleted = false;
let primed = false;

// Prime the cache once at module load (best-effort). A stored '1' means the user
// imported in a prior session — read it back so getImportCompletedCached() is
// correct on later renders without waiting on the async round-trip every time.
AsyncStorage.getItem(IMPORT_COMPLETED_KEY)
    .then((raw) => {
        if (!primed && raw === FLAG_VALUE) cachedCompleted = true;
        primed = true;
    })
    .catch(() => {
        primed = true; // storage unavailable — keep the `false` fallback
    });

/**
 * Synchronous cache read — the hub-variant seed. Never throws, never async. Returns
 * false until the flag is set (this session) or the module-load prime resolves a
 * stored '1'. Used by useHasImported's initial state so repeat users never see the
 * full hub flash before it collapses to compact.
 */
export function getImportCompletedCached(): boolean {
    return cachedCompleted;
}

/**
 * Mark that at least one import has completed. Idempotent — once the cache is set,
 * a repeat call is a no-op (no redundant write). Best-effort persist (fire-and-
 * forget); the in-memory mirror still holds for this session even if the write
 * fails. Synchronous by design so a save path can flip the hub without awaiting.
 */
export function markImportCompleted(): void {
    primed = true; // an explicit completion outranks a late-resolving prime
    if (cachedCompleted) return; // idempotent — already flagged this session
    cachedCompleted = true;
    AsyncStorage.setItem(IMPORT_COMPLETED_KEY, FLAG_VALUE).catch(() => {
        /* best-effort — the in-memory mirror still holds for this session */
    });
}

/**
 * Resolve the durable flag (cache-first, then storage). Never throws — a storage
 * error reads as "not yet imported" (false). Caches a stored '1' so subsequent
 * getImportCompletedCached() calls return true synchronously.
 */
export async function getImportCompletedFlag(): Promise<boolean> {
    if (cachedCompleted) return true;
    try {
        const raw = await AsyncStorage.getItem(IMPORT_COMPLETED_KEY);
        if (raw === FLAG_VALUE) {
            cachedCompleted = true;
            return true;
        }
    } catch {
        /* storage unavailable — fall through to false */
    }
    return false;
}
