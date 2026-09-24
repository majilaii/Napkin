/* eslint-disable import/first -- Jest mocks must be registered before module imports. */
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockUseGuestList = jest.fn();
const mockOpenURL = jest.fn((_url: string) => Promise.resolve());
const mockAlert = jest.fn();
const mockSetString = jest.fn((_text: string) => Promise.resolve(true));

jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    const FlatList = (props: {
        data: unknown[];
        renderItem: (info: { item: unknown; index: number }) => unknown;
        ListHeaderComponent?: unknown;
        ListEmptyComponent?: unknown;
        ListFooterComponent?: unknown;
    }) => ReactModule.createElement(
        'FlatList',
        null,
        props.ListHeaderComponent,
        props.data.length > 0
            ? props.data.map((item, index) => ReactModule.createElement(
                ReactModule.Fragment,
                { key: String(index) },
                props.renderItem({ item, index }),
            ))
            : props.ListEmptyComponent,
        props.ListFooterComponent,
    );
    return {
        ActivityIndicator: host('ActivityIndicator'),
        Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
        FlatList,
        Linking: { openURL: (url: string) => mockOpenURL(url) },
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
        Pressable: host('Pressable'),
        StyleSheet: {
            absoluteFill: { position: 'absolute', inset: 0 },
            absoluteFillObject: { position: 'absolute', inset: 0 },
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => Array.isArray(style)
                ? Object.assign({}, ...style.filter(Boolean))
                : (style ?? {}),
            hairlineWidth: 1,
        },
        Text: host('Text'),
        View: host('View'),
    };
});
jest.mock('expo-router', () => ({
    Stack: { Screen: () => null },
    useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace, canGoBack: () => true }),
}));
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('expo-clipboard', () => ({ setStringAsync: (text: string) => mockSetString(text) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/components/ui/napkin/PressableScale', () => {
    const ReactModule = jest.requireActual('react');
    return {
        PressableScale: (props: Record<string, unknown>) =>
            ReactModule.createElement('Pressable', props, props.children),
    };
});
jest.mock('@/hooks/guest/usePublicBrowse', () => ({
    useGuestList: (id: string) => mockUseGuestList(id),
}));

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import type { ListDetailData, ListEntry } from '@/hooks/lists/useList';
import { GuestListScreen } from '../GuestListScreen';

function entry(id: string, name: string, note: string | null, position: number): ListEntry {
    return {
        id: `entry-${id}`,
        list_id: 'list-1',
        restaurant_id: id,
        note,
        position,
        created_at: '2026-09-01T00:00:00Z',
        restaurant: {
            id,
            name,
            address: null,
            city: 'London',
            country: 'UK',
            photo_url: null,
            photo_source: null,
            places_photo_attribution_html: null,
            cuisine: 'Italian',
            google_rating: 4.5,
            price_level: 2,
            external_id: null,
        },
    };
}

function detail(entries: ListEntry[], ranked = true): ListDetailData {
    return {
        list: {
            id: 'list-1',
            owner_id: 'owner-1',
            title: 'Pasta in London',
            description: 'Where I send people first.',
            ranked,
            privacy: 'public',
            emoji: null,
            table_id: null,
            created_at: '2026-09-01T00:00:00Z',
            updated_at: '2026-09-10T00:00:00Z',
        },
        entries,
        owner_profile: {
            display_name: 'Clara',
            avatar_url: null,
            username: 'clara',
            account_privacy: 'public',
        },
        save_count: 2,
        viewer_has_saved: false,
        can_save: false,
    };
}

function ok(data: ListDetailData) {
    return { data: { data, isNotFound: false }, isLoading: false, isError: false, refetch: jest.fn() };
}

describe('GuestListScreen', () => {
    beforeEach(() => jest.clearAllMocks());

    it('renders a ranked public list read-only; rows open the restaurant and save asks to sign in', () => {
        mockUseGuestList.mockReturnValue(ok(detail([
            entry('r1', 'Padella', 'order the pici', 0),
            entry('r2', 'Bancone', null, 1),
        ])));

        const screen = render(<GuestListScreen listId="list-1" />);
        expect(mockUseGuestList).toHaveBeenCalledWith('list-1');
        expect(screen.getByText('Pasta in London')).toBeTruthy();
        expect(screen.getByText('Where I send people first.')).toBeTruthy();
        expect(screen.getByText('1')).toBeTruthy();
        expect(screen.getByText('2')).toBeTruthy();
        expect(screen.getByText('— order the pici')).toBeTruthy();

        fireEvent.press(screen.getByText('Bancone'));
        expect(mockPush).toHaveBeenCalledWith({ pathname: '/restaurant/[id]', params: { id: 'r2' } });

        fireEvent.press(screen.getByLabelText('Save list'));
        expect(mockPush).toHaveBeenLastCalledWith('/auth');

        // The byline is plain text for a guest: profiles are not guest-readable.
        fireEvent.press(screen.getByText(/Clara/));
        expect(mockPush).not.toHaveBeenCalledWith('/u/clara');
        expect(screen.getByTestId('guest-sign-in-band')).toBeTruthy();
    });

    it('shows no rank numbers on an unranked list and says so when it is empty', () => {
        mockUseGuestList.mockReturnValue(ok(detail([], false)));
        const screen = render(<GuestListScreen listId="list-1" />);
        expect(screen.queryByText('1')).toBeNull();
        expect(screen.getByText('no spots here yet.')).toBeTruthy();
    });

    it('lets a guest report the list: mail names it, and no mail app falls back to copy details', async () => {
        mockUseGuestList.mockReturnValue(ok(detail([entry('r1', 'Padella', 'order the pici', 0)])));
        const screen = render(<GuestListScreen listId="list-1" />);

        fireEvent.press(screen.getByLabelText('report this list'));
        const url = decodeURIComponent(mockOpenURL.mock.calls[0][0]);
        expect(url.startsWith('mailto:')).toBe(true);
        expect(url).toContain('Report a list on Napkin');
        expect(url).toContain('List: Pasta in London (list-1) by Clara');

        mockOpenURL.mockRejectedValueOnce(new Error('No app to handle mailto'));
        fireEvent.press(screen.getByLabelText('report this list'));
        await new Promise((resolve) => setImmediate(resolve));
        const [title, message, buttons] = mockAlert.mock.calls[0] as [
            string,
            string,
            { text: string; onPress?: () => void }[],
        ];
        expect(title).toBe('Report list');
        expect(message).toContain('List: Pasta in London (list-1) by Clara');
        buttons[0].onPress?.();
        expect(mockSetString.mock.calls[0][0]).toContain('List: Pasta in London (list-1) by Clara');
    });

    it('keeps the report line on an empty list (its title and description are still content)', () => {
        mockUseGuestList.mockReturnValue(ok(detail([], false)));
        const screen = render(<GuestListScreen listId="list-1" />);
        expect(screen.getByLabelText('report this list')).toBeTruthy();
    });

    it('treats a private, Table or missing list as not found, with no retry', () => {
        mockUseGuestList.mockReturnValue({
            data: { data: null, isNotFound: true }, isLoading: false, isError: false, refetch: jest.fn(),
        });
        const screen = render(<GuestListScreen listId="list-private" />);
        expect(screen.getByText('Not found')).toBeTruthy();
        expect(screen.getByText('This list is private or no longer exists.')).toBeTruthy();
        expect(screen.queryByText('Try again')).toBeNull();
    });

    it('offers a retry when the read fails', () => {
        const refetch = jest.fn();
        mockUseGuestList.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
        const screen = render(<GuestListScreen listId="list-1" />);
        expect(screen.getByText('Couldn’t open this list')).toBeTruthy();
        fireEvent.press(screen.getByText('Try again'));
        expect(refetch).toHaveBeenCalledTimes(1);
    });
});
