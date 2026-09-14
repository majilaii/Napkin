/**
 * Tests for lib/pendingIdentity.ts — App Store Guideline 4 fix (2026-09-14).
 *
 * Apple hands the user's name over exactly once, out-of-band, on the first
 * authorization. This stash is what carries it from auth.tsx across
 * RootLayoutNav's immediate redirect into the onboarding name step. The two
 * properties that matter: the read is available SYNCHRONOUSLY on the first
 * render, and a stash is never readable by a different account.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clear, peek, peekSync, stash } from '../pendingIdentity';

/** Mirrors the KEY in lib/pendingIdentity — the cold-start tests seed it directly. */
const STORAGE_KEY = 'napkin.pendingIdentity';
const USER = 'user-aaa';
const OTHER = 'user-bbb';

beforeEach(async () => {
    await AsyncStorage.clear();
    await clear();
});

describe('pendingIdentity', () => {
    it('reads back the stashed name synchronously — no await, no flash', async () => {
        await stash(USER, { fullName: 'Ada Lovelace', email: 'ada@example.com' });
        expect(peekSync(USER)?.fullName).toBe('Ada Lovelace');
        expect(peekSync(USER)?.email).toBe('ada@example.com');
    });

    it('trims, and stores a blank name as null', async () => {
        await stash(USER, { fullName: '  Grace  ', email: '  ' });
        expect(peekSync(USER)?.fullName).toBe('Grace');
        expect(peekSync(USER)?.email).toBeNull();
    });

    it('never leaks one account’s identity to another', async () => {
        await stash(USER, { fullName: 'Ada Lovelace', email: null });
        expect(peekSync(OTHER)).toBeNull();
        await expect(peek(OTHER)).resolves.toBeNull();
        // ...and the rightful owner still reads it.
        await expect(peek(USER)).resolves.toMatchObject({ fullName: 'Ada Lovelace' });
    });

    it('recovers from AsyncStorage when the memo is cold (app restarted)', async () => {
        // A process that restarted between sign-in and onboarding has the stored
        // copy but an empty memo — seed storage directly rather than via stash().
        // (jest.resetModules() cannot stand in for this: it would also hand the
        // re-required module a fresh, empty AsyncStorage mock.)
        await AsyncStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                userId: USER,
                fullName: 'Ada Lovelace',
                email: null,
                stashedAt: Date.now(),
            }),
        );
        expect(peekSync(USER)).toBeNull();
        await expect(peek(USER)).resolves.toMatchObject({ fullName: 'Ada Lovelace' });
        // Having warmed the memo, the sync path now serves it too.
        expect(peekSync(USER)?.fullName).toBe('Ada Lovelace');
    });

    it('ignores a stored payload belonging to a different account', async () => {
        await AsyncStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                userId: OTHER,
                fullName: 'Somebody Else',
                email: null,
                stashedAt: Date.now(),
            }),
        );
        await expect(peek(USER)).resolves.toBeNull();
    });

    it('expires after the TTL rather than resurfacing a stale name', async () => {
        await stash(USER, { fullName: 'Ada Lovelace', email: null });
        const thirtyOneMinutes = 31 * 60 * 1000;
        const realNow = Date.now;
        Date.now = () => realNow() + thirtyOneMinutes;
        try {
            expect(peekSync(USER)).toBeNull();
            await expect(peek(USER)).resolves.toBeNull();
        } finally {
            Date.now = realNow;
        }
    });

    it('clear() drops both the memo and the stored copy', async () => {
        await stash(USER, { fullName: 'Ada Lovelace', email: null });
        await clear();
        expect(peekSync(USER)).toBeNull();
        await expect(peek(USER)).resolves.toBeNull();
    });

    it('survives an AsyncStorage write failure via the memo', async () => {
        const setItem = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
        await expect(stash(USER, { fullName: 'Ada Lovelace', email: null })).resolves.toBeUndefined();
        expect(peekSync(USER)?.fullName).toBe('Ada Lovelace');
        setItem.mockRestore();
    });
});
