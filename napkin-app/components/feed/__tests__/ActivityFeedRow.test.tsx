/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
// @ts-expect-error react-test-renderer has no types in this project
import TestRenderer, { act } from 'react-test-renderer';
import { ActivityFeedRow } from '../ActivityFeedRow';
import type { PinFeedRow, ListFeedRow } from '@/hooks/feed';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mockPush = jest.fn();
jest.mock('react-native', () => {
    const R = require('react');
    const host = (name: string) => (props: Record<string, unknown>) => R.createElement(name, props, props.children);
    return { Platform: { select: (v: Record<string, unknown>) => v.ios }, View: host('View'), Text: host('Text'), Pressable: host('Pressable'), StyleSheet: { create: (s: unknown) => s, hairlineWidth: 0.5 } };
});
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'viewer' } }) }));
const base = { activity_key: 'pin:source', id: 'pin:source', user_id: 'viewer', sort_date: '2026-09-01', created_at: '2026-09-01',
    author: { user_id: 'viewer', display_name: 'Jacky', username: 'jacky', avatar_url: null } };
it.each(['pin', 'list'] as const)('opens the native %s target, never the activity key', (kind) => {
    const row: PinFeedRow | ListFeedRow = kind === 'pin'
        ? { ...base, kind, restaurant_id: 'restaurant', restaurant: { id: 'restaurant', name: 'Agora', photo_url: null } }
        : { ...base, kind, id: 'list:source', activity_key: 'list:source', list_id: 'list', title: 'Sunday brunch', emoji: null, updated_at: '2026-09-02', action: 'updated' };
    let renderer: any;
    act(() => { renderer = TestRenderer.create(<ActivityFeedRow row={row} showDivider />); });
    const button = renderer.root.findByType('Pressable');
    expect(button.props.accessibilityLabel).toContain('you ');
    act(() => button.props.onPress());
    expect(mockPush).toHaveBeenLastCalledWith(kind === 'pin'
        ? { pathname: '/restaurant/[id]', params: { id: 'restaurant' } }
        : { pathname: '/list/[id]', params: { id: 'list' } });
    act(() => renderer.unmount());
});

const pin = (id: string, name: string, user_id = 'viewer', sort_date = '2026-09-01T10:00:00.000Z'): PinFeedRow => ({
    ...base, kind: 'pin', id: `pin:${id}`, activity_key: `pin:${id}`, user_id, sort_date, created_at: sort_date,
    author: { ...base.author, user_id, display_name: user_id === 'viewer' ? 'Jacky' : 'Clara' },
    restaurant_id: id, restaurant: { id, name, photo_url: null },
});

it('folds a run of pins into one digest row that unfolds on tap', () => {
    const { PinDigestRow, pinDigestNames } = require('../ActivityFeedRow');
    const rows = [pin('a', 'Kiln'), pin('b', 'Moko Made Cafe'), pin('c', "Rita's"), pin('d', 'Brawn')];
    expect(pinDigestNames(rows)).toBe('Kiln, Moko Made Cafe and 2 more');
    expect(pinDigestNames(rows.slice(0, 3))).toBe("Kiln, Moko Made Cafe, Rita's");
    const onExpand = jest.fn();
    let renderer: any;
    act(() => { renderer = TestRenderer.create(<PinDigestRow rows={rows} showDivider onExpand={onExpand} />); });
    const button = renderer.root.findByType('Pressable');
    expect(button.props.accessibilityLabel).toBe('you pinned 4 places, Kiln, Moko Made Cafe and 2 more');
    act(() => button.props.onPress());
    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalledWith(expect.objectContaining({ pathname: '/restaurant/[id]', params: { id: 'a' } }));
    act(() => renderer.unmount());
});
