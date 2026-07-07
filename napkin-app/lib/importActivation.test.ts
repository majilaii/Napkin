/**
 * importActivation tests (TICKET-122) — the durable "has imported" flag.
 *
 * The module holds a module-level cache primed at load, so each test resets the
 * module registry + clears AsyncStorage for isolation (mirrors the discipline of
 * lib/localNotify.test.ts, which keeps its gate pure to sidestep this).
 */
type Mod = typeof import('./importActivation');

function loadFresh(): Mod {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('./importActivation') as Mod;
}

function asyncStorage(): {
    clear: () => Promise<void>;
    getItem: (k: string) => Promise<string | null>;
    setItem: (k: string, v: string) => Promise<void>;
} {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('@react-native-async-storage/async-storage');
    return m.default ?? m; // the CJS jest mock exports the store directly (no .default)
}

// Let the module-load prime's microtask settle before asserting on the cache.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('importActivation', () => {
    beforeEach(async () => {
        jest.resetModules();
        await asyncStorage().clear();
    });

    it('markImportCompleted → getImportCompletedFlag round-trips + persists', async () => {
        const mod = loadFresh();
        mod.markImportCompleted();
        expect(await mod.getImportCompletedFlag()).toBe(true);
        // persisted under the documented key
        expect(await asyncStorage().getItem(mod.IMPORT_COMPLETED_KEY)).toBe('1');
    });

    it('getImportCompletedCached flips synchronously on markImportCompleted (no flash)', () => {
        const mod = loadFresh();
        expect(mod.getImportCompletedCached()).toBe(false);
        mod.markImportCompleted();
        // Synchronous — the hub can seed compact on the SAME render, no full→compact jank.
        expect(mod.getImportCompletedCached()).toBe(true);
    });

    it('markImportCompleted is idempotent (repeat call is a no-op write)', async () => {
        const mod = loadFresh();
        const store = asyncStorage();
        const setSpy = jest.spyOn(store, 'setItem');
        mod.markImportCompleted();
        mod.markImportCompleted();
        mod.markImportCompleted();
        expect(setSpy.mock.calls.filter((c: unknown[]) => c[0] === mod.IMPORT_COMPLETED_KEY)).toHaveLength(1);
    });

    it('getImportCompletedFlag reads a stored flag from a prior session, then caches it', async () => {
        // Seed storage BEFORE the module loads (simulates a prior install).
        await asyncStorage().setItem('napkin.import.completedOnce', '1');
        const mod = loadFresh();
        expect(await mod.getImportCompletedFlag()).toBe(true);
        // Now cached — synchronous reads see it.
        expect(mod.getImportCompletedCached()).toBe(true);
    });

    it('module-load prime seeds the cache from stored state', async () => {
        await asyncStorage().setItem('napkin.import.completedOnce', '1');
        const mod = loadFresh();
        await flush(); // let the load-time getItem resolve
        expect(mod.getImportCompletedCached()).toBe(true);
    });

    it('swallows an AsyncStorage.getItem throw → reads false (never throws)', async () => {
        const store = asyncStorage();
        jest.spyOn(store, 'getItem').mockRejectedValue(new Error('storage down'));
        const mod = loadFresh();
        await expect(mod.getImportCompletedFlag()).resolves.toBe(false);
    });

    it('swallows an AsyncStorage.setItem throw → cache still holds for the session', () => {
        const store = asyncStorage();
        jest.spyOn(store, 'setItem').mockRejectedValue(new Error('storage down'));
        const mod = loadFresh();
        expect(() => mod.markImportCompleted()).not.toThrow();
        expect(mod.getImportCompletedCached()).toBe(true);
    });
});
