/* eslint-disable import/first -- Jest mocks must be registered before module imports. */
jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
        Linking: { openURL: jest.fn(() => Promise.resolve()) },
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
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { Colors } from '@/constants/theme';
import type {
    PublicReviewCard,
    RestaurantPageRestaurant,
} from '@/hooks/restaurants/useRestaurantPage';
import type { FriendsCohortMember, TableNotesGroup } from '@/lib/restaurantPageV3';
import {
    FriendsNotesSection,
    RestaurantActions,
    RestaurantDetails,
    TableNotesSection,
} from './RestaurantPageV3';

const review: PublicReviewCard = {
    entry_id: 'friend-entry',
    user_id: 'friend',
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
    is_followee: true,
};

describe('RestaurantPageV3 note rings', () => {
    it('keeps the Friends cards in the followee ring while the doorway uses the public total', () => {
        const onSeeAll = jest.fn();
        const cohort: FriendsCohortMember[] = [{
            user_id: review.user_id,
            rating: review.rating,
            review,
        }];
        const screen = render(
            <FriendsNotesSection
                cohort={cohort}
                total={4}
                onSeeAll={onSeeAll}
                onReviewPress={jest.fn()}
                palette={Colors.light}
            />,
        );

        expect(screen.getByText('FROM FRIENDS')).toBeTruthy();
        expect(screen.getByText('— order the whole turbot')).toBeTruthy();
        fireEvent.press(screen.getByLabelText('all 4 reviews'));
        expect(onSeeAll).toHaveBeenCalledTimes(1);
    });

    it('collapses reviews without followee cards to one doorway row', () => {
        const onSeeAll = jest.fn();
        const screen = render(
            <FriendsNotesSection
                cohort={[]}
                total={4}
                onSeeAll={onSeeAll}
                onReviewPress={jest.fn()}
                palette={Colors.light}
            />,
        );

        expect(screen.getByText('REVIEWS')).toBeTruthy();
        expect(screen.queryByText('— order the whole turbot')).toBeNull();
        fireEvent.press(screen.getByLabelText('all 4 reviews'));
        expect(onSeeAll).toHaveBeenCalledTimes(1);
    });

    it('renders only the chosen Table group and routes its own count and id', () => {
        const onSeeAll = jest.fn();
        const group: TableNotesGroup = {
            table_id: 'table-a',
            table_name: 'Thursday table',
            rows: [
                {
                    entry_id: 'table-entry-1',
                    table_id: 'table-a',
                    table_name: 'Thursday table',
                    author: { user_id: 'member-a', display_name: 'Julian', avatar_url: null },
                    rating: 4.5,
                    note: 'we split the whole grill',
                    visited_at: '2026-06-01T12:00:00.000Z',
                },
                {
                    entry_id: 'table-entry-2',
                    table_id: 'table-a',
                    table_name: 'Thursday table',
                    author: { user_id: 'member-b', display_name: 'Clara', avatar_url: null },
                    rating: 4,
                    note: 'counter seats',
                    visited_at: '2026-05-01T12:00:00.000Z',
                },
                {
                    entry_id: 'table-entry-3',
                    table_id: 'table-a',
                    table_name: 'Thursday table',
                    author: { user_id: 'member-c', display_name: 'Maya', avatar_url: null },
                    rating: 3.5,
                    note: 'go early',
                    visited_at: '2026-04-01T12:00:00.000Z',
                },
            ],
            visibleRows: [],
        };
        group.visibleRows = group.rows.slice(0, 2);

        const screen = render(
            <TableNotesSection
                group={group}
                onSeeAll={onSeeAll}
                onNotePress={jest.fn()}
                palette={Colors.light}
            />,
        );

        expect(screen.getByText('FROM THURSDAY TABLE')).toBeTruthy();
        expect(screen.getByText('— we split the whole grill')).toBeTruthy();
        expect(screen.getByText('— counter seats')).toBeTruthy();
        expect(screen.queryByText('— go early')).toBeNull();
        fireEvent.press(screen.getByLabelText('all 3'));
        expect(onSeeAll).toHaveBeenCalledWith('table-a');
    });
});

describe('RestaurantPageV3 actions and hours', () => {
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const restaurant: RestaurantPageRestaurant = {
        id: 'restaurant',
        name: 'Kiln',
        address: null,
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
        hours: { weekdayDescriptions: [`${today}: 12:00 PM – 10:00 PM`] },
        places_synced_at: null,
        reserve_url: null,
        reserve_url_checked_at: null,
    };

    it('shows reserve only when a real booking action is supplied', () => {
        const base = {
            saved: false,
            onLog: jest.fn(),
            onPin: jest.fn(),
            onDirections: jest.fn(),
            palette: Colors.light,
        };
        const hidden = render(<RestaurantActions {...base} />);
        expect(hidden.queryByLabelText('reserve')).toBeNull();
        hidden.unmount();

        const onReserve = jest.fn();
        const visible = render(
            <RestaurantActions
                {...base}
                onWebsite={jest.fn()}
                onReserve={onReserve}
                onGather={jest.fn()}
            />,
        );
        expect(visible.getAllByTestId('restaurant-utility-row')).toHaveLength(2);
        fireEvent.press(visible.getByLabelText('reserve'));
        expect(onReserve).toHaveBeenCalledTimes(1);
    });

    it('does not claim open-now without the signal and retains the weekday line', () => {
        const noSignal = render(
            <RestaurantDetails
                restaurant={restaurant}
                directionsUrl="https://maps.test"
                openNow={null}
                palette={Colors.light}
            />,
        );
        expect(noSignal.queryByText(/open · until/)).toBeNull();
        expect(noSignal.getByText(/12:00 pm – 10:00 pm/i)).toBeTruthy();
        noSignal.unmount();

        const open = render(
            <RestaurantDetails
                restaurant={restaurant}
                directionsUrl="https://maps.test"
                openNow
                palette={Colors.light}
            />,
        );
        expect(open.getByText(/open · until/)).toBeTruthy();
    });
});
