/* eslint-disable import/first -- Jest mocks must be registered before imports. */
const mockBack = jest.fn();
let mockLedgerState: Record<string, unknown>;
let mockCurrentMonth = '2026-09';
let mockFocusEffect: (() => void) | null = null;

jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    const FlatList = (props: {
        data?: Record<string, unknown>[];
        keyExtractor: (item: Record<string, unknown>, index: number) => string;
        renderItem: (info: { item: Record<string, unknown>; index: number }) => React.ReactNode;
    }) => ReactModule.createElement(
        'FlatList',
        props,
        (props.data ?? []).map((item, index) => ReactModule.createElement(
            ReactModule.Fragment,
            { key: props.keyExtractor(item, index) },
            props.renderItem({ item, index }),
        )),
    );
    return {
        ActivityIndicator: host('ActivityIndicator'),
        FlatList,
        Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios ?? values.default },
        Pressable: host('Pressable'),
        StyleSheet: {
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => Array.isArray(style)
                ? Object.assign({}, ...style.filter(Boolean))
                : (style ?? {}),
        },
        Text: host('Text'),
        View: host('View'),
    };
});
jest.mock('expo-router', () => ({
    useFocusEffect: (effect: () => void) => {
        mockFocusEffect = effect;
    },
    useRouter: () => ({ back: mockBack }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/components/feed/Avatar', () => ({ Avatar: 'Avatar' }));
jest.mock('@/hooks/users/useLedger', () => ({
    deviceTimeZone: () => 'UTC',
    ledgerMonthFor: () => mockCurrentMonth,
    useLedger: () => mockLedgerState,
}));

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import { LedgerScreen, ledgerMonthLabel, shiftLedgerMonth } from '../LedgerScreen';

const VIEWER_ROW = {
    user_id: 'viewer',
    display_name: 'Jacky',
    avatar_url: null,
    napkins: 8,
    meals: 5,
    new_places: 2,
    crowns: 1,
    is_viewer: true,
};

describe('LedgerScreen', () => {
    beforeEach(() => {
        mockBack.mockReset();
        mockCurrentMonth = '2026-09';
        mockFocusEffect = null;
        mockLedgerState = {
            data: { rows: [VIEWER_ROW], scope: { kind: 'friends' } },
            isLoading: false,
            isError: false,
        };
    });

    it('formats and moves calendar months without allowing a future step', () => {
        expect(ledgerMonthLabel('2026-09')).toBe('september 2026');
        expect(shiftLedgerMonth('2026-01', -1)).toBe('2025-12');

        const screen = render(<LedgerScreen viewerId="viewer" initialMonth="2026-09" />);
        const next = screen.getByLabelText('next month');
        expect(next.props.accessibilityState).toEqual({ disabled: true });
        fireEvent.press(next);
        expect(screen.getAllByText('september 2026')).toHaveLength(1);
        expect(screen.getByText('FRIENDS')).toBeTruthy();

        fireEvent.press(screen.getByLabelText('previous month'));
        expect(screen.getByText('august 2026')).toBeTruthy();
    });

    it('refreshes the future-month gate when the screen regains focus', () => {
        const screen = render(<LedgerScreen viewerId="viewer" initialMonth="2026-09" />);
        expect(screen.getByLabelText('next month').props.accessibilityState)
            .toEqual({ disabled: true });

        mockCurrentMonth = '2026-10';
        act(() => mockFocusEffect?.());

        expect(screen.getByLabelText('next month').props.accessibilityState)
            .toEqual({ disabled: false });
    });

    it('renders the empty-ring line instead of a one-person standing', () => {
        const screen = render(<LedgerScreen viewerId="viewer" initialMonth="2026-09" />);
        expect(screen.getByText('follow a few friends and the ledger fills itself')).toBeTruthy();
        expect(screen.queryByText('8 napkins')).toBeNull();
    });

    it('renders ranked rows, breakdowns, and the viewer tint when friends exist', () => {
        mockLedgerState = {
            data: {
                scope: { kind: 'friends' },
                rows: [
                    { ...VIEWER_ROW, napkins: 12, meals: 8, new_places: 3 },
                    { ...VIEWER_ROW, user_id: 'friend', display_name: 'Clara', napkins: 6, is_viewer: false },
                ],
            },
            isLoading: false,
            isError: false,
        };
        const screen = render(<LedgerScreen viewerId="viewer" initialMonth="2026-09" />);
        expect(screen.getByText('12 napkins')).toBeTruthy();
        expect(screen.getByText('8 meals · 3 new · 1 crown')).toBeTruthy();
        expect(screen.getByTestId('ledger-standings').props.initialNumToRender).toBe(20);
        expect(screen.getByLabelText('1. Jacky, 12 napkins').props.style[1]).toEqual({
            backgroundColor: 'rgba(160, 63, 40, 0.08)',
        });
    });

    it('labels table scope and does not apply the friends-only empty-ring copy', () => {
        mockLedgerState = {
            data: {
                rows: [VIEWER_ROW],
                scope: { kind: 'table', table_id: 'table-1', table_name: 'Sunday Roast' },
            },
            isLoading: false,
            isError: false,
        };
        const screen = render(
            <LedgerScreen viewerId="viewer" initialMonth="2026-09" tableId="table-1" />,
        );
        expect(screen.getByText('SUNDAY ROAST')).toBeTruthy();
        expect(screen.getByText('september 2026')).toBeTruthy();
        expect(screen.queryByText('follow a few friends and the ledger fills itself')).toBeNull();
        expect(screen.getByText('8 napkins')).toBeTruthy();
    });
});
