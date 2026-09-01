/**
 * Tests for the persisted recent-searches side of hooks/search/searchCache.ts
 * (TICKET-097).
 *
 * The cache holds module-scope state, so each test re-requires a fresh module
 * (and a fresh in-memory AsyncStorage mock) via jest.resetModules().
 */

const STORAGE_KEY = 'napkin.recentSearches.v1';

type SearchCache = typeof import('../searchCache').searchCache;
type AsyncStorageMock = typeof import('@react-native-async-storage/async-storage').default;

let searchCache: SearchCache;
let AsyncStorage: AsyncStorageMock;

/** Let pending microtasks/timers (hydration, write-through) settle. */
function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function freshModules(): void {
    jest.resetModules();
    // The jest mock (see jest.setup.js) is plain CJS — interop both shapes.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const asMod = require('@react-native-async-storage/async-storage');
    AsyncStorage = asMod.default ?? asMod;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    searchCache = require('../searchCache').searchCache;
}

beforeEach(() => {
    freshModules();
});

describe('write-through on add', () => {
    it('addRecent persists the list under napkin.recentSearches.v1', async () => {
        searchCache.addRecent('carbone');
        searchCache.addRecent('donia');
        await flush();

        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        expect(JSON.parse(raw!)).toEqual(['donia', 'carbone']);
    });

    it('re-adding an existing query moves it to the front (deduped)', async () => {
        searchCache.addRecent('carbone');
        searchCache.addRecent('donia');
        searchCache.addRecent('carbone');
        await flush();

        expect([...searchCache.getRecentQueries()]).toEqual(['carbone', 'donia']);
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        expect(JSON.parse(raw!)).toEqual(['carbone', 'donia']);
    });

    it('caps at 8, evicting the oldest', async () => {
        for (let i = 1; i <= 10; i++) searchCache.addRecent(`query ${i}`);
        await flush();

        const recents = [...searchCache.getRecentQueries()];
        expect(recents).toHaveLength(8);
        expect(recents[0]).toBe('query 10');
        expect(recents).not.toContain('query 1');
        expect(recents).not.toContain('query 2');
    });
});

describe('hydration', () => {
    // Hydration is lazy (first subscribe/add), so seeding storage BEFORE the
    // first touch of the fresh module simulates a prior session's stash.

    it('subscribeRecents triggers hydration from storage and notifies', async () => {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(['tatiana', 'buvette']));

        const listener = jest.fn();
        searchCache.subscribeRecents(listener);
        expect(searchCache.getRecentQueries()).toEqual([]); // not yet landed

        await flush();
        expect(listener).toHaveBeenCalled();
        expect([...searchCache.getRecentQueries()]).toEqual(['tatiana', 'buvette']);
    });

    it('queries added before hydration lands stay newest (merge)', async () => {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(['tatiana', 'buvette']));

        searchCache.addRecent('carbone'); // kicks hydration AND adds in-memory
        await flush();

        expect([...searchCache.getRecentQueries()]).toEqual(['carbone', 'tatiana', 'buvette']);
    });

    // The jest mock resolves getItem on the same microtask; a real device takes
    // a native round-trip. These pin the ordering bug that timing difference
    // hides: an add's write-through must never commit before the hydration
    // read, or it clobbers the prior session's stash.

    it('an add during a SLOW hydration read merges instead of wiping the stash', async () => {
        jest.spyOn(AsyncStorage, 'getItem').mockImplementation(
            () =>
                new Promise<string | null>((resolve) =>
                    setTimeout(() => resolve(JSON.stringify(['a', 'b', 'c'])), 10),
                ),
        );
        const setItemSpy = jest.spyOn(AsyncStorage, 'setItem');

        searchCache.addRecent('donia'); // kicks hydration; read is now in flight
        await flush();
        // The P0 invariant: no disk write may commit while the read is in flight.
        expect(setItemSpy).not.toHaveBeenCalled();

        await new Promise((resolve) => setTimeout(resolve, 30));
        expect([...searchCache.getRecentQueries()]).toEqual(['donia', 'a', 'b', 'c']);
        // Exactly one combined write, after the read landed, carrying the merge.
        expect(setItemSpy).toHaveBeenCalledTimes(1);
        expect(setItemSpy).toHaveBeenLastCalledWith(
            STORAGE_KEY,
            JSON.stringify(['donia', 'a', 'b', 'c']),
        );
    });

    it('clear during a SLOW hydration read stays cleared; later adds persist alone', async () => {
        jest.spyOn(AsyncStorage, 'getItem').mockImplementation(
            () =>
                new Promise<string | null>((resolve) =>
                    setTimeout(() => resolve(JSON.stringify(['a', 'b'])), 10),
                ),
        );
        const setItemSpy = jest.spyOn(AsyncStorage, 'setItem');

        searchCache.subscribeRecents(() => {}); // kicks hydration
        searchCache.clearRecents();
        searchCache.addRecent('x'); // post-clear add, still pre-read-resolution
        await new Promise((resolve) => setTimeout(resolve, 30));

        expect([...searchCache.getRecentQueries()]).toEqual(['x']); // a,b not resurrected
        expect(setItemSpy).toHaveBeenLastCalledWith(STORAGE_KEY, JSON.stringify(['x']));
    });

    it('ignores a corrupt stash', async () => {
        await AsyncStorage.setItem(STORAGE_KEY, 'not json {');

        searchCache.subscribeRecents(() => {});
        await flush();
        expect(searchCache.getRecentQueries()).toEqual([]);
    });

    it('drops non-string entries from a tampered stash', async () => {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(['ok', 42, null, '  ']));

        searchCache.subscribeRecents(() => {});
        await flush();
        expect([...searchCache.getRecentQueries()]).toEqual(['ok']);
    });
});

