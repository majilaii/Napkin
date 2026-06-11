/**
 * Tests for lib/pendingHandoff.ts — TICKET-072
 *
 * Uses the in-memory AsyncStorage mock configured in jest.setup.js.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { stash, peek, consume, clear } from '../pendingHandoff';

beforeEach(async () => {
    await AsyncStorage.clear();
    jest.useRealTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

// ── stash → consume is single-use ──────────────────────────────────────────────

describe('stash → consume is single-use', () => {
    it('first consume returns the stashed token', async () => {
        await stash('abc123Token_XYZ');
        const result = await consume();
        expect(result?.token).toBe('abc123Token_XYZ');
    });

    it('second consume returns null (key deleted on first consume)', async () => {
        await stash('abc123Token_XYZ');
        await consume();
        const result = await consume();
        expect(result).toBeNull();
    });
});

// ── peek does not remove ───────────────────────────────────────────────────────

describe('peek does not remove the stash', () => {
    it('peek twice returns the same token', async () => {
        await stash('token_AAA');
        const first = await peek();
        const second = await peek();
        expect(first?.token).toBe('token_AAA');
        expect(second?.token).toBe('token_AAA');
    });

    it('peek followed by consume returns the token', async () => {
        await stash('token_BBB');
        await peek();
        const result = await consume();
        expect(result?.token).toBe('token_BBB');
    });
});

// ── stashedAt ─────────────────────────────────────────────────────────────────

describe('stashedAt is a number (epoch ms)', () => {
    it('stashedAt is set to roughly now()', async () => {
        const before = Date.now();
        await stash('token_TIME_TEST');
        const after = Date.now();
        const result = await peek();
        expect(result?.stashedAt).toBeGreaterThanOrEqual(before);
        expect(result?.stashedAt).toBeLessThanOrEqual(after);
    });
});

// ── TTL expiry ────────────────────────────────────────────────────────────────

describe('TTL expiry', () => {
    it('stash from 11 minutes ago is treated as expired on consume', async () => {
        const elevenMinutesAgo = Date.now() - 11 * 60 * 1000;
        await AsyncStorage.setItem(
            'napkin.pendingHandoffToken',
            JSON.stringify({ token: 'old_token', stashedAt: elevenMinutesAgo }),
        );
        const result = await consume();
        expect(result).toBeNull();
    });

    it('expired stash is deleted from AsyncStorage on read', async () => {
        const elevenMinutesAgo = Date.now() - 11 * 60 * 1000;
        await AsyncStorage.setItem(
            'napkin.pendingHandoffToken',
            JSON.stringify({ token: 'old_token', stashedAt: elevenMinutesAgo }),
        );
        await peek();
        const raw = await AsyncStorage.getItem('napkin.pendingHandoffToken');
        expect(raw).toBeNull();
    });

    it('stash within TTL is returned', async () => {
        const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
        await AsyncStorage.setItem(
            'napkin.pendingHandoffToken',
            JSON.stringify({ token: 'recent_token', stashedAt: fiveMinutesAgo }),
        );
        const result = await peek();
        expect(result?.token).toBe('recent_token');
    });
});

// ── clear ────────────────────────────────────────────────────────────────────

describe('clear', () => {
    it('clear removes the stash so consume returns null', async () => {
        await stash('token_CLEAR_ME');
        await clear();
        const result = await consume();
        expect(result).toBeNull();
    });
});

// ── no stash ──────────────────────────────────────────────────────────────────

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

// ── malformed storage ─────────────────────────────────────────────────────────

describe('malformed storage value', () => {
    it('consume returns null on corrupt JSON', async () => {
        await AsyncStorage.setItem('napkin.pendingHandoffToken', 'not-valid-json{{{');
        const result = await consume();
        expect(result).toBeNull();
    });

    it('consume returns null when token field is missing', async () => {
        await AsyncStorage.setItem(
            'napkin.pendingHandoffToken',
            JSON.stringify({ stashedAt: Date.now() }),
        );
        const result = await consume();
        expect(result).toBeNull();
    });
});

// ── TOKEN-ONLY semantics ──────────────────────────────────────────────────────
// Handoff stash stores only the token (not the resolved snapshot).
// After auth the receive screen re-resolves server-side (Codex #1).

describe('stores token only (no snapshot)', () => {
    it('stashed entry has exactly token + stashedAt', async () => {
        await stash('test_token_123');
        const raw = await AsyncStorage.getItem('napkin.pendingHandoffToken');
        const parsed = JSON.parse(raw!);
        expect(Object.keys(parsed).sort()).toEqual(['stashedAt', 'token']);
        expect(parsed.token).toBe('test_token_123');
    });
});
