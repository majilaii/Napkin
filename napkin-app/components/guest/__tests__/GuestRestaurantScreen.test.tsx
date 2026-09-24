/* eslint-disable import/first -- Jest mocks must be registered before module imports. */
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn(() => true);
const mockOpenURL = jest.fn((_url: string) => Promise.resolve());
const mockPage = jest.fn();
const mockReviews = jest.fn();
const mockAlert = jest.fn();
const mockSetString = jest.fn((_text: string) => Promise.resolve(true));

jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
        ActivityIndicator: host('ActivityIndicator'),
        Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
        Linking: { openURL: (url: string) => mockOpenURL(url) },
        Platform: {
            OS: 'ios',
            select: (options: Record<string, unknown>) => options.ios ?? options.default,
        },
        Pressable: host('Pressable'),
        ScrollView: host('ScrollView'),
        StyleSheet: {
            absoluteFill: { position: 'absolute', inset: 0 },
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => Array.isArray(style)
                ? Object.assign({}, ...style.filter(Boolean))
                : (style ?? {}),
            hairlineWidth: 1,
        },
        Text: host('Text'),
        useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
        View: host('View'),
    };
});
jest.mock('expo-router', () => ({
    Stack: { Screen: () => null },
    useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace, canGoBack: mockCanGoBack }),
}));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('expo-clipboard', () => ({ setStringAsync: (text: string) => mockSetString(text) }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), selectionAsync: jest.fn(), ImpactFeedbackStyle: {} }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('react-native-maps', () => ({ __esModule: true, default: 'MapView', Marker: 'Marker', UrlTile: 'UrlTile' }));
jest.mock('@/components/photos/PhotoLightbox', () => ({ PhotoLightbox: () => null }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/hooks/guest/usePublicBrowse', () => ({
    flattenPages: (data: { pages: { rows: unknown[] }[] } | undefined) =>
        data?.pages.flatMap((p) => p.rows) ?? [],
    useGuestRestaurantPage: (id: string) => mockPage(id),
    useGuestReviews: (id: string | null) => mockReviews(id),
}));

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import type {
    PublicReviewCard,
    RestaurantPageRestaurant,
} from '@/hooks/restaurants/useRestaurantPage';
import { GuestRestaurantScreen } from '../GuestRestaurantScreen';
import { sendReport } from '../guestReport';
import { LEGAL_URLS, SUPPORT_EMAIL } from '@/constants/links';

const restaurant: RestaurantPageRestaurant = {
    id: 'restaurant-1',
    name: 'Kiln',
    address: '58 Brewer St',
    city: 'London',
    country: 'UK',
    cuisine: 'Thai',
    price_level: 2,
    photo_url: null,
    google_rating: 4.5,
    google_rating_count: 10,
    external_id: 'place',
    photo_source: null,
    places_photo_attribution_html: null,
    phone: null,
    website: null,
    google_maps_uri: null,
    hours: null,
    places_synced_at: null,
    reserve_url: null,
    reserve_url_checked_at: null,
};

const review: PublicReviewCard = {
    entry_id: 'entry-1',
    user_id: 'clara',
    display_name: 'Clara',
    username: 'clara',
    avatar_url: null,
    rating: 4.5,
    note_excerpt: 'order the whole turbot',
    photo_url: null,
    created_at: '2026-05-01T12:00:00.000Z',
    public_reaction_count: 0,
    public_reply_count: 0,
    calibration: null,
    is_followee: false,
};

function pageResult(
    reviews: PublicReviewCard[],
    featuredLists?: { rows: { id: string; title: string; emoji: string | null; entry_count: number; owner_display_name: string | null; owner_username: string | null }[]; total: number },
) {
    return {
        data: { restaurant, reviews, reviews_total: reviews.length, featured_lists: featuredLists },
        isLoading: false,
        isError: false,
        fetchStatus: 'idle',
        refetch: jest.fn(),
    };
}

