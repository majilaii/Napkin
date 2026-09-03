/* eslint-disable import/first -- Jest mocks must be registered before module imports. */
jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
        Platform: {
            OS: 'ios',
            select: (options: Record<string, unknown>) => options.ios ?? options.default,
        },
        Pressable: host('Pressable'),
        StyleSheet: {
            create: (styles: unknown) => styles,
            flatten: (style: unknown): Record<string, unknown> =>
                (Array.isArray(style) ? style : [style])
                    .flat(Infinity)
                    .filter(Boolean)
                    .reduce<Record<string, unknown>>(
                        (acc, item) => ({ ...acc, ...(item as Record<string, unknown>) }),
                        {},
                    ),
        },
        Text: host('Text'),
        View: host('View'),
    };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/constants/theme';
import { LedgerLine } from '../LedgerLine';
import { formatLedgerLine, type LedgerLineInput } from '../ledgerLineFormatter';

function copy(input: LedgerLineInput): string | null {
    return formatLedgerLine(input)?.copy ?? null;
}

describe('formatLedgerLine', () => {
    it.each([
        [null, { youRating: null, visitCount: 0, friendsRating: null, friendsCount: 0 }],
        ['you 4.5 · 3 visits', { youRating: 4.5, visitCount: 3, friendsRating: null, friendsCount: 0 }],
        ['you · 1 visit', { youRating: null, visitCount: 1, friendsRating: null, friendsCount: 0 }],
        [
            'you 4.5 · 3 visits · friends 4.2 · 2 been',
            { youRating: 4.5, visitCount: 3, friendsRating: 4.2, friendsCount: 2 },
        ],
        [
            'friends 4.2 · 2 been',
            { youRating: null, visitCount: 0, friendsRating: 4.2, friendsCount: 2 },
        ],
    ])('formats %s', (expected, input) => {
        expect(copy(input as LedgerLineInput)).toBe(expected);
    });

    it('does not invent an unrated-friend visit state the payload cannot represent', () => {
        expect(copy({
            youRating: null,
            visitCount: 0,
            friendsRating: null,
            friendsCount: 1,
        })).toBeNull();
    });
});

describe('LedgerLine', () => {
    it('renders nothing without signals and opens history only for a self visit', () => {
        const empty = render(<LedgerLine line={null} palette={Colors.light} />);
        expect(empty.toJSON()).toBeNull();
        empty.unmount();

        const friendsOnly = formatLedgerLine({
            youRating: null,
            visitCount: 0,
            friendsRating: 4.2,
            friendsCount: 2,
        });
        const inert = render(
            <LedgerLine line={friendsOnly} onPress={jest.fn()} palette={Colors.light} />,
        );
        expect(inert.queryByRole('button')).toBeNull();
        expect(inert.UNSAFE_queryByType(Ionicons)).toBeNull();
        inert.unmount();

        const onPress = jest.fn();
        const self = formatLedgerLine({
            youRating: 4.5,
            visitCount: 1,
            friendsRating: null,
            friendsCount: 0,
        });
        const tappable = render(
            <LedgerLine line={self} onPress={onPress} palette={Colors.light} />,
        );
        fireEvent.press(tappable.getByLabelText('you 4.5 · 1 visit'));
        expect(onPress).toHaveBeenCalledTimes(1);
        expect(tappable.UNSAFE_getByType(Ionicons).props.name).toBe('chevron-forward');
    });
});
