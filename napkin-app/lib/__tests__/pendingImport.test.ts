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