describe('clearRecents', () => {
    it('empties memory and removes the storage key', async () => {
        searchCache.addRecent('carbone');
        await flush();

        searchCache.clearRecents();
        await flush();

        expect(searchCache.getRecentQueries()).toEqual([]);
        expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('an in-flight hydration cannot resurrect cleared entries', async () => {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(['tatiana']));

        searchCache.subscribeRecents(() => {}); // hydration starts…
        searchCache.clearRecents(); // …cleared before it lands
        await flush();

        expect(searchCache.getRecentQueries()).toEqual([]);
    });

    it('clear() (LRU + recents) still clears recents — API compat', async () => {
        searchCache.addRecent('carbone');
        await flush();

        searchCache.clear();
        await flush();

        expect(searchCache.getRecentQueries()).toEqual([]);
        expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
    });
});

describe('subscription mechanics', () => {
    it('notifies on add and stops after unsubscribe', async () => {
        const listener = jest.fn();
        const unsubscribe = searchCache.subscribeRecents(listener);

        searchCache.addRecent('carbone');
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
        searchCache.addRecent('donia');
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('snapshot reference is stable between changes (useSyncExternalStore contract)', () => {
        searchCache.addRecent('carbone');
        const a = searchCache.getRecentQueries();
        const b = searchCache.getRecentQueries();
        expect(a).toBe(b);

        searchCache.addRecent('donia');
        expect(searchCache.getRecentQueries()).not.toBe(a);
    });

    it('ignores empty/whitespace queries', () => {
        searchCache.addRecent('   ');
        expect(searchCache.getRecentQueries()).toEqual([]);
    });
});

describe('result LRU correctness', () => {
    const nonEmpty = () => ({
        places: [{
            id: 'place-1',
            name: 'Kamer',
            city: 'Amsterdam',
            cuisine: null,
            photoReference: null,
            photoAttributionHtml: null,
            formattedAddress: 'Amsterdam',
            latitude: 52.37,
            longitude: 4.9,
        }],
        persisted: { visitedByMyTables: [], onNapkin: [] },
        timestamp: Date.now(),
    });

    it('keys result entries by the 0.1-degree coordinate bucket', () => {
        searchCache.set('user-a', 'kamer', nonEmpty(), '51.5,-0.1');
        expect(searchCache.get('user-a', 'kamer', '51.5,-0.1')).toBeDefined();
        expect(searchCache.get('user-a', 'kamer', '52.4,4.9')).toBeUndefined();
    });

    it('does not expose a private result entry to another authenticated user', () => {
        searchCache.set('user-a', 'kamer', nonEmpty(), '51.5,-0.1');
        expect(searchCache.get('user-a', 'kamer', '51.5,-0.1')).toBeDefined();
        expect(searchCache.get('user-b', 'kamer', '51.5,-0.1')).toBeUndefined();
    });

    it('expires result entries after 15 minutes', () => {
        jest.spyOn(Date, 'now').mockReturnValue(1_000);
        searchCache.set('user-a', 'kamer', nonEmpty(), '51.5,-0.1');
        jest.spyOn(Date, 'now').mockReturnValue(1_000 + 15 * 60 * 1000);
        expect(searchCache.get('user-a', 'kamer', '51.5,-0.1')).toBeUndefined();
        jest.restoreAllMocks();
    });

    it('never stores a fully-empty result set', () => {
        searchCache.set('user-a', 'missing', {
            places: [],
            persisted: { visitedByMyTables: [], onNapkin: [] },
            timestamp: Date.now(),
        });
        expect(searchCache.get('user-a', 'missing')).toBeUndefined();
    });
});
