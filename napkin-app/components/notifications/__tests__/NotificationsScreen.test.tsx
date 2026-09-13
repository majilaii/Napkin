import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import NotificationsScreen, { handleTap, NotificationRow } from '@/app/notifications';
import type { ImportDoneNotification, Notification } from '@/hooks/notifications/useNotifications';
import type { useRouter } from 'expo-router';

const mockPush = jest.fn();
const mockRouter = { push: mockPush, back: jest.fn() };
const mockRefetch = jest.fn();
const mockFetchNextPage = jest.fn();
const mockMarkRead = jest.fn();
const mockMarkAllRead = jest.fn();
let mockUnreadCount = 0;
let mockMarkReadPending = false;
let mockMarkAllPending = false;
let mockInbox: {
    data?: { pages: { rows: Notification[] }[] };
    isLoading: boolean;
    isError: boolean;
    hasNextPage: boolean;
    isFetchingNextPage: boolean;
    isFetchNextPageError: boolean;
} = {
    data: { pages: [{ rows: [] }] },
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
};

jest.mock('react-native', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactModule = require('react') as typeof React;
    const host = (name: string) => (props: Record<string, unknown>) => (
        ReactModule.createElement(name, props, props.children as React.ReactNode)
    );
    return {
        ActivityIndicator: host('ActivityIndicator'),
        Image: host('Image'),
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios },
        Pressable: (props: Record<string, unknown>) => ReactModule.createElement('View', {
            ...props,
            accessible: true,
            // Native Pressable forwards disabled into the host accessibility
            // state; reproduce that contract so presses and a11y agree.
            accessibilityState: {
                ...(props.accessibilityState as Record<string, unknown> | undefined),
                disabled: props.disabled ?? false,
            },
            onStartShouldSetResponder: () => !props.disabled,
        }, props.children as React.ReactNode),
        ScrollView: host('ScrollView'),
        StyleSheet: {
            create: (styles: unknown) => styles,
            flatten: (style: unknown): Record<string, unknown> => (
                (Array.isArray(style) ? style : [style]).flat(Infinity).filter(Boolean)
                    .reduce<Record<string, unknown>>((result, item) => ({
                        ...result, ...(item as Record<string, unknown>),
                    }), {})
            ),
        },
        Text: host('Text'),
        View: host('View'),
    };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'viewer' } }) }));
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('expo-router', () => ({
    Stack: { Screen: () => null },
    useRouter: () => mockRouter,
    useFocusEffect: (callback: () => void) => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const ReactModule = require('react') as typeof React;
        ReactModule.useEffect(callback, [callback]);
    },
}));
jest.mock('@/hooks/notifications', () => ({
    useNotifications: () => ({ ...mockInbox, refetch: mockRefetch, fetchNextPage: mockFetchNextPage }),
    useUnreadCount: () => mockUnreadCount,
    useMarkNotificationRead: () => ({ mutate: mockMarkRead, isPending: mockMarkReadPending }),
    useMarkAllNotificationsRead: () => ({ mutate: mockMarkAllRead, isPending: mockMarkAllPending }),
    useRespondInvitation: () => ({ mutate: jest.fn() }),
    bucketFor: () => 'today',
    bucketLabel: () => 'Today',
    flattenPages: (data?: { pages: { rows: Notification[] }[] }) => (
        data?.pages.flatMap((page) => page.rows) ?? []
    ),
}));
// Keep the row, date heading and empty-state UI real while avoiding unrelated
// bell/permission imports from the barrel (those pull device notification APIs).
jest.mock('@/components/notifications', () => ({
    ...jest.requireActual('@/components/notifications/NotifRow'),
    ...jest.requireActual('@/components/notifications/NotifDay'),
    ...jest.requireActual('@/components/notifications/NotifEmpty'),
    ...jest.requireActual('@/components/notifications/NotifGlyph'),
    ...jest.requireActual('@/components/notifications/NotifAction'),
    NotifAvatar: () => null,
    NotifThumb: () => null,
}));

function importNotice(overrides: Partial<ImportDoneNotification> = {}): ImportDoneNotification {
    return {
        id: 'notification-import',
        type: 'import_done',
        createdAt: '2026-09-13T12:00:00Z',
        read: false,
        timeLabel: 'just now',
        count: 3,
        outcome: 'review',
        jobId: 'gallery-job-3',
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockUnreadCount = 0;
    mockMarkReadPending = false;
    mockMarkAllPending = false;
    mockInbox = {
        data: { pages: [{ rows: [] }] },
        isLoading: false,
        isError: false,
        hasNextPage: false,
        isFetchingNextPage: false,
        isFetchNextPageError: false,
    };
});

