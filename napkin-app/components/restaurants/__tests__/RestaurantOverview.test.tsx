/* eslint-disable import/first -- Native hosts are replaced before imports. */
jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
        Linking: { openURL: jest.fn(() => Promise.resolve()) },
        Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios ?? values.default },
        StyleSheet: {
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => Array.isArray(style)
                ? Object.assign({}, ...style.flat(Infinity).filter(Boolean))
                : (style ?? {}),
        },
        Pressable: (props: Record<string, unknown>) => ReactModule.createElement('Pressable', { accessible: true, ...props }, props.children),
        Text: host('Text'), View: host('View'),
    };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { Colors } from '@/constants/theme';
import { RestaurantOverview } from '../RestaurantOverview';

const base = { palette: Colors.light };

beforeEach(() => { jest.clearAllMocks(); });

describe('RestaurantOverview native ratings', () => {
    it('keeps the server rating aggregate separate from written review count', () => {
        const onReviews = jest.fn();
        const screen = render(<RestaurantOverview {...base} average={4.25} ratingCount={18}
            reviewCount={3} onReviews={onReviews} />);
        expect(screen.getByText('4.3')).toBeTruthy();
        expect(screen.getByText(/18 Napkin ratings$/)).toBeTruthy();
        fireEvent.press(screen.getByRole('button', { name: /3 reviews/ }));
        expect(onReviews).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('Google')).toBeNull();
        expect(screen.queryByText('Friends')).toBeNull();
    });

    it('shows ratings even when there are no written reviews', () => {
        const screen = render(<RestaurantOverview {...base} average={4} ratingCount={2} reviewCount={0} onReviews={jest.fn()} />);
        expect(screen.getByText('4.0')).toBeTruthy();
        expect(screen.getByText(/2 Napkin ratings$/)).toBeTruthy();
        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.queryByText('No reviews yet')).toBeNull();
    });

    it('uses singular rating and review counts', () => {
        const screen = render(<RestaurantOverview {...base} average={5} ratingCount={1} reviewCount={1} onReviews={jest.fn()} />);
        expect(screen.getByText(/1 Napkin rating$/)).toBeTruthy();
        expect(screen.getByRole('button', { name: /1 review/ })).toBeTruthy();
    });

    it.each([null, 0, 0.1, -1, NaN, Infinity, 5.5])('never fabricates a rating from invalid or absent aggregate (%s)', (average) => {
        const screen = render(<RestaurantOverview {...base} average={average} ratingCount={2}
            reviewCount={3} onReviews={jest.fn()} />);
        expect(screen.queryByText(/Napkin ratings/)).toBeNull();
        expect(screen.queryByText('0.0')).toBeNull();
        expect(screen.getByRole('button', { name: /3 reviews/ })).toBeTruthy();
    });

    it.each([0, -1, 1.5, NaN, Infinity])('never shows an average without a valid rating count (%s)', (ratingCount) => {
        const screen = render(<RestaurantOverview {...base} average={4.5} ratingCount={ratingCount} />);
        expect(screen.queryByText('4.5')).toBeNull();
        expect(screen.getByText('No reviews yet')).toBeTruthy();
    });

    it('keeps written reviews usable when the aggregate is missing', () => {
        const onReviews = jest.fn();
        const screen = render(<RestaurantOverview {...base} reviewCount={8} onReviews={onReviews} />);
        fireEvent.press(screen.getByRole('button', { name: /8 reviews/ }));
        expect(onReviews).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(/Napkin ratings/)).toBeNull();
        expect(screen.queryByText('No reviews yet')).toBeNull();
    });

    it('does not expose a dead reviews button without a destination', () => {
        const screen = render(<RestaurantOverview {...base} reviewCount={3} />);
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('distinguishes empty, loading and unavailable review data', () => {
        const screen = render(<RestaurantOverview {...base} />);
        expect(screen.getByText('No reviews yet')).toBeTruthy();
        screen.rerender(<RestaurantOverview {...base} loading />);
        expect(screen.getByText('Loading reviews…')).toBeTruthy();
        expect(screen.queryByText('No reviews yet')).toBeNull();
        screen.rerender(<RestaurantOverview {...base} unavailable />);
        expect(screen.getByText('Reviews unavailable')).toBeTruthy();
        expect(screen.queryByText('No reviews yet')).toBeNull();
    });
});
