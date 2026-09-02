/* eslint-disable import/first -- Jest mocks must be registered before imports. */
let mockLedgerState: Record<string, unknown>;
const mockPush = jest.fn();
const mockUseLedger = jest.fn((..._args: unknown[]) => mockLedgerState);

jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
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
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/hooks/users/useLedger', () => ({
    deviceTimeZone: () => 'UTC',
    ledgerMonthFor: () => '2026-09',
    useLedger: (...args: unknown[]) => mockUseLedger(...args),
}));
jest.mock('@/components/feed/Avatar', () => ({ Avatar: 'Avatar' }));

import React from 'react';
import { fireEvent, render, within } from '@testing-library/react-native';

import { TableLedgerModule } from '../TableLedgerModule';

const rows = [
    { user_id: 'clara', display_name: 'Clara Jones', avatar_url: null, napkins: 12, meals: 8, new_places: 3, crowns: 1, is_viewer: false },
    { user_id: 'thomas', display_name: 'Thomas Reed', avatar_url: null, napkins: 9, meals: 6, new_places: 2, crowns: 1, is_viewer: false },
    { user_id: 'mina', display_name: 'Mina Cole', avatar_url: null, napkins: 8, meals: 5, new_places: 2, crowns: 1, is_viewer: false },
    { user_id: 'alex', display_name: 'Alex Hall', avatar_url: null, napkins: 7, meals: 5, new_places: 2, crowns: 0, is_viewer: false },
    { user_id: 'viewer', display_name: 'Jacky', avatar_url: null, napkins: 6, meals: 4, new_places: 2, crowns: 0, is_viewer: true },
];

describe('TableLedgerModule', () => {
    beforeEach(() => {
        mockPush.mockReset();
        mockUseLedger.mockClear();
    });

    it.each([
        ['loading', { isLoading: true, isError: false, data: undefined }],
        ['error', { isLoading: false, isError: true, data: undefined }],
        ['all-zero', {
            isLoading: false,
            isError: false,
            data: { rows: rows.map((row) => ({ ...row, napkins: 0 })) },
        }],
    ])('returns null while %s', (_label, state) => {
        mockLedgerState = state;
        expect(render(<TableLedgerModule viewerId="viewer" tableId="table-1" />).toJSON())
            .toBeNull();
    });

    it('renders the sorted trio and a trailing viewer line, then opens table scope', () => {
        mockLedgerState = { isLoading: false, isError: false, data: { rows } };
        const screen = render(<TableLedgerModule viewerId="viewer" tableId="table-1" />);
        const people = screen.getAllByTestId('table-ledger-person');

        expect(people).toHaveLength(3);
        expect(within(people[0]).getByText('Clara')).toBeTruthy();
        expect(within(people[1]).getByText('Thomas')).toBeTruthy();
        expect(within(people[2]).getByText('Mina')).toBeTruthy();
        expect(screen.getByText("you're 5th · 6 napkins")).toBeTruthy();
        expect(mockUseLedger).toHaveBeenCalledWith('viewer', '2026-09', 'UTC', 'table-1');

        expect(screen.getByLabelText('Clara Jones, 12 napkins')).toBeTruthy();
        fireEvent.press(screen.getByTestId('table-ledger-module'));
        expect(mockPush).toHaveBeenCalledWith({ pathname: '/ledger', params: { tableId: 'table-1' } });
    });

    it('tints the viewer when they are in the trio and omits the trailing line', () => {
        mockLedgerState = {
            isLoading: false,
            isError: false,
            data: { rows: [{ ...rows[0], is_viewer: true, user_id: 'viewer' }, ...rows.slice(1)] },
        };
        const screen = render(<TableLedgerModule viewerId="viewer" tableId="table-1" />);
        expect(screen.getAllByTestId('table-ledger-person')[0].props.style[1]).toEqual({
            backgroundColor: 'rgba(160, 63, 40, 0.08)',
        });
        expect(screen.queryByText(/you're/)).toBeNull();
    });
});
