import React from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';

const mockMaybeSingle = jest.fn();
const mockGetSession = jest.fn();
const mockUnsubscribe = jest.fn();
let mockAuthListener: ((event: string, session: unknown) => void) | undefined;
let confirmOnboardedAt: ((value: string | null) => void) | undefined;
let retryGate: (() => void) | undefined;

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
                return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
            }),
            signOut: jest.fn(),
        },
        from: jest.fn(() => ({
            select: jest.fn(() => ({
                eq: jest.fn(() => ({ maybeSingle: mockMaybeSingle })),
            })),
        })),
    },
}));
jest.mock('@/lib/queryClient', () => ({
    queryClient: { removeQueries: jest.fn() },
}));
jest.mock('@/lib/importPush', () => ({
    setImportPushOwner: jest.fn(), unlinkImportPushDevice: jest.fn(),
    watchImportPushRegistration: () => jest.fn(),
}));
jest.mock('@/lib/backgroundImportIntake', () => ({
    setBackgroundImportOwner: jest.fn(), unlinkBackgroundImportIntake: jest.fn(),
}));

import { AuthProvider, useAuth } from './AuthProvider';

function GateProbe() {
    const { onboardedAt, onboardingGateUnresolved, retryOnboardingGate, setOnboardedAt } = useAuth();
    confirmOnboardedAt = setOnboardedAt;
    retryGate = retryOnboardingGate;
    const value = onboardedAt === undefined
        ? onboardingGateUnresolved ? 'unresolved' : 'checking'
        : onboardedAt === null
            ? 'needs-onboarding'
            : onboardedAt;
    return <Text testID="gate">{value}</Text>;
}

