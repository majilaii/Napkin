jest.mock('react-native', () => ({ Platform: { OS: 'ios', select: (v: Record<string, unknown>) => v.ios ?? v.default }, View: 'View', FlatList: 'FlatList', ActivityIndicator: 'ActivityIndicator', RefreshControl: 'RefreshControl', StyleSheet: { create: (s: unknown) => s, hairlineWidth: 0.5 } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/hooks/feed', () => ({ flattenFriendsFeed: (d: unknown) => d, useFriendsFeed: jest.fn() }));
jest.mock('@/components/ErrorState', () => ({ ErrorState: 'ErrorState' }));
jest.mock('../ActivityFeedRow', () => ({ ActivityFeedRow: 'ActivityFeedRow', PinDigestRow: 'PinDigestRow' }));
jest.mock('../SectionKicker', () => ({ SectionKicker: 'SectionKicker' }));
jest.mock('../FriendFeedCard', () => ({ FriendFeedCard: 'FriendFeedCard' }));
jest.mock('../FeedSparseTail', () => ({ FeedSparseTail: 'FeedSparseTail' }));
jest.mock('../FollowingEmptyState', () => ({ FollowingEmptyState: 'FollowingEmptyState' }));
// Section labels are relative to "now"; key each row by its calendar day instead.
jest.mock('../feedDates', () => ({ feedSectionLabel: (iso: string) => iso.slice(0, 10) }));

import { buildFeedList, pinDigestKey } from '../FollowingFeed';
import type { FriendsActivityRow, PinFeedRow } from '@/hooks/feed';

const author = { user_id: 'viewer', username: 'jacky', display_name: 'Jacky', avatar_url: null };
const pin = (id: string, user_id = 'viewer', sort_date = '2026-09-01T10:00:00.000Z'): PinFeedRow => ({
    kind: 'pin', id: `pin:${id}`, activity_key: `pin:${id}`, user_id, sort_date, created_at: sort_date,
    author: { ...author, user_id }, restaurant_id: id, restaurant: { id, name: id, photo_url: null },
});
const entry = (id: string, sort_date = '2026-09-01T09:00:00.000Z'): FriendsActivityRow => ({
    kind: 'entry', id, user_id: 'viewer', restaurant_id: 'r', rating: 4, content: null, visited_at: null,
    created_at: sort_date, sort_date, photos: [], photo_count: 0, reaction_count: 0, comment_count: 0,
    top_emojis: [], my_reactions: [], restaurant: null, author,
});
it('folds two or more consecutive same-person pins, leaves a lone pin and mixed actors alone', () => {
    const rows = [pin('a'), pin('b'), pin('c'), entry('e1'), pin('d'), pin('x', 'clara'), pin('y', 'clara')];
    const items = buildFeedList(rows);
    expect(items.map((item) => item._type)).toEqual(['header', 'pins', 'row', 'row', 'pins']);
    expect(items[1]).toMatchObject({ key: 'pins-pin:a', rows: [rows[0], rows[1], rows[2]], showDivider: true });
    expect(items[3]).toMatchObject({ key: 'row-pin:d' });
    expect(items[4]).toMatchObject({ key: 'pins-pin:x', showDivider: false });
});

it('renders an expanded digest as its individual rows and resolves the digest key from any member', () => {
    const rows = [pin('a'), pin('b'), entry('e1')];
    expect(pinDigestKey(rows, 1)).toBe('pins-pin:a');
    expect(pinDigestKey(rows, 2)).toBeNull();
    const items = buildFeedList(rows, new Set(['pins-pin:a']));
    expect(items.map((item) => item._type)).toEqual(['header', 'row', 'row', 'row']);
});

it('never folds across a date-section boundary', () => {
    const rows = [pin('a', 'viewer', '2026-09-01T10:00:00.000Z'), pin('b', 'viewer', '2026-08-31T10:00:00.000Z')];
    const items = buildFeedList(rows);
    expect(items.map((item) => item._type)).toEqual(['header', 'row', 'header', 'row']);
});
