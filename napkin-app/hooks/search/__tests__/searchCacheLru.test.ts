/**
 * Tests for the result-LRU side of hooks/search/searchCache.ts (TICKET-174):
 * coords-bucketed keys and the timestamp TTL. The cache holds module-scope
 * state, so each test re-requires a fresh module via jest.resetModules().
 */

type SearchCache = typeof import('../searchCache').searchCache;
type Cached = import('../searchCache').CachedSearchResult;

let searchCache: SearchCache;

function freshModules(): void {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    searchCache = require('../searchCache').searchCache;
}

function entry(timestamp = Date.now()): Cached {
    return {
        places: [],
        persisted: { visitedByMyTables: [], onNapkin: [] },
        timestamp,
    };
}

beforeEach(() => {
    freshModules();
});

describe('coords-bucketed keys', () => {
    it('the same query cached under one bucket does not replay for another', () => {
        searchCache.set('kamer', entry(), '51.5,-0.1'); // London
        expect(searchCache.get('kamer', '51.5,-0.1')).toBeDefined();
        expect(searchCache.get('kamer', '52.4,4.9')).toBeUndefined(); // Amsterdam
        expect(searchCache.get('kamer', null)).toBeUndefined(); // unlocated
    });

    it('null and undefined bucket share the unlocated key', () => {
        searchCache.set('kamer', entry(), null);
        expect(searchCache.get('kamer')).toBeDefined();
        expect(searchCache.has('kamer', null)).toBe(true);
    });

    it('query normalization still applies within a bucket', () => {
        searchCache.set('  Kamer ', entry(), '51.5,-0.1');
        expect(searchCache.get('kamer', '51.5,-0.1')).toBeDefined();
    });
});

describe('TTL', () => {
    it('an entry older than 15 minutes is expired on read', () => {
        const stale = entry(Date.now() - 16 * 60 * 1000);
        searchCache.set('kamer', stale, '51.5,-0.1');
        expect(searchCache.get('kamer', '51.5,-0.1')).toBeUndefined();
        expect(searchCache.has('kamer', '51.5,-0.1')).toBe(false);
    });

    it('a fresh entry survives', () => {
        searchCache.set('kamer', entry(Date.now() - 5 * 60 * 1000), '51.5,-0.1');
        expect(searchCache.get('kamer', '51.5,-0.1')).toBeDefined();
    });
});
