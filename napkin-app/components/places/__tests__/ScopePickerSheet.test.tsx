import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { Colors } from '@/constants/theme';
import type { TableMember } from '@/hooks/tables/useTableMembers';
import type { TableMembership } from '@/hooks/tables/useTables';
import {
    ScopePickerSheet,
    WhoChip,
    whoChipPresentation,
} from '../ScopePickerSheet';

jest.mock('react-native', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactModule = require('react') as typeof React;
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children as React.ReactNode);
    return {
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
        Image: host('Image'),
        Modal: ({ visible, children, ...props }: {
            visible?: boolean;
            children?: React.ReactNode;
        }) => visible ? ReactModule.createElement('Modal', props, children) : null,
        Pressable: host('Pressable'),
        ScrollView: host('ScrollView'),
        StyleSheet: {
            absoluteFillObject: { position: 'absolute', inset: 0 },
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
        useWindowDimensions: () => ({ width: 390, height: 800 }),
        View: host('View'),
    };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/feed/Avatar', () => ({ Avatar: 'Avatar' }));

const members: TableMember[] = [0, 1, 2].map((index) => ({
    member_id: `member-${index}`,
    role: 'member',
    joined_at: '2026-01-01T00:00:00Z',
    profiles: { display_name: `Member ${index}`, avatar_url: null },
}));

const tables: TableMembership[] = [{
    role: 'admin',
    joined_at: '2026-01-01T00:00:00Z',
    tables: {
        id: 'table-a',
        name: 'sunday lunch',
        avatar_url: null,
        owner_id: 'viewer',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
        member_count: 3,
    },
}, {
    role: 'member',
    joined_at: '2026-01-02T00:00:00Z',
    tables: {
        id: 'table-b',
        name: 'friday crew',
        avatar_url: null,
        owner_id: 'member-2',
        created_at: '2026-01-02T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
    },
}];

describe('Places who chip', () => {
    it('presents you, friends, and table states with faces and active styling', () => {
        expect(whoChipPresentation({ kind: 'you' }, null, undefined)).toEqual({
            label: 'you', icon: 'person-outline', faces: [], active: false,
        });
        expect(whoChipPresentation({ kind: 'friends' }, null, undefined)).toEqual({
            label: 'friends', icon: 'people-outline', faces: [], active: true,
        });
        expect(whoChipPresentation(
            { kind: 'table', tableId: 'table-a' },
            'sunday lunch',
            members,
        )).toMatchObject({
            label: 'sunday lunch', icon: null, faces: members.slice(0, 2), active: true,
        });

        const you = render(
            <WhoChip
                scope={{ kind: 'you' }}
                tableName={null}
                palette={Colors.light}
                onPress={jest.fn()}
            />,
        );
        expect(you.getByLabelText('who, you').props.accessibilityState.selected).toBe(false);
        you.unmount();
        const table = render(
            <WhoChip
                scope={{ kind: 'table', tableId: 'table-a' }}
                tableName="sunday lunch"
                members={members}
                palette={Colors.light}
                onPress={jest.fn()}
            />,
        );
        expect(table.getByLabelText('who, sunday lunch').props.accessibilityState.selected).toBe(true);
        expect(table.getAllByTestId('who-chip-face')).toHaveLength(2);
    });
});

describe('ScopePickerSheet', () => {
    it('renders rows and checks the active scope, then selects and closes', () => {
        const onSelect = jest.fn();
        const onDismiss = jest.fn();
        const screen = render(
            <ScopePickerSheet
                visible
                scope={{ kind: 'friends' }}
                palette={Colors.light}
                profile={{ displayName: 'Jacky', avatarUrl: null }}
                pinnedCount={57}
                beenCount={23}
                followingCount={12}
                tables={tables}
                onSelect={onSelect}
                onDismiss={onDismiss}
            />,
        );

        expect(screen.getByText('WHO')).toBeTruthy();
        expect(screen.getByLabelText('you')).toBeTruthy();
        expect(screen.getByLabelText('friends')).toBeTruthy();
        expect(screen.getByLabelText('sunday lunch')).toBeTruthy();
        expect(screen.getByTestId('scope-check-friends')).toBeTruthy();
        fireEvent.press(screen.getByLabelText('sunday lunch'));
        expect(onSelect).toHaveBeenCalledWith({ kind: 'table', tableId: 'table-a' });
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('omits counts that are not cached instead of inventing zeroes', () => {
        const screen = render(
            <ScopePickerSheet
                visible
                scope={{ kind: 'you' }}
                palette={Colors.light}
                profile={{ displayName: 'Jacky', avatarUrl: null }}
                tables={tables.slice(1)}
                onSelect={jest.fn()}
                onDismiss={jest.fn()}
            />,
        );

        expect(screen.getByLabelText('you')).toBeTruthy();
        expect(screen.getByLabelText('friends')).toBeTruthy();
        expect(screen.getByLabelText('friday crew')).toBeTruthy();
        expect(screen.queryByText(/0 (pinned|been|members|you follow)/)).toBeNull();
    });

    it('caps the row list to a scrollable region so many tables stay reachable', () => {
        const manyTables: TableMembership[] = Array.from({ length: 12 }, (_, index) => ({
            role: 'member',
            joined_at: '2026-01-01T00:00:00Z',
            tables: {
                id: `table-${index}`,
                name: `table ${index}`,
                avatar_url: null,
                owner_id: 'viewer',
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-01T00:00:00Z',
                member_count: 3,
            },
        }));
        const screen = render(
            <ScopePickerSheet
                visible
                scope={{ kind: 'you' }}
                palette={Colors.light}
                profile={{ displayName: 'Jacky', avatarUrl: null }}
                tables={manyTables}
                onSelect={jest.fn()}
                onDismiss={jest.fn()}
            />,
        );

        const rows = screen.getByTestId('scope-picker-rows');
        expect(rows.props.style).toMatchObject({ maxHeight: 800 * 0.6 });
        expect(screen.getByLabelText('table 11')).toBeTruthy();
    });
});
