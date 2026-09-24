/* eslint-disable import/first, @typescript-eslint/no-require-imports -- Jest mocks must be registered before module imports. */
/**
 * Guest side of AuthProvider (TICKET-247): the launch waits for both the
 * session and the guest-flag read, a session always clears guest mode, and
 * signing out of an account never lands in guest mode.
 */
import React from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';

const mockGetSession = jest.fn();
const mockMaybeSingle = jest.fn();
const mockReadGuestMode = jest.fn();
const mockWriteGuestMode = jest.fn((_value: boolean) => Promise.resolve());
let mockAuthListener: ((event: string, session: unknown) => void) | undefined;
let probe: ReturnType<typeof import('./AuthProvider').useAuth> | undefined;

jest.mock('react-native', () => {
    const ReactModule = require('react');
    return {
        Text: (props: Record<string, unknown>) =>
            ReactModule.createElement('Text', props, props.children),
        StyleSheet: {
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => Array.isArray(style)
                ? Object.assign({}, ...style.filter(Boolean))
                : (style ?? {}),
        },
    };
});

jest.mock('@/lib/supabase', () => ({
    supabase: {
        auth: {
            getSession: (...args: unknown[]) => mockGetSession(...args),
            onAuthStateChange: jest.fn((listener: (event: string, session: unknown) => void) => {
                mockAuthListener = listener;
                return { data: { subscription: { unsubscribe: jest.fn() } } };
            }),
            signOut: jest.fn(() => Promise.resolve()),
        },
        from: jest.fn(() => ({
            select: jest.fn(() => ({
                eq: jest.fn(() => ({ maybeSingle: mockMaybeSingle })),
            })),
        })),
    },
}));
jest.mock('@/lib/queryClient', () => ({ queryClient: { removeQueries: jest.fn() } }));
jest.mock('@/lib/importPush', () => ({
    setImportPushOwner: jest.fn(), unlinkImportPushDevice: jest.fn(),
    watchImportPushRegistration: () => jest.fn(),
}));
jest.mock('@/lib/backgroundImportIntake', () => ({
    setBackgroundImportOwner: jest.fn(), unlinkBackgroundImportIntake: jest.fn(),
}));
jest.mock('@/lib/guestMode', () => ({
    readGuestMode: () => mockReadGuestMode(),
    writeGuestMode: (value: boolean) => mockWriteGuestMode(value),
}));

import { AuthProvider, useAuth } from './AuthProvider';

function Probe() {
    probe = useAuth();
    return <Text testID="state">{`${probe.isLoading ? 'loading' : 'ready'}:${probe.isGuest ? 'guest' : 'account-or-none'}`}</Text>;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
}

async function flush() {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}

describe('AuthProvider guest mode', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAuthListener = undefined;
        probe = undefined;
        mockMaybeSingle.mockResolvedValue({ data: { onboarded_at: '2026-07-16T10:00:00.000Z' }, error: null });
    });

    it('keeps loading until both the session and the guest flag are known', async () => {
        const guest = deferred<boolean>();
        mockReadGuestMode.mockReturnValue(guest.promise);
        mockGetSession.mockResolvedValue({ data: { session: null } });
        const screen = render(<AuthProvider><Probe /></AuthProvider>);
        await flush();
        // Session answered (signed out) but the guest read has not: still loading,
        // so the root gate never routes a returning guest to /auth first.
        expect(screen.getByTestId('state').props.children).toBe('loading:account-or-none');

        await act(async () => {
            guest.resolve(true);
            await Promise.resolve();
        });
        expect(screen.getByTestId('state').props.children).toBe('ready:guest');
    });

    it('drops guest mode, in memory and storage, when a session arrives', async () => {
        mockReadGuestMode.mockResolvedValue(true);
        mockGetSession.mockResolvedValue({ data: { session: null } });
        const screen = render(<AuthProvider><Probe /></AuthProvider>);
        await flush();
        expect(screen.getByTestId('state').props.children).toBe('ready:guest');

        await act(async () => {
            mockAuthListener?.('SIGNED_IN', { user: { id: 'user-1' } });
            await Promise.resolve();
        });
        expect(screen.getByTestId('state').props.children).toBe('ready:account-or-none');
        expect(mockWriteGuestMode).toHaveBeenCalledWith(false);
    });

    it('never lands a signed-out account in guest mode', async () => {
        mockReadGuestMode.mockResolvedValue(false);
        mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
        const screen = render(<AuthProvider><Probe /></AuthProvider>);
        await flush();

        await act(async () => {
            await probe?.signOut();
        });
        expect(screen.getByTestId('state').props.children).toBe('ready:account-or-none');
        expect(mockWriteGuestMode).toHaveBeenLastCalledWith(false);
    });

    it('enters and leaves guest mode through the context', async () => {
        mockReadGuestMode.mockResolvedValue(false);
        mockGetSession.mockResolvedValue({ data: { session: null } });
        const screen = render(<AuthProvider><Probe /></AuthProvider>);
        await flush();

        await act(async () => {
            await probe?.enterGuestMode();
        });
        expect(screen.getByTestId('state').props.children).toBe('ready:guest');
        expect(mockWriteGuestMode).toHaveBeenLastCalledWith(true);

        await act(async () => {
            await probe?.exitGuestMode();
        });
        expect(screen.getByTestId('state').props.children).toBe('ready:account-or-none');
        expect(mockWriteGuestMode).toHaveBeenLastCalledWith(false);
    });
});
