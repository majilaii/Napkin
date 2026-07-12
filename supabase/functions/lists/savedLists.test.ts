// deno-lint-ignore-file no-import-prefix
import {
    assertEquals,
    assertRejects,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
    canViewerSavePublicList,
    fetchBlockedCounterpartIds,
    isBlockedEitherDirection,
    parseSavedListsPageRequest,
    SAVED_LISTS_DEFAULT_LIMIT,
    SAVED_LISTS_MAX_LIMIT,
    selectVisibleSavedListSeeds,
} from './savedLists.ts';

const VIEWER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OWNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LIST = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function fakeBlockedUsersClient(
    rows: Array<{ blocker_id: string; blocked_id: string }> | null,
    error: unknown = null,
) {
    const filters: string[] = [];
    return {
        filters,
        client: {
            from: (table: string) => {
                assertEquals(table, 'blocked_users');
                interface FakeBuilder {
                    select(): FakeBuilder;
                    or(filter: string): Promise<{
                        data: Array<{ blocker_id: string; blocked_id: string }> | null;
                        error: unknown;
                    }>;
                }
                const builder: FakeBuilder = {
                    select: () => builder,
                    or: (filter: string) => {
                        filters.push(filter);
                        return Promise.resolve({ data: rows, error });
                    },
                };
                return builder;
            },
        },
    };
}

Deno.test('canViewerSavePublicList: only a stranger-facing public personal list passes', () => {
    const list = { id: 'list-1', owner_id: OWNER, privacy: 'public' as const, table_id: null };
    const publicOwner = { account_privacy: 'public' as const };

    assertEquals(canViewerSavePublicList(VIEWER, list, publicOwner, false), true);
    assertEquals(canViewerSavePublicList(OWNER, list, publicOwner, false), false);
    assertEquals(canViewerSavePublicList(VIEWER, { ...list, privacy: 'private' }, publicOwner, false), false);
    assertEquals(canViewerSavePublicList(VIEWER, { ...list, table_id: 'table-1' }, publicOwner, false), false);
    assertEquals(canViewerSavePublicList(VIEWER, list, { account_privacy: 'private' }, false), false);
    assertEquals(canViewerSavePublicList(VIEWER, list, publicOwner, true), false);
    assertEquals(canViewerSavePublicList(VIEWER, list, null, false), false);
});

Deno.test('isBlockedEitherDirection: either direction denies and query covers both directions', async () => {
    for (const row of [
        { blocker_id: VIEWER, blocked_id: OWNER },
        { blocker_id: OWNER, blocked_id: VIEWER },
    ]) {
        const { client, filters } = fakeBlockedUsersClient([row]);
        assertEquals(await isBlockedEitherDirection(client, VIEWER, OWNER), true);
        assertEquals(filters.length, 1);
        assertEquals(filters[0].includes(`blocker_id.eq.${VIEWER},blocked_id.eq.${OWNER}`), true);
        assertEquals(filters[0].includes(`blocker_id.eq.${OWNER},blocked_id.eq.${VIEWER}`), true);
    }
});

Deno.test('isBlockedEitherDirection: no block allows; query errors fail closed', async () => {
    assertEquals(
        await isBlockedEitherDirection(fakeBlockedUsersClient([]).client, VIEWER, OWNER),
        false,
    );
    await assertRejects(() =>
        isBlockedEitherDirection(
            fakeBlockedUsersClient(null, new Error('block lookup failed')).client,
            VIEWER,
            OWNER,
        )
    );
});

Deno.test('fetchBlockedCounterpartIds: collects both block directions', async () => {
    const { client } = fakeBlockedUsersClient([
        { blocker_id: VIEWER, blocked_id: 'blocked-by-viewer' },
        { blocker_id: 'blocked-viewer', blocked_id: VIEWER },
        { blocker_id: 'unrelated-a', blocked_id: 'unrelated-b' },
    ]);
    const ids = await fetchBlockedCounterpartIds(client, VIEWER);
    assertEquals([...ids].sort(), ['blocked-by-viewer', 'blocked-viewer']);
});

