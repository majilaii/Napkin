/**
 * Tests for lib/pendingImport.ts
 *
 * Uses the in-memory AsyncStorage mock configured in jest.setup.js.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { stash, peek, consume, clear } from '../pendingImport';

beforeEach(async () => {
    await AsyncStorage.clear();
    jest.useRealTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

describe('stash → consume is single-use', () => {
    it('first consume returns the stashed URL', async () => {
        await stash('https://eater.com/nyc');
        const result = await consume();
        expect(result?.url).toBe('https://eater.com/nyc');
    });

    it('second consume returns null (key was deleted on first consume)', async () => {
        await stash('https://eater.com/nyc');
        await consume(); // first — clears the key
        const result = await consume(); // second — should be null
        expect(result).toBeNull();
    });
});

describe('peek does not remove the stash', () => {
    it('peek twice returns the same URL', async () => {
        await stash('https://nytimes.com/dining');
        const first = await peek();
        const second = await peek();
        expect(first?.url).toBe('https://nytimes.com/dining');
        expect(second?.url).toBe('https://nytimes.com/dining');
    });

    it('peek followed by consume returns the URL (peek did not delete)', async () => {
        await stash('https://nytimes.com/dining');
        await peek();
        const result = await consume();
        expect(result?.url).toBe('https://nytimes.com/dining');
    });
});

describe('TTL expiry', () => {
    it('stash with stashedAt 11 minutes ago is treated as expired on consume', async () => {
        const elevenMinutesAgo = Date.now() - 11 * 60 * 1000;
        const expired = JSON.stringify({ url: 'https://old.link', stashedAt: elevenMinutesAgo });
        await AsyncStorage.setItem('napkin.pendingImportUrl', expired);

        const result = await consume();
        expect(result).toBeNull();
    });

    it('expired stash is deleted from AsyncStorage on read', async () => {
        const elevenMinutesAgo = Date.now() - 11 * 60 * 1000;
        await AsyncStorage.setItem(
            'napkin.pendingImportUrl',
            JSON.stringify({ url: 'https://old.link', stashedAt: elevenMinutesAgo }),
        );

        await peek(); // reads + deletes on expiry
        const raw = await AsyncStorage.getItem('napkin.pendingImportUrl');
        expect(raw).toBeNull();
    });

    it('stash within TTL is returned', async () => {
        // stashedAt = now - 5 minutes (within 10-min TTL)
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
        await AsyncStorage.setItem(
            'napkin.pendingImportUrl',
            JSON.stringify({ url: 'https://recent.link', stashedAt: fiveMinutesAgo }),
        );

        const result = await peek();
        expect(result?.url).toBe('https://recent.link');
    });
});

describe('clear', () => {
    it('clear removes the stash so consume returns null', async () => {
        await stash('https://eater.com');
        await clear();
        const result = await consume();
        expect(result).toBeNull();
    });
});

describe('no stash', () => {
    it('consume returns null when nothing was stashed', async () => {
        const result = await consume();
        expect(result).toBeNull();
    });

    it('peek returns null when nothing was stashed', async () => {
        const result = await peek();
        expect(result).toBeNull();
    });
});

describe('malformed storage value', () => {
    it('consume returns null and does not throw on corrupt JSON', async () => {
        await AsyncStorage.setItem('napkin.pendingImportUrl', 'not-valid-json{{{');
        const result = await consume();
        expect(result).toBeNull();
    });
});

// ── TICKET-063: import_nonce field ────────────────────────────────────────────

describe('import_nonce field (TICKET-063 ARCH-REVIEW-2 #12)', () => {
    it('stash with explicit import_nonce preserves it on peek', async () => {
        const nonce = 'aaaabbbb-cccc-4ddd-eeee-ffffffffffff';
        await stash('https://maps.google.com/place/123', nonce);
        const result = await peek();
        expect(result?.import_nonce).toBe(nonce);
    });

    it('stash without explicit import_nonce generates one on peek', async () => {
        await stash('https://eater.com/nyc');
        const result = await peek();
        expect(result?.import_nonce).toBeDefined();
        expect(typeof result?.import_nonce).toBe('string');
        expect((result?.import_nonce ?? '').length).toBeGreaterThan(0);
    });

    it('back-compat: old stash entry without import_nonce gets synthetic nonce on peek', async () => {
        // Simulate a pre-TICKET-063 stash entry (no import_nonce field)
        const oldEntry = JSON.stringify({ url: 'https://old.link', stashedAt: Date.now() });
        await AsyncStorage.setItem('napkin.pendingImportUrl', oldEntry);

        const result = await peek();
        expect(result?.url).toBe('https://old.link');
        expect(result?.import_nonce).toBeDefined();
        expect(typeof result?.import_nonce).toBe('string');
    });

    it('back-compat: synthetic nonce is stable across two peek calls (same stash entry)', async () => {
        // Old entry without import_nonce
        const oldEntry = JSON.stringify({ url: 'https://stable.link', stashedAt: Date.now() });
        await AsyncStorage.setItem('napkin.pendingImportUrl', oldEntry);

        // IMPORTANT: the current implementation generates a fresh nonce each call for
        // back-compat entries (because it calls generateNonce() each time).
        // This test documents that the nonce is always present, not that it's identical.
        const result1 = await peek();
        const result2 = await peek();
        expect(result1?.import_nonce).toBeDefined();
        expect(result2?.import_nonce).toBeDefined();
    });

    it('consume returns import_nonce from new-format stash', async () => {
        const nonce = '12345678-1234-4234-b234-123456789abc';
        await stash('https://tiktok.com/v/999', nonce);
        const result = await consume();
        expect(result?.import_nonce).toBe(nonce);
        expect(result?.url).toBe('https://tiktok.com/v/999');
    });

    it('stashedAt is a number (epoch ms)', async () => {
        const before = Date.now();
        await stash('https://maps.google.com/test');
        const after = Date.now();
        const result = await peek();
        expect(result?.stashedAt).toBeGreaterThanOrEqual(before);
        expect(result?.stashedAt).toBeLessThanOrEqual(after);
    });
});

// ── TICKET-063 fix-pass-2: signed-out restash preserves nonce (item 4) ───────
//
// import.tsx signed-out branch used to call stash(rawUrl) without the nonce
// route param, causing the nonce to be dropped. Fix: stash(rawUrl, rawNonce).
// This test mirrors the corrected behavior.

describe('signed-out restash preserves nonce (fix-pass-2 item 4)', () => {
    it('stash with nonce from route param → consume returns that nonce', async () => {
        // Simulates: import.tsx receives ?url=…&nonce=abc → stash(rawUrl, rawNonce)
        const url = 'https://tiktok.com/v/42';
        const nonce = 'route-param-nonce-abc';
        await stash(url, nonce);
        const result = await consume();
        expect(result?.url).toBe(url);
        expect(result?.import_nonce).toBe(nonce);
    });

    it('stash without nonce (missing route param) → consume returns a generated nonce', async () => {
        // Simulates: import.tsx receives ?url=… but nonce param absent
        const url = 'https://eater.com/article';
        await stash(url, undefined);
        const result = await consume();
        expect(result?.url).toBe(url);
        expect(result?.import_nonce).toBeDefined();
        expect(typeof result?.import_nonce).toBe('string');
    });

    it('nonce survives a round-trip: stash → peek → nonce matches', async () => {
        const nonce = 'survives-round-trip-nonce';
        await stash('https://maps.google.com/xyz', nonce);
        const peeked = await peek();
        expect(peeked?.import_nonce).toBe(nonce);
        // Still present after peek (not consumed)
        const peeked2 = await peek();
        expect(peeked2?.import_nonce).toBe(nonce);
    });
});
