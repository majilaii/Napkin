/* eslint-disable import/first -- Jest mocks must be registered before module imports. */
/**
 * The root route gate (TICKET-107/090/247). App Review judges exactly this
 * surface: what a signed-out person can reach, and where signing in lands.
 */
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockDismissAll = jest.fn();
const mockCanGoBack = jest.fn(() => false);
let mockSegments: string[] = [];
let mockAuth: {
    session: { user: { id: string } } | null;
    isLoading: boolean;
    onboardedAt: string | null | undefined;
    isGuest: boolean;
};

jest.mock('expo-router', () => ({
    // A fresh array per render, like the real hook after any navigation, so the
    // gate effect re-runs on every rerender in these tests.
    useSegments: () => [...mockSegments],
    useRouter: () => ({
        replace: mockReplace,
        back: mockBack,
        dismissAll: mockDismissAll,
        canGoBack: mockCanGoBack,
    }),
}));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => mockAuth }));

import { renderHook } from '@testing-library/react-native';

import { useLaunchRouting } from '../useLaunchRouting';

const SESSION = { user: { id: 'user-1' } };

function run(opts: {
    segments: string[];
    session?: typeof SESSION | null;
    onboardedAt?: string | null | undefined;
    isGuest?: boolean;
    isLoading?: boolean;
    canGoBack?: boolean;
    previewOnLaunch?: boolean | undefined;
    consumed?: boolean;
}) {
    mockSegments = opts.segments;
    mockAuth = {
        session: opts.session === undefined ? null : opts.session,
        isLoading: opts.isLoading ?? false,
        onboardedAt: 'onboardedAt' in opts ? opts.onboardedAt : '2026-09-01T00:00:00Z',
        isGuest: opts.isGuest ?? false,
    };
    mockCanGoBack.mockReturnValue(opts.canGoBack ?? false);
    const consumed = { current: opts.consumed ?? false };
    const preview = 'previewOnLaunch' in opts ? opts.previewOnLaunch : false;
    const hook = renderHook(() => useLaunchRouting(preview, consumed));
    return { ...hook, consumed };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockCanGoBack.mockReturnValue(false);
});

describe('waiting', () => {
    it('does nothing while auth or the preview preference is unresolved', () => {
        run({ segments: ['(tabs)', 'places'], isLoading: true });
        run({ segments: ['(tabs)', 'places'], previewOnLaunch: undefined });
        run({ segments: ['auth'], session: SESSION, onboardedAt: undefined });
        expect(mockReplace).not.toHaveBeenCalled();
        expect(mockBack).not.toHaveBeenCalled();
    });
});

describe('signed out', () => {
    it('sends a non-guest to /auth from any app route, and leaves auth and recovery alone', () => {
        run({ segments: ['(tabs)', 'places'] });
        expect(mockReplace).toHaveBeenLastCalledWith('/auth');
        mockReplace.mockClear();
        run({ segments: ['restaurant', '[id]'] });
        expect(mockReplace).toHaveBeenLastCalledWith('/auth');
        mockReplace.mockClear();
        run({ segments: ['auth'] });
        run({ segments: ['reset-password'] });
        expect(mockReplace).not.toHaveBeenCalled();
    });

    it('lets a guest stay on the tabs and restaurant pages', () => {
        run({ segments: ['(tabs)', 'places'], isGuest: true });
        run({ segments: ['(tabs)', 'profile'], isGuest: true });
        run({ segments: ['restaurant', '[id]'], isGuest: true });
        run({ segments: ['auth'], isGuest: true });
        run({ segments: [], isGuest: true });
        expect(mockReplace).not.toHaveBeenCalled();
    });

    it('sends a guest to /auth from any account route, including the hidden tabs', () => {
        for (const segments of [
            ['settings'], ['entry-detail'], ['u', '[identifier]'], ['list', '[id]'], ['import'],
            ['places-scope'], ['table', '[id]', 'settings'], ['(tabs)', 'journal'], ['(tabs)', 'log'],
        ]) {
            mockReplace.mockClear();
            run({ segments, isGuest: true });
            expect(mockReplace).toHaveBeenCalledWith('/auth');
        }
    });
});

describe('leaving /auth once signed in', () => {
    // OnboardingGateBoundary unmounts the navigator while the new session's
    // profile is read, so nothing below /auth survives sign-in. The gate always
    // replaces to Places, whatever the stack looked like before.
    it('replaces /auth with Places, even when a guest stack sat beneath it', () => {
        run({ segments: ['auth'], session: SESSION, canGoBack: false });
        expect(mockReplace).toHaveBeenLastCalledWith('/places');
        mockReplace.mockClear();
        run({ segments: ['auth'], session: SESSION, canGoBack: true });
        expect(mockReplace).toHaveBeenLastCalledWith('/places');
        expect(mockBack).not.toHaveBeenCalled();
        expect(mockDismissAll).not.toHaveBeenCalled();
    });

    it('does nothing on ordinary signed-in routes', () => {
        run({ segments: ['(tabs)', 'places'], session: SESSION, canGoBack: true });
        run({ segments: ['restaurant', '[id]'], session: SESSION, canGoBack: true });
        expect(mockReplace).not.toHaveBeenCalled();
        expect(mockBack).not.toHaveBeenCalled();
    });
});

describe('new accounts', () => {
    it('route to onboarding from /auth', () => {
        const { consumed } = run({ segments: ['auth'], session: SESSION, onboardedAt: null });
        expect(mockReplace).toHaveBeenCalledWith('/onboarding');
        expect(consumed.current).toBe(true);
    });

    it('let a pending import or recovery finish before onboarding', () => {
        for (const group of ['import', 'handoff', 'join-table', 'reset-password', 'onboarding']) {
            run({ segments: [group], session: SESSION, onboardedAt: null, canGoBack: true });
        }
        expect(mockReplace).not.toHaveBeenCalled();
        expect(mockDismissAll).not.toHaveBeenCalled();
    });

    it('reach onboarding from any other signed-in route', () => {
        run({ segments: ['(tabs)', 'places'], session: SESSION, onboardedAt: null, canGoBack: true });
        expect(mockReplace).toHaveBeenCalledWith('/onboarding');
    });
});

describe('onboarding preview preference', () => {
    it('runs once for an onboarded account, then yields', () => {
        const { consumed } = run({ segments: ['(tabs)', 'places'], session: SESSION, previewOnLaunch: true });
        expect(mockReplace).toHaveBeenCalledWith('/onboarding');
        expect(consumed.current).toBe(true);

        mockReplace.mockClear();
        run({ segments: ['(tabs)', 'places'], session: SESSION, previewOnLaunch: true, consumed: true });
        expect(mockReplace).not.toHaveBeenCalled();
    });
});