function pagedResult(rows: PublicReviewCard[], hasNextPage = false) {
    return {
        data: rows.length > 0 ? { pages: [{ rows, next_cursor: null, has_more: hasNextPage }] } : undefined,
        hasNextPage,
        isFetchingNextPage: false,
        fetchNextPage: jest.fn(),
    };
}

describe('GuestRestaurantScreen', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockCanGoBack.mockReturnValue(true);
    });

    it('backs out to guest Places when a cold deep link left nothing below', () => {
        mockCanGoBack.mockReturnValue(false);
        mockPage.mockReturnValue({
            data: undefined,
            isLoading: false,
            isError: true,
            fetchStatus: 'idle',
            refetch: jest.fn(),
        });
        mockReviews.mockReturnValue(pagedResult([]));
        const screen = render(<GuestRestaurantScreen restaurantId="restaurant-1" />);
        fireEvent.press(screen.getByLabelText('back'));
        expect(mockBack).not.toHaveBeenCalled();
        expect(mockReplace).toHaveBeenCalledWith('/(tabs)/places');
    });

    it('renders the sign-in band and routes the pin affordance to /auth', () => {
        mockPage.mockReturnValue(pageResult([]));
        mockReviews.mockReturnValue(pagedResult([]));

        const screen = render(<GuestRestaurantScreen restaurantId="restaurant-1" />);

        expect(screen.getByTestId('guest-sign-in-band')).toBeTruthy();
        fireEvent.press(screen.getByLabelText('save restaurant'));
        expect(mockPush).toHaveBeenCalledWith('/auth');
    });

    it('renders public reviews only when there are some, with a report line', () => {
        mockPage.mockReturnValue(pageResult([review]));
        mockReviews.mockReturnValue(pagedResult([review]));

        const withReviews = render(<GuestRestaurantScreen restaurantId="restaurant-1" />);
        expect(withReviews.getByTestId('guest-reviews')).toBeTruthy();
        expect(withReviews.getByText(/order the whole turbot/)).toBeTruthy();
        expect(mockReviews).toHaveBeenCalledWith('restaurant-1');

        // The page-level line names the restaurant and asks which review;
        // it never guesses a review id.
        fireEvent.press(withReviews.getByLabelText('report a review'));
        expect(mockOpenURL).toHaveBeenCalledTimes(1);
        const url = mockOpenURL.mock.calls[0][0];
        expect(url.startsWith('mailto:')).toBe(true);
        expect(decodeURIComponent(url)).toContain('Restaurant: Kiln (restaurant-1)');
        expect(decodeURIComponent(url)).toContain('Which review:');
        expect(decodeURIComponent(url)).not.toContain('entry-1');
        withReviews.unmount();

        mockPage.mockReturnValue(pageResult([]));
        mockReviews.mockReturnValue(pagedResult([]));
        const without = render(<GuestRestaurantScreen restaurantId="restaurant-1" />);
        expect(without.queryByTestId('guest-reviews')).toBeNull();
        expect(mockReviews).toHaveBeenLastCalledWith(null);
    });

    it('reports the exact review a guest taps, or routes them to sign in', () => {
        mockPage.mockReturnValue(pageResult([review]));
        mockReviews.mockReturnValue(pagedResult([review]));

        const screen = render(<GuestRestaurantScreen restaurantId="restaurant-1" />);
        fireEvent.press(screen.getByText(/order the whole turbot/));
        expect(mockAlert).toHaveBeenCalledTimes(1);
        const [title, , buttons] = mockAlert.mock.calls[0] as [
            string,
            undefined,
            { text: string; onPress?: () => void; style?: string }[],
        ];
        expect(title).toBe('Clara');
        expect(buttons.map((b) => b.text)).toEqual(['Report review', 'Sign in', 'Cancel']);

        buttons[0].onPress?.();
        const url = decodeURIComponent(mockOpenURL.mock.calls[0][0]);
        expect(url).toContain('Review: entry-1 by Clara');
        expect(url).toContain('Restaurant: Kiln (restaurant-1)');

        buttons[1].onPress?.();
        expect(mockPush).toHaveBeenCalledWith('/auth');
    });

    it('never dead-ends a report when no mail app can open it', async () => {
        mockOpenURL.mockRejectedValueOnce(new Error('No app to handle mailto'));
        sendReport({
            kind: 'review',
            restaurant: { id: 'restaurant-1', name: 'Kiln' },
            review: { entry_id: 'entry-1', display_name: 'Clara' },
        });
        await new Promise((resolve) => setImmediate(resolve));

        expect(mockAlert).toHaveBeenCalledTimes(1);
        const [title, message, buttons] = mockAlert.mock.calls[0] as [
            string,
            string,
            { text: string; onPress?: () => void }[],
        ];
        expect(title).toBe('Report review');
        expect(message).toContain(SUPPORT_EMAIL);
        expect(message).toContain('Review: entry-1 by Clara');
        expect(buttons.map((b) => b.text)).toEqual(['Copy details', 'Support page', 'Close']);

        buttons[0].onPress?.();
        expect(mockSetString).toHaveBeenCalledWith(
            `To: ${SUPPORT_EMAIL}\nRestaurant: Kiln (restaurant-1)\nReview: entry-1 by Clara`,
        );
        buttons[1].onPress?.();
        expect(mockOpenURL).toHaveBeenLastCalledWith(LEGAL_URLS.support);
    });

    it('shows no fallback when the mail opens', async () => {
        sendReport({ kind: 'review', restaurant: { id: 'restaurant-1', name: 'Kiln' } });
        await new Promise((resolve) => setImmediate(resolve));
        expect(mockOpenURL).toHaveBeenCalledTimes(1);
        expect(mockAlert).not.toHaveBeenCalled();
    });

    it('shows public lists that include the place and opens one read-only', () => {
        mockPage.mockReturnValue(pageResult([], {
            rows: [{
                id: 'list-1',
                title: 'Pasta in London',
                emoji: null,
                entry_count: 4,
                owner_display_name: 'Clara',
                owner_username: 'clara',
            }],
            total: 1,
        }));
        mockReviews.mockReturnValue(pagedResult([]));

        const screen = render(<GuestRestaurantScreen restaurantId="restaurant-1" />);
        expect(screen.getByText('In lists')).toBeTruthy();
        fireEvent.press(screen.getByText('Pasta in London'));
        expect(mockPush).toHaveBeenCalledWith({ pathname: '/list/[id]', params: { id: 'list-1' } });
    });

    it('renders no lists band when the page has none (or predates the list read)', () => {
        mockPage.mockReturnValue(pageResult([]));
        mockReviews.mockReturnValue(pagedResult([]));
        const screen = render(<GuestRestaurantScreen restaurantId="restaurant-1" />);
        expect(screen.queryByText('In lists')).toBeNull();
        expect(screen.getByTestId('guest-sign-in-band')).toBeTruthy();
    });

    it('offers more while the paged query has a next page', () => {
        mockPage.mockReturnValue(pageResult([review]));
        const paged = pagedResult([review], true);
        mockReviews.mockReturnValue(paged);

        const screen = render(<GuestRestaurantScreen restaurantId="restaurant-1" />);
        fireEvent.press(screen.getByLabelText('more reviews'));
        expect(paged.fetchNextPage).toHaveBeenCalledTimes(1);
    });

    it('hands the restaurant to the details section', () => {
        mockPage.mockReturnValue(pageResult([]));
        mockReviews.mockReturnValue(pagedResult([]));

        const screen = render(<GuestRestaurantScreen restaurantId="restaurant-1" />);
        expect(screen.getByText('58 Brewer St')).toBeTruthy();
        expect(screen.getByLabelText('58 Brewer St, directions')).toBeTruthy();
        expect(screen.queryByLabelText('reserve a table')).toBeNull();
        expect(screen.queryByLabelText('gather the table')).toBeNull();
        expect(screen.queryByLabelText('log this meal')).toBeNull();
    });
});