Deno.test('selectVisibleSavedListSeeds: preserves save recency and filters every live gate', () => {
    const saves = [
        { list_id: 'newest-visible', created_at: '2026-07-12T12:00:00Z' },
        { list_id: 'blocked', created_at: '2026-07-12T11:00:00Z' },
        { list_id: 'private-owner', created_at: '2026-07-12T10:00:00Z' },
        { list_id: 'table-list', created_at: '2026-07-12T09:00:00Z' },
        { list_id: 'oldest-visible', created_at: '2026-07-12T08:00:00Z' },
    ];
    const lists = [
        { id: 'oldest-visible', owner_id: 'owner-2', privacy: 'public' as const, table_id: null, title: 'Old' },
        { id: 'newest-visible', owner_id: 'owner-1', privacy: 'public' as const, table_id: null, title: 'New' },
        { id: 'blocked', owner_id: 'owner-3', privacy: 'public' as const, table_id: null, title: 'Blocked' },
        { id: 'private-owner', owner_id: 'owner-4', privacy: 'public' as const, table_id: null, title: 'Private owner' },
        { id: 'table-list', owner_id: 'owner-5', privacy: 'private' as const, table_id: 'table-1', title: 'Table' },
    ];
    const owners = [
        { user_id: 'owner-1', display_name: 'One', avatar_url: null, username: 'one', account_privacy: 'public' as const },
        { user_id: 'owner-2', display_name: 'Two', avatar_url: null, username: 'two', account_privacy: 'public' as const },
        { user_id: 'owner-3', display_name: 'Three', avatar_url: null, username: 'three', account_privacy: 'public' as const },
        { user_id: 'owner-4', display_name: 'Four', avatar_url: null, username: 'four', account_privacy: 'private' as const },
        { user_id: 'owner-5', display_name: 'Five', avatar_url: null, username: 'five', account_privacy: 'public' as const },
    ];

    const visible = selectVisibleSavedListSeeds(
        VIEWER,
        saves,
        lists,
        owners,
        new Set(['owner-3']),
    );

    assertEquals(visible.map((seed) => seed.list.id), ['newest-visible', 'oldest-visible']);
    assertEquals(visible.map((seed) => seed.saved_at), [
        '2026-07-12T12:00:00Z',
        '2026-07-12T08:00:00Z',
    ]);
});

Deno.test('parseSavedListsPageRequest: legacy request is bounded and large limits clamp', () => {
    assertEquals(parseSavedListsPageRequest({}), {
        value: {
            limit: SAVED_LISTS_DEFAULT_LIMIT,
            before_saved_at: null,
            before_list_id: null,
        },
    });
    assertEquals(parseSavedListsPageRequest({ limit: 5 }).value?.limit, 5);
    assertEquals(
        parseSavedListsPageRequest({ limit: SAVED_LISTS_MAX_LIMIT + 500 }).value?.limit,
        SAVED_LISTS_MAX_LIMIT,
    );
});

Deno.test('parseSavedListsPageRequest: accepts only a complete stable keyset', () => {
    const cursor = {
        before_saved_at: '2026-07-12T12:34:56.000Z',
        before_list_id: LIST,
    };
    assertEquals(parseSavedListsPageRequest(cursor), {
        value: { limit: SAVED_LISTS_DEFAULT_LIMIT, ...cursor },
    });
    assertEquals(
        parseSavedListsPageRequest({ before_saved_at: cursor.before_saved_at }).error,
        'before_saved_at and before_list_id must be provided together',
    );
    assertEquals(
        parseSavedListsPageRequest({ before_saved_at: 'not-a-date', before_list_id: LIST }).error,
        'before_saved_at must be a valid timestamp',
    );
    assertEquals(
        parseSavedListsPageRequest({ before_saved_at: cursor.before_saved_at, before_list_id: 'bad' }).error,
        'before_list_id must be a valid uuid',
    );
    assertEquals(
        parseSavedListsPageRequest({ limit: 0 }).error,
        'limit must be a positive integer',
    );
});
