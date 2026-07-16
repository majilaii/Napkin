import React from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';

const mockMaybeSingle = jest.fn();
const mockGetSession = jest.fn();
const mockUnsubscribe = jest.fn();
let confirmOnboardedAt: ((value: string | null) => void) | undefined;

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
            onAuthStateChange: jest.fn(() => ({
                data: { subscription: { unsubscribe: mockUnsubscribe } },
            })),
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

import { AuthProvider, useAuth } from './AuthProvider';

function GateProbe() {
    const { onboardedAt, setOnboardedAt } = useAuth();
    confirmOnboardedAt = setOnboardedAt;
    const value = onboardedAt === undefined
        ? 'checking'
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
        expect(screen.getByTestId('gate').props.children).toBe('checking');
        expect(screen.queryByText(new Date(0).toISOString())).toBeNull();
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
