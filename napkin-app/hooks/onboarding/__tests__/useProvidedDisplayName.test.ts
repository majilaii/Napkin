/* eslint-disable import/first -- Jest mocks must be registered before module imports. */
/**
 * Tests for useProvidedDisplayName — App Store Guideline 4 fix (2026-09-14).
 *
 * This hook is the gate on whether the onboarding name step renders at all. A
 * non-null result means Apple (or Google) already gave us the name and the user
 * must never be asked for it again; `undefined` means "still reading" and the
 * screen must show nothing rather than flash a form it is about to skip.
 */
jest.mock('@/providers/AuthProvider', () => ({ useAuth: jest.fn() }));

import { renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth } from '@/providers/AuthProvider';
import { clear, stash } from '@/lib/pendingIdentity';
import { useProvidedDisplayName } from '../useProvidedDisplayName';

/** Mirrors the KEY in lib/pendingIdentity — the cross-account test seeds it directly. */
const STORAGE_KEY = 'napkin.pendingIdentity';
const USER = 'user-aaa';

// `id` is explicitly nullable: passing `undefined` would hit the default and
// silently mock a SIGNED-IN user, which is the opposite of what a "no user"
// test means.
function mockUser(
    metadata: Record<string, unknown> | undefined,
    id: string | null = USER,
    isLoading = false,
) {
    jest.mocked(useAuth).mockReturnValue({
        user: id ? { id, user_metadata: metadata } : null,
        isLoading,
    } as unknown as ReturnType<typeof useAuth>);
}

beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    await clear();
});

describe('useProvidedDisplayName', () => {
    it('resolves the stashed Apple name on the FIRST render — no flash of the form', async () => {
        await stash(USER, { fullName: 'Ada Lovelace', email: 'ada@example.com' });
        mockUser({});
        const { result } = renderHook(() => useProvidedDisplayName());
        // Synchronous: the very first value, not something we waited for.
        expect(result.current).toBe('Ada Lovelace');
        // Flush the effect so a late resolve cannot leak into the next test.
        await waitFor(() => expect(result.current).toBe('Ada Lovelace'));
    });

    it('falls back to user_metadata when nothing is stashed (the Google path)', async () => {
        mockUser({ full_name: 'Grace Hopper' });
        const { result } = renderHook(() => useProvidedDisplayName());
        await waitFor(() => expect(result.current).toBe('Grace Hopper'));
    });

    it('settles on null for an Apple RE-AUTH with nothing known', async () => {
        // Apple sends the name only once; the reviewer's already-authorized Apple
        // ID gets null. The step may then ask — but must not require.
        mockUser({});
        const { result } = renderHook(() => useProvidedDisplayName());
        expect(result.current).toBeUndefined(); // still reading, render nothing
        await waitFor(() => expect(result.current).toBeNull());
    });

    it("treats the trigger's 'New User' placeholder as no name at all", async () => {
        mockUser({ display_name: 'New User' });
        const { result } = renderHook(() => useProvidedDisplayName());
        await waitFor(() => expect(result.current).toBeNull());
    });

    it('never reads another account’s stashed name', async () => {
        await stash('somebody-else', { fullName: 'Somebody Else', email: null });
        mockUser({});
        const { result } = renderHook(() => useProvidedDisplayName());
        await waitFor(() => expect(result.current).toBeNull());
    });

    // Per-user cache isolation: a resolved name is an answer for ONE account. The
    // name step patches whatever this hook returns straight into the onboarding
    // draft, so handing the incoming user the previous one's name — even for a
    // render or two — would write it to their profile.
    //
    // The first account's name MUST come from the AsyncStorage path: a name in
    // user_metadata resolves synchronously through `immediate` and never
    // populates the cached state this guards. Seeding storage directly keeps the
    // memo cold so the async read is the one that answers.
    it('never hands a new account the previous account\u2019s resolved name', async () => {
        await AsyncStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
                userId: 'user-aaa',
                fullName: 'Ada Lovelace',
                email: null,
                stashedAt: Date.now(),
            }),
        );
        mockUser({}, 'user-aaa');
        const { result, rerender } = renderHook(() => useProvidedDisplayName());
        await waitFor(() => expect(result.current).toBe('Ada Lovelace'));

        // Auth identity changes. The new user has no name anywhere.
        mockUser({}, 'user-bbb');
        rerender(undefined);
        expect(result.current).toBeUndefined(); // never 'Ada Lovelace'
        await waitFor(() => expect(result.current).toBeNull());
    });

    it('waits while auth is still loading, then settles rather than hanging', async () => {
        // undefined must be transient: a step that renders nothing forever is a
        // worse failure than one that asks.
        mockUser(undefined, null, true);
        const loading = renderHook(() => useProvidedDisplayName());
        expect(loading.result.current).toBeUndefined();

        mockUser(undefined, null, false);
        const settled = renderHook(() => useProvidedDisplayName());
        expect(settled.result.current).toBeNull();
        await waitFor(() => expect(settled.result.current).toBeNull());
    });

    it('picks up a name that arrives with a later session refresh', async () => {
        mockUser({});
        const { result, rerender } = renderHook(() => useProvidedDisplayName());
        await waitFor(() => expect(result.current).toBeNull());

        mockUser({ full_name: 'Ada Lovelace' });
        rerender(undefined);
        expect(result.current).toBe('Ada Lovelace');
    });
});