describe('import notification rows', () => {
    it.each([
        ['review', 3, '3 spots ready to review', 'Review spots'],
        ['saved', 1, '1 spot pinned', 'View spots'],
        ['failed', 0, 'an import needs attention', 'View import'],
    ] as const)('renders source-neutral %s copy and an actionable row', (outcome, count, title, action) => {
        const onPress = jest.fn();
        const screen = render(
            <NotificationRow notification={importNotice({ outcome, count })} onPress={onPress} />,
        );
        expect(screen.getByText(title)).toBeTruthy();
        expect(screen.queryByText(/tiktok/i)).toBeNull();
        fireEvent.press(screen.getByText(action));
        expect(onPress).toHaveBeenCalledTimes(1);
    });

    it.each(['review', 'saved', 'failed'] as const)('routes %s through the import hub with the matching batch', (outcome) => {
        handleTap(importNotice({ outcome, jobId: 'batch/one & two' }), mockRouter as unknown as ReturnType<typeof useRouter>);
        expect(mockPush).toHaveBeenCalledWith(`/import-progress?openJob=batch%2Fone%20%26%20two&outcome=${outcome}`);
    });

    it('opens the hub when an older notification has no batch id', () => {
        handleTap(importNotice({ jobId: undefined }), mockRouter as unknown as ReturnType<typeof useRouter>);
        expect(mockPush).toHaveBeenCalledWith('/import-progress');
    });

    it('pressing a rendered inbox action marks that row read and navigates to its batch', () => {
        mockInbox.data = { pages: [{ rows: [importNotice()] }] };
        const screen = render(<NotificationsScreen />);
        fireEvent.press(screen.getByText('Review spots'));
        expect(mockMarkRead).toHaveBeenCalledWith('notification-import');
        expect(mockPush).toHaveBeenCalledWith('/import-progress?openJob=gallery-job-3&outcome=review');
    });

    it('an already-read import still navigates without repeating the mark-read mutation', () => {
        mockInbox.data = { pages: [{ rows: [importNotice({ read: true })] }] };
        const screen = render(<NotificationsScreen />);
        fireEvent.press(screen.getByText('Review spots'));
        expect(mockMarkRead).not.toHaveBeenCalled();
        expect(mockPush).toHaveBeenCalledTimes(1);
    });
});

describe('notification inbox states', () => {
    it('distinguishes a settled empty inbox from an initial error and retries the failed read', () => {
        const screen = render(<NotificationsScreen />);
        expect(screen.getByText('Nothing new yet')).toBeTruthy();
        expect(screen.queryByText("Couldn't load notifications")).toBeNull();
        mockInbox = { ...mockInbox, data: undefined, isError: true };
        screen.rerender(<NotificationsScreen />);
        expect(screen.queryByText('Nothing new yet')).toBeNull();
        expect(screen.getByText("Couldn't load notifications")).toBeTruthy();
        mockRefetch.mockClear();
        fireEvent.press(screen.getByText('Try again'));
        expect(mockRefetch).toHaveBeenCalledTimes(1);
    });

    it('does not flash the empty state while loading or while another visible page may exist', () => {
        mockInbox = { ...mockInbox, data: undefined, isLoading: true };
        const screen = render(<NotificationsScreen />);
        expect(screen.queryByText('Nothing new yet')).toBeNull();
        expect(mockFetchNextPage).not.toHaveBeenCalled();
        mockInbox = { ...mockInbox, isLoading: false, hasNextPage: true };
        screen.rerender(<NotificationsScreen />);
        expect(screen.queryByText('Nothing new yet')).toBeNull();
        expect(mockFetchNextPage).toHaveBeenCalledTimes(1);
    });

    it.each([
        { hasNextPage: false, isFetchNextPageError: false },
        { hasNextPage: true, isFetchNextPageError: false },
        { hasNextPage: true, isFetchNextPageError: true },
    ])('retains cached rows and retries the failed request (hasNextPage=$hasNextPage, pageError=$isFetchNextPageError)', ({ hasNextPage, isFetchNextPageError }) => {
        mockInbox = { ...mockInbox, data: { pages: [{ rows: [importNotice()] }] }, hasNextPage };
        const screen = render(<NotificationsScreen />);
        mockInbox = { ...mockInbox, isError: true, isFetchNextPageError };
        screen.rerender(<NotificationsScreen />);
        expect(screen.getByText('3 spots ready to review')).toBeTruthy();
        expect(screen.queryByText("Couldn't load notifications")).toBeNull();
        expect(screen.queryByText('Nothing new yet')).toBeNull();
        mockRefetch.mockClear();
        mockFetchNextPage.mockClear();
        fireEvent.press(screen.getByText("Couldn't refresh · Try again"));
        expect(isFetchNextPageError ? mockFetchNextPage : mockRefetch).toHaveBeenCalledTimes(1);
        expect(isFetchNextPageError ? mockRefetch : mockFetchNextPage).not.toHaveBeenCalled();
    });

    it.each(['all', 'single'] as const)('disables mark all read while the %s mark-read mutation is pending', (pending) => {
        mockUnreadCount = 3;
        mockMarkAllPending = pending === 'all';
        mockMarkReadPending = pending === 'single';
        const screen = render(<NotificationsScreen />);
        expect(screen.getByText('Mark read')).toBeDisabled();
        fireEvent.press(screen.getByText('Mark read'));
        expect(mockMarkAllRead).not.toHaveBeenCalled();
        expect(mockRefetch).not.toHaveBeenCalled();

        mockMarkAllPending = false;
        mockMarkReadPending = false;
        screen.rerender(<NotificationsScreen />);
        expect(screen.getByText('Mark read')).not.toBeDisabled();
        fireEvent.press(screen.getByText('Mark read'));
        expect(mockMarkAllRead).toHaveBeenCalledTimes(1);
    });
});