describe('AuthProvider onboarding gate', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        confirmOnboardedAt = undefined;
        retryGate = undefined;
        mockAuthListener = undefined;
        mockGetSession.mockResolvedValue({
            data: { session: { user: { id: 'user-1' } } },
        });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('retries a transient profile read and resolves only from real data', async () => {
        mockMaybeSingle
            .mockResolvedValueOnce({ data: null, error: new Error('temporary') })
            .mockResolvedValueOnce({
                data: { onboarded_at: '2026-07-16T10:00:00.000Z' },
                error: null,
            });
        const screen = render(
            <AuthProvider><GateProbe /></AuthProvider>,
        );

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(screen.getByTestId('gate').props.children).toBe('checking');

        await act(async () => {
            await jest.advanceTimersByTimeAsync(250);
        });
        expect(screen.getByTestId('gate').props.children).toBe('2026-07-16T10:00:00.000Z');
        expect(mockMaybeSingle).toHaveBeenCalledTimes(2);
    });

    it('stays in the blocking checking state after bounded retry exhaustion', async () => {
        mockMaybeSingle.mockResolvedValue({ data: null, error: new Error('offline') });
        const screen = render(
            <AuthProvider><GateProbe /></AuthProvider>,
        );

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        await act(async () => {
            await jest.advanceTimersByTimeAsync(250);
        });
        await act(async () => {
            await jest.advanceTimersByTimeAsync(750);
        });

        expect(mockMaybeSingle).toHaveBeenCalledTimes(3);
        // Still fail-closed (never a synthetic timestamp), but now marked
        // unresolved so the launch screen can offer a retry.
        expect(screen.getByTestId('gate').props.children).toBe('unresolved');
        expect(screen.queryByText(new Date(0).toISOString())).toBeNull();
    });

    it('re-reads an unresolved gate on retry and resolves from real data', async () => {
        mockMaybeSingle
            .mockResolvedValueOnce({ data: null, error: new Error('offline') })
            .mockResolvedValueOnce({ data: null, error: new Error('offline') })
            .mockResolvedValueOnce({ data: null, error: new Error('offline') })
            .mockResolvedValueOnce({ data: { onboarded_at: null }, error: null });
        const screen = render(
            <AuthProvider><GateProbe /></AuthProvider>,
        );

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        await act(async () => {
            await jest.advanceTimersByTimeAsync(1_000);
        });
        expect(screen.getByTestId('gate').props.children).toBe('unresolved');

        await act(async () => {
            retryGate?.();
            await Promise.resolve();
        });
        expect(mockMaybeSingle).toHaveBeenCalledTimes(4);
        expect(screen.getByTestId('gate').props.children).toBe('needs-onboarding');
    });

    it('keeps a resolved gate through a token refresh for the same person', async () => {
        mockMaybeSingle.mockResolvedValue({
            data: { onboarded_at: '2026-07-16T10:00:00.000Z' },
            error: null,
        });
        const screen = render(
            <AuthProvider><GateProbe /></AuthProvider>,
        );
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(screen.getByTestId('gate').props.children).toBe('2026-07-16T10:00:00.000Z');

        // An hourly refresh (or a metadata update) must not blank the gate:
        // a blank gate unmounts every signed-in screen.
        act(() => mockAuthListener?.('TOKEN_REFRESHED', { user: { id: 'user-1' } }));
        act(() => mockAuthListener?.('USER_UPDATED', { user: { id: 'user-1' } }));
        expect(screen.getByTestId('gate').props.children).toBe('2026-07-16T10:00:00.000Z');
        expect(mockMaybeSingle).toHaveBeenCalledTimes(1);
    });

    it('does not start a second read for the initial-session echo', async () => {
        let resolveProfile: ((value: {
            data: { onboarded_at: string };
            error: null;
        }) => void) | undefined;
        mockMaybeSingle.mockReturnValueOnce(new Promise((resolve) => {
            resolveProfile = resolve;
        }));
        const screen = render(
            <AuthProvider><GateProbe /></AuthProvider>,
        );
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        act(() => mockAuthListener?.('INITIAL_SESSION', { user: { id: 'user-1' } }));
        expect(mockMaybeSingle).toHaveBeenCalledTimes(1);

        await act(async () => {
            resolveProfile?.({ data: { onboarded_at: '2026-07-16T10:00:00.000Z' }, error: null });
            await Promise.resolve();
        });
        expect(screen.getByTestId('gate').props.children).toBe('2026-07-16T10:00:00.000Z');
    });

    it('re-reads the gate for a different person', async () => {
        mockMaybeSingle
            .mockResolvedValueOnce({ data: { onboarded_at: '2026-07-16T10:00:00.000Z' }, error: null })
            .mockResolvedValueOnce({ data: { onboarded_at: null }, error: null });
        const screen = render(
            <AuthProvider><GateProbe /></AuthProvider>,
        );
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(screen.getByTestId('gate').props.children).toBe('2026-07-16T10:00:00.000Z');

        await act(async () => {
            mockAuthListener?.('SIGNED_IN', { user: { id: 'user-2' } });
            await Promise.resolve();
        });
        expect(mockMaybeSingle).toHaveBeenCalledTimes(2);
        expect(screen.getByTestId('gate').props.children).toBe('needs-onboarding');
    });

    it('lets a later auth event retry a gate that never got an answer', async () => {
        mockMaybeSingle
            .mockResolvedValueOnce({ data: null, error: new Error('offline') })
            .mockResolvedValueOnce({ data: null, error: new Error('offline') })
            .mockResolvedValueOnce({ data: null, error: new Error('offline') })
            .mockResolvedValueOnce({ data: { onboarded_at: '2026-07-16T10:00:00.000Z' }, error: null });
        const screen = render(
            <AuthProvider><GateProbe /></AuthProvider>,
        );
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        await act(async () => {
            await jest.advanceTimersByTimeAsync(1_000);
        });
        expect(screen.getByTestId('gate').props.children).toBe('unresolved');

        await act(async () => {
            mockAuthListener?.('TOKEN_REFRESHED', { user: { id: 'user-1' } });
            await Promise.resolve();
        });
        expect(mockMaybeSingle).toHaveBeenCalledTimes(4);
        expect(screen.getByTestId('gate').props.children).toBe('2026-07-16T10:00:00.000Z');
    });

    it('ignores a retry when nobody is signed in', async () => {
        mockGetSession.mockResolvedValue({ data: { session: null } });
        const screen = render(
            <AuthProvider><GateProbe /></AuthProvider>,
        );
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        await act(async () => {
            retryGate?.();
            await Promise.resolve();
        });
        expect(mockMaybeSingle).not.toHaveBeenCalled();
        expect(screen.getByTestId('gate').props.children).toBe('checking');
    });

    it('does not let a stale pre-completion read undo server-confirmed onboarding', async () => {
        let resolveProfile: ((value: {
            data: { onboarded_at: null };
            error: null;
        }) => void) | undefined;
        mockMaybeSingle.mockReturnValueOnce(new Promise((resolve) => {
            resolveProfile = resolve;
        }));
        const screen = render(
            <AuthProvider><GateProbe /></AuthProvider>,
        );

        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(screen.getByTestId('gate').props.children).toBe('checking');

        const confirmed = '2026-07-16T12:34:56.000Z';
        act(() => confirmOnboardedAt?.(confirmed));
        expect(screen.getByTestId('gate').props.children).toBe(confirmed);

        await act(async () => {
            resolveProfile?.({ data: { onboarded_at: null }, error: null });
            await Promise.resolve();
        });
        expect(screen.getByTestId('gate').props.children).toBe(confirmed);
    });
});
