/**
 * TICKET-189 — the AppState → focusManager bridge + the FOREGROUND PRIVACY
 * test the design mandates: feed mounted → app backgrounds → a saver blocks
 * the viewer (or flips private) server-side → app foregrounds → the clip is
 * gone WITHOUT a manual refresh.
 *
 * Without the bridge, refetchOnWindowFocus is inert on React Native (no
 * browser visibilitychange, and nothing else calls focusManager.setFocused) —
 * the exact silent privacy bug Codex R2 caught.
 *
 * react-native is mocked per repo convention (jest.setup.js ships a minimal
 * global mock without AppState); the file-level mock adds a capturable
 * AppState so the test can drive the background → active lifecycle.
 */

let capturedAppStateHandler: ((s: string) => void) | null = null;
const mockRemove = jest.fn();
const mockAddEventListener = jest.fn((_event: string, handler: (s: string) => void) => {
    capturedAppStateHandler = handler;
    return { remove: mockRemove };
});

jest.mock('react-native', () => ({
    Platform: { OS: 'ios', select: jest.fn((obj: Record<string, unknown>) => obj.ios) },
    NativeModules: {},
    NativeEventEmitter: jest.fn(),
    StyleSheet: { create: jest.fn((styles: unknown) => styles) },
    AppState: {
        addEventListener: (...args: [string, (s: string) => void]) => mockAddEventListener(...args),
    },
}));
jest.mock('@/providers/AuthProvider', () => ({
    useAuth: jest.fn(() => ({
        user: { id: 'test-user-id' },
        session: null,
        isLoading: false,
        signOut: jest.fn(),
    })),
    AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));
// Force the socials flag ON so the real useSocials hook is exercised end-to-end.
jest.mock('@/constants/flags', () => ({
    ...jest.requireActual('@/constants/flags'),
    FOR_YOU_SOCIALS: true,
}));

import React from 'react';
import { focusManager } from '@tanstack/react-query';
import { act, waitFor } from '@testing-library/react-native';

import { renderHookWithClient } from '../__tests__/utils/queryWrapper';
import { applyAppStateFocus, bindQueryFocusToAppState } from './focusBridge';
import { useSocials, type SocialsCard } from '@/hooks/feed/useSocials';
import { callEdgeFn } from '@/lib/edgeInvoke';

const mockCallEdgeFn = callEdgeFn as jest.Mock;

function clip(restaurantId: string): SocialsCard {
    return {
        restaurant_id: restaurantId,
        name: 'Blocked Bistro',
        neighborhood: 'Testville',
        rung: 3,
        window: null,
        count: null,
        platform: 'tiktok',
        creator_handle: 'creator',
        thumb_url: null,
        photo_url: null,
        photo_source: null,
        attribution_html: null,
    };
}

beforeEach(() => {
    capturedAppStateHandler = null;
});

afterEach(() => {
    // focusManager state is module-global — reset so tests stay independent.
    focusManager.setFocused(undefined);
});

describe('applyAppStateFocus', () => {
    it("maps 'active' → focused, 'background'/'inactive' → unfocused", () => {
        applyAppStateFocus('background');
        expect(focusManager.isFocused()).toBe(false);
        applyAppStateFocus('active');
        expect(focusManager.isFocused()).toBe(true);
        applyAppStateFocus('inactive');
        expect(focusManager.isFocused()).toBe(false);
    });
});

describe('bindQueryFocusToAppState', () => {
    it('subscribes to AppState change and unsubscribes on cleanup', () => {
        const unbind = bindQueryFocusToAppState();
        expect(mockAddEventListener).toHaveBeenCalledWith('change', applyAppStateFocus);

        unbind();
        expect(mockRemove).toHaveBeenCalled();
    });
});

describe('foreground privacy (useSocials + bridge, end-to-end)', () => {
    it('a clip whose saver blocked the viewer while backgrounded is gone on foreground — no manual refresh', async () => {
        const unbind = bindQueryFocusToAppState();
        expect(capturedAppStateHandler).not.toBeNull();

        // Server state 1: the clip is visible to this viewer.
        mockCallEdgeFn.mockResolvedValue({ rows: [clip('r-1')] });

        const { result } = renderHookWithClient(() => useSocials('test-user-id'));
        await waitFor(() => expect(result.current.data).toHaveLength(1));

        // While backgrounded, the saver blocks the viewer (or flips private):
        // the server's stage-2 viewer pass now returns nothing.
        mockCallEdgeFn.mockResolvedValue({ rows: [] });

        act(() => {
            capturedAppStateHandler?.('background');
            capturedAppStateHandler?.('active');
        });

        // Foreground → focus refetch → the clip is gone, no manual refresh.
        await waitFor(() => expect(result.current.data).toHaveLength(0));
        expect(mockCallEdgeFn.mock.calls.length).toBeGreaterThanOrEqual(2);

        unbind();
    });
});
