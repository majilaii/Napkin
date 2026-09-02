/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

import { Colors, Radius, Spacing } from '@/constants/theme';
import type { SelfLogRow } from '@/hooks/restaurants/useRestaurantPage';
import {
    RestaurantHistoryMasthead,
    RestaurantHistoryRow,
} from '../RestaurantHistoryRows';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => {
    const ReactModule = require('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios },
        Pressable: host('Pressable'),
        Text: host('Text'),
        View: host('View'),
        StyleSheet: {
            absoluteFillObject: { position: 'absolute', inset: 0 },
            hairlineWidth: 0.5,
            create: (styles: unknown) => styles,
        },
    };
});
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));

function row(overrides: Partial<SelfLogRow> = {}): SelfLogRow {
    return {
        id: 'row-1',
        entry_id: 'entry-1',
        table_night_id: null,
        source: 'solo',
        rating: 4.5,
        note: 'the whole note stays visible',
        visited_at: '2026-09-02T12:00:00.000Z',
        companions: [],
        photos: [],
        ...overrides,
    };
}

function photoRows(count: number) {
    return Array.from({ length: count }, (_, index) => ({
        id: `photo-${index}`,
        url: `https://photos.test/${index}.jpg`,
    }));
}

function renderRow(value: SelfLogRow, showDivider = false) {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(
            <RestaurantHistoryRow
                row={value}
                tintSeed="restaurant-1"
                showDivider={showDivider}
                onPress={jest.fn()}
                palette={Colors.light}
            />,
        );
    });
    return renderer;
}

function flattenStyle(style: unknown): Record<string, unknown> {
    const values = Array.isArray(style) ? style.flat(Infinity) : [style];
    return values.reduce<Record<string, unknown>>(
        (merged, value) => (value && typeof value === 'object' ? { ...merged, ...value } : merged),
        {},
    );
}

function hostByTestId(renderer: any, testID: string) {
    return renderer.root
        .findAllByProps({ testID })
        .find((node: any) => typeof node.type === 'string');
}

function renderedText(renderer: any): unknown[] {
    return renderer.root.findAllByType('Text').map((node: any) => node.props.children);
}

describe('restaurant history rows', () => {
    it('renders the left-aligned two-line masthead', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(
                <RestaurantHistoryMasthead
                    average={4.2}
                    count={3}
                    first="26 aug 2026"
                    last="2 sep 2026"
                    palette={Colors.light}
                />,
            );
        });

        const masthead = hostByTestId(renderer, 'restaurant-history-masthead');
        expect(flattenStyle(masthead.props.style)).toMatchObject({
            alignItems: 'flex-end',
            paddingTop: Spacing.lg,
            paddingBottom: Spacing.md,
        });
        expect(renderedText(renderer)).toEqual(expect.arrayContaining([
            '4.2',
            '3 visits',
            'first 26 aug 2026 · last 2 sep 2026',
        ]));
        act(() => renderer.unmount());
    });

    it('renders rated prose as a borderless row with a three-up strip and +N scrim', () => {
        const renderer = renderRow(row({ photos: photoRows(4) }), true);
        const rowNode = hostByTestId(renderer, 'restaurant-history-row');
        const rowStyle = flattenStyle(rowNode.props.style);
        const tiles = renderer.root
            .findAllByProps({ testID: 'restaurant-history-photo-tile' })
            .filter((node: any) => typeof node.type === 'string');

        expect(rowStyle).toMatchObject({
            paddingHorizontal: Spacing.restaurant.pageGutter,
            paddingVertical: Spacing.restaurant.historyRowVertical,
        });
        expect(rowStyle.backgroundColor).toBeUndefined();
        expect(rowStyle.shadowColor).toBeUndefined();
        expect(renderedText(renderer)).toEqual(expect.arrayContaining([
            '2 SEP 2026',
            '4.5',
            '— the whole note stays visible',
            '+1',
        ]));
        const note = renderer.root
            .findAllByType('Text')
            .find((node: any) => node.props.children === '— the whole note stays visible');
        expect(note?.props.numberOfLines).toBeUndefined();
        expect(tiles).toHaveLength(3);
        expect(renderer.root
            .findAllByProps({ testID: 'restaurant-history-divider' })
            .filter((node: any) => typeof node.type === 'string')).toHaveLength(1);
        act(() => renderer.unmount());
    });

    it('renders an unrated no-note row without fabricating prose', () => {
        const renderer = renderRow(row({ rating: null, note: null }));
        expect(renderedText(renderer)).toContain('—');
        expect(renderedText(renderer)).not.toContain('— the whole note stays visible');
        expect(renderer.root.findAllByProps({ testID: 'restaurant-history-photo-strip' })).toHaveLength(0);
        act(() => renderer.unmount());
    });

    it('renders one photo as a 96-point square', () => {
        const renderer = renderRow(row({ photos: photoRows(1) }));
        const tile = renderer.root
            .findAllByProps({ testID: 'restaurant-history-photo-tile' })
            .find((node: any) => typeof node.type === 'string');

        expect(flattenStyle(tile?.props.style)).toMatchObject({
            width: Spacing.restaurant.memoryPhotoSize,
            height: Spacing.restaurant.memoryPhotoSize,
            borderRadius: Radius.memory,
        });
        act(() => renderer.unmount());
    });

    it('marks a supper and renders companions on their own line', () => {
        const renderer = renderRow(row({
            table_night_id: 'supper-1',
            companions: ['Clara', 'Thomas'],
        }));

        expect(renderedText(renderer)).toEqual(expect.arrayContaining([
            'supper',
            'with Clara & Thomas',
        ]));
        act(() => renderer.unmount());
    });
});
