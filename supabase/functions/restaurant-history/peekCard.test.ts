import { assert, assertEquals, assertStrictEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { contentKey } from '../_shared/videoUrlKey.ts';
import {
    isPeekCardContext,
    loadPeekCard,
    type PeekCardClient,
    type PeekCardContext,
    type PeekCardResponse,
} from './peekCard.ts';

interface QueryLog {
    table: string;
    select: string | null;
    eq: Record<string, unknown>;
    in: Record<string, unknown[]>;
    not: Array<[string, string, unknown]>;
    or: string[];
    order: Array<{ column: string; ascending: boolean }>;
    limit: number | null;
}

interface RpcLog {
    name: string;
    args: Record<string, unknown>;
}

interface Fixtures {
    tables?: Record<string, any[]>;
    publicAccount?: unknown;
    publicAccountError?: any;
    saverRows?: any[];
    saverError?: any;
    blockError?: any;
    listError?: any;
}

function nestedValue(row: any, path: string): unknown {
    return path.split('.').reduce((value, key) => value?.[key], row);
}

function fakeClient(fixtures: Fixtures = {}): {
    client: PeekCardClient;
    queries: QueryLog[];
    rpcs: RpcLog[];
} {
    const queries: QueryLog[] = [];
    const rpcs: RpcLog[] = [];
    const tables = fixtures.tables ?? {};

    const from = (table: string) => {
        const log: QueryLog = {
            table,
            select: null,
            eq: {},
            in: {},
            not: [],
            or: [],
            order: [],
            limit: null,
        };
        queries.push(log);
        const queryError = table === 'blocked_users'
            ? fixtures.blockError ?? null
            : table === 'lists'
            ? fixtures.listError ?? null
            : null;

        const rows = () => {
            let result = [...(tables[table] ?? [])];
            for (const [column, value] of Object.entries(log.eq)) {
                result = result.filter((row) => nestedValue(row, column) === value);
            }
            for (const [column, values] of Object.entries(log.in)) {
                result = result.filter((row) => values.includes(nestedValue(row, column)));
            }
            for (const [column, operator, value] of log.not) {
                if (operator === 'is' && value === null) {
                    result = result.filter((row) => nestedValue(row, column) != null);
                }
            }
            for (const { column, ascending } of [...log.order].reverse()) {
                result.sort((a, b) => {
                    const av = String(nestedValue(a, column) ?? '');
                    const bv = String(nestedValue(b, column) ?? '');
                    if (av === bv) return 0;
                    const direction = av < bv ? -1 : 1;
                    return ascending ? direction : -direction;
                });
            }
            return log.limit == null ? result : result.slice(0, log.limit);
        };

        const builder: any = {
            select: (selection: string) => {
                log.select = selection;
                return builder;
            },
            eq: (column: string, value: unknown) => {
                log.eq[column] = value;
                return builder;
            },
            in: (column: string, values: unknown[]) => {
                log.in[column] = values;
                return builder;
            },
            not: (column: string, operator: string, value: unknown) => {
                log.not.push([column, operator, value]);
                return builder;
            },
            or: (filter: string) => {
                log.or.push(filter);
                return builder;
            },
            order: (column: string, options: { ascending: boolean }) => {
                log.order.push({ column, ascending: options.ascending });
                return builder;
            },
            limit: (value: number) => {
                log.limit = value;
                return builder;
            },
            maybeSingle: () =>
                Promise.resolve({
                    data: queryError ? null : rows()[0] ?? null,
                    error: queryError,
                }),
            then: (
                resolve: (value: { data: any[] | null; error: any }) => void,
            ) => resolve({
                data: queryError ? null : rows(),
                error: queryError,
            }),
        };
        return builder;
    };

    const rpc = (name: string, args: Record<string, unknown>) => {
        rpcs.push({ name, args });
        if (name === 'fn_public_account') {
            return Promise.resolve({
                data: fixtures.publicAccount ?? false,
                error: fixtures.publicAccountError ?? null,
            });
        }
        if (name === 'fn_restaurant_saves_visible') {
            return Promise.resolve({
                data: fixtures.saverRows ?? [],
                error: fixtures.saverError ?? null,
            });
        }
        return Promise.resolve({ data: null, error: { code: 'UNEXPECTED_RPC' } });
    };

    return { client: { from, rpc }, queries, rpcs };
}

const VIEWER = '10000000-0000-4000-8000-000000000001';
const AUTHOR = '20000000-0000-4000-8000-000000000002';
const RESTAURANT = '30000000-0000-4000-8000-000000000003';
const OTHER_RESTAURANT = '30000000-0000-4000-8000-000000000004';
const ENTRY = '40000000-0000-4000-8000-000000000004';
const OTHER_ENTRY = '40000000-0000-4000-8000-000000000005';
const TABLE_A = '50000000-0000-4000-8000-000000000005';
const TABLE_B = '50000000-0000-4000-8000-000000000006';
const TABLE_LIST = '60000000-0000-4000-8000-000000000006';
const PERSONAL_LIST = '60000000-0000-4000-8000-000000000007';
const SECOND_AUTHOR = '20000000-0000-4000-8000-000000000003';
const SUPABASE_URL = 'https://example.supabase.co';

const restaurant = (overrides: Record<string, unknown> = {}) => ({
    id: RESTAURANT,
    external_id: 'places-id',
    verification: 'verified',
    created_by: AUTHOR,
    address: '55 Shirland Rd, London W9',
    price_level: 2,
    google_rating: 4.5,
    google_rating_count: 1200,
    hours: { weekdayDescriptions: ['Wednesday: 12:00 PM – 11:30 PM'] },
    reserve_url: null,
    photo_url: null,
    photo_source: null,
    places_photo_attribution_html: null,
    ...overrides,
});

const networkEntry = (overrides: Record<string, unknown> = {}) => ({
    id: ENTRY,
    restaurant_id: RESTAURANT,
    user_id: AUTHOR,
    visibility: 'friends',
    rating: 4.5,
    ...overrides,
});

function exactBlockPredicate(authorIds: readonly string[]): string {
    const candidates = [...new Set(authorIds)].sort().join(',');
    return `and(blocker_id.eq.${VIEWER},blocked_id.in.(${candidates})),` +
        `and(blocker_id.in.(${candidates}),blocked_id.eq.${VIEWER})`;
}

function tableBranchContext(layer: 'overlap' | 'list'): PeekCardContext {
    return layer === 'overlap' ? { layer, table_id: TABLE_A } : { layer, list_id: TABLE_LIST };
}

function tableBranchTables(
    layer: 'overlap' | 'list',
    overrides: Record<string, any[]> = {},
): Record<string, any[]> {
    return {
        table_members: [{ table_id: TABLE_A, member_id: VIEWER }],
        entry_tables: [{
            table_id: TABLE_A,
            entry_id: ENTRY,
            posted_at: '2026-07-02',
        }],
        entries: [networkEntry()],
        blocked_users: [],
        entry_photos: [{
            entry_id: ENTRY,
            photo_url: 'table-shared.jpg',
            created_at: '2026-07-02',
        }],
        ...(layer === 'list' ? { lists: [{ id: TABLE_LIST, table_id: TABLE_A }] } : {}),
        ...overrides,
    };
}

async function run(
    context: PeekCardContext,
    fixtures: Fixtures,
) {
    const built = fakeClient({
        ...fixtures,
        tables: {
            restaurants: [restaurant()],
            ...(fixtures.tables ?? {}),
        },
    });
    const data = await loadPeekCard(built.client, {
        viewerId: VIEWER,
        restaurantId: RESTAURANT,
        context,
        supabaseUrl: SUPABASE_URL,
    });
    return { ...built, data };
}

function entryMedia(data: Pick<PeekCardResponse, 'media'>) {
    return data.media.filter((candidate) => candidate.kind === 'entry');
}

Deno.test('peek_card context validator accepts only the six contract layers', () => {
    for (
        const layer of ['saved', 'been', 'network', 'overlap', 'gathered', 'list']
    ) {
        assert(isPeekCardContext({ layer }));
    }
    assertEquals(isPeekCardContext({ layer: 'discover' }), false);
    assertEquals(isPeekCardContext({ layer: 'network', entry_id: 42 }), false);
});

Deno.test('network rung: a non-followee returns no entry photo and stops before account/photo reads', async () => {
    const { data, queries, rpcs } = await run(
        { layer: 'network', entry_id: ENTRY },
        {
            tables: {
                entries: [networkEntry()],
                follows: [],
                entry_photos: [{
                    entry_id: ENTRY,
                    photo_url: 'private.jpg',
                    sort_order: 0,
                }],
            },
            publicAccount: true,
        },
    );
    assertEquals(entryMedia(data), []);
    assertEquals(queries.some((query) => query.table === 'entry_photos'), false);
    assertEquals(rpcs.some((rpc) => rpc.name === 'fn_public_account'), false);
    const follow = queries.find((query) => query.table === 'follows')!;
    assertEquals(follow.eq, { follower_id: VIEWER, following_id: AUTHOR });
});

Deno.test('network rung: a private-account author returns no entry photo (strict fn_public_account true)', async () => {
    const { data, queries, rpcs } = await run(
        { layer: 'network', entry_id: ENTRY },
        {
            tables: {
                entries: [networkEntry()],
                follows: [{ follower_id: VIEWER, following_id: AUTHOR }],
                entry_photos: [{
                    entry_id: ENTRY,
                    photo_url: 'private.jpg',
                    sort_order: 0,
                }],
            },
            publicAccount: false,
        },
    );
    assertEquals(entryMedia(data), []);
    assertEquals(queries.some((query) => query.table === 'entry_photos'), false);
    assertEquals(rpcs.find((rpc) => rpc.name === 'fn_public_account')?.args, {
        p_user_id: AUTHOR,
    });
});

for (
    const [label, blocker_id, blocked_id] of [
        ['viewer blocks author', VIEWER, AUTHOR],
        ['author blocks viewer', AUTHOR, VIEWER],
    ] as const
) {
    Deno.test(`network rung: either-direction block (${label}) returns no entry photo`, async () => {
        const { data, queries } = await run(
            { layer: 'network', entry_id: ENTRY },
            {
                tables: {
                    entries: [networkEntry()],
                    follows: [{ follower_id: VIEWER, following_id: AUTHOR }],
                    blocked_users: [{ blocker_id, blocked_id }],
                    entry_photos: [{
                        entry_id: ENTRY,
                        photo_url: 'private.jpg',
                        sort_order: 0,
                    }],
                },
                publicAccount: true,
            },
        );
        assertEquals(entryMedia(data), []);
        assertEquals(
            queries.some((query) => query.table === 'entry_photos'),
            false,
        );
        const block = queries.find((query) => query.table === 'blocked_users')!;
        assert(
            block.or[0].includes(`blocker_id.eq.${VIEWER},blocked_id.eq.${AUTHOR}`),
        );
        assert(
            block.or[0].includes(`blocker_id.eq.${AUTHOR},blocked_id.eq.${VIEWER}`),
        );
    });
}

Deno.test('network rung: restaurant mismatch fails before follow/account/photo reads', async () => {
    const { data, queries, rpcs } = await run(
        { layer: 'network', entry_id: ENTRY },
        {
            tables: {
                entries: [networkEntry({ restaurant_id: OTHER_RESTAURANT })],
                follows: [{ follower_id: VIEWER, following_id: AUTHOR }],
                entry_photos: [{ entry_id: ENTRY, photo_url: 'wrong-restaurant.jpg' }],
            },
            publicAccount: true,
        },
    );
    assertEquals(entryMedia(data), []);
    assertEquals(queries.some((query) => query.table === 'follows'), false);
    assertEquals(queries.some((query) => query.table === 'entry_photos'), false);
    assertEquals(rpcs.some((rpc) => rpc.name === 'fn_public_account'), false);
});

Deno.test('network rung: NULL/private entry visibility fails closed', async () => {
    for (const visibility of [null, 'private']) {
        const { data, queries } = await run(
            { layer: 'network', entry_id: ENTRY },
            {
                tables: {
                    entries: [networkEntry({ visibility })],
                    follows: [{ follower_id: VIEWER, following_id: AUTHOR }],
                    entry_photos: [{ entry_id: ENTRY, photo_url: 'private.jpg' }],
                },
                publicAccount: true,
            },
        );
        assertEquals(entryMedia(data), []);
        assertEquals(
            queries.some((query) => query.table === 'entry_photos'),
            false,
        );
    }
});

Deno.test('network rung: followed public unblocked thin log surfaces its exact photo', async () => {
    const { data, queries, rpcs } = await run(
        { layer: 'network', entry_id: ENTRY },
        {
            tables: {
                // Rating-only: deliberately no content/public-review threshold.
                entries: [networkEntry({ rating: 4.5 })],
                follows: [{ follower_id: VIEWER, following_id: AUTHOR }],
                blocked_users: [],
                entry_photos: [{
                    entry_id: ENTRY,
                    photo_url: 'thin-log.jpg',
                    sort_order: 0,
                }],
            },
            publicAccount: true,
        },
    );
    assertEquals(entryMedia(data), [{
        kind: 'entry',
        url: 'thin-log.jpg',
        photo_source: 'user',
    }]);
    const photo = queries.find((query) => query.table === 'entry_photos')!;
    assertEquals(photo.eq.entry_id, ENTRY);
    assertEquals(
        rpcs.some((rpc) => rpc.name === 'is_entry_publicly_eligible'),
        false,
    );
});

Deno.test('gathered rung: non-member skips entry_tables, entries, and photos', async () => {
    const { data, queries } = await run(
        { layer: 'gathered', table_id: TABLE_A },
        {
            tables: {
                table_members: [],
                entry_tables: [{ table_id: TABLE_A, entry_id: ENTRY }],
                entries: [networkEntry()],
                entry_photos: [{ entry_id: ENTRY, photo_url: 'table.jpg' }],
            },
        },
    );
    assertEquals(entryMedia(data), []);
    const membership = queries.find((query) => query.table === 'table_members')!;
    assertEquals(membership.eq, { table_id: TABLE_A, member_id: VIEWER });
    assertEquals(queries.some((query) => query.table === 'entry_tables'), false);
    assertEquals(queries.some((query) => query.table === 'entry_photos'), false);
});

Deno.test('gathered rung: multi-table share resolves through the requested enclosing table', async () => {
    const { data, queries } = await run(
        { layer: 'gathered', table_id: TABLE_B },
        {
            tables: {
                table_members: [{ table_id: TABLE_B, member_id: VIEWER }],
                entry_tables: [
                    { table_id: TABLE_A, entry_id: ENTRY, posted_at: '2026-07-01' },
                    { table_id: TABLE_B, entry_id: ENTRY, posted_at: '2026-07-02' },
                ],
                entries: [networkEntry()],
                entry_photos: [{
                    entry_id: ENTRY,
                    photo_url: 'shared-to-b.jpg',
                    created_at: '2026-07-02',
                }],
            },
        },
    );
    assertEquals(entryMedia(data), [{
        kind: 'entry',
        url: 'shared-to-b.jpg',
        photo_source: 'table',
    }]);
    const shares = queries.find((query) => query.table === 'entry_tables')!;
    assertEquals(shares.eq.table_id, TABLE_B);
    const photos = queries.find((query) => query.table === 'entry_photos')!;
    assertEquals(photos.in.entry_id, [ENTRY]);
});

Deno.test('gathered rung: one table with two restaurants returns only the resolved restaurant photo', async () => {
    const { data, queries } = await run(
        { layer: 'gathered', table_id: TABLE_A },
        {
            tables: {
                table_members: [{ table_id: TABLE_A, member_id: VIEWER }],
                entry_tables: [
                    { table_id: TABLE_A, entry_id: ENTRY, posted_at: '2026-07-02' },
                    { table_id: TABLE_A, entry_id: OTHER_ENTRY, posted_at: '2026-07-03' },
                ],
                entries: [
                    networkEntry(),
                    networkEntry({ id: OTHER_ENTRY, restaurant_id: OTHER_RESTAURANT }),
                ],
                entry_photos: [
                    {
                        entry_id: OTHER_ENTRY,
                        photo_url: 'wrong.jpg',
                        created_at: '2026-07-03',
                    },
                    {
                        entry_id: ENTRY,
                        photo_url: 'correct.jpg',
                        created_at: '2026-07-02',
                    },
                ],
            },
        },
    );
    assertEquals(entryMedia(data), [{
        kind: 'entry',
        url: 'correct.jpg',
        photo_source: 'table',
    }]);
    const entries = queries.find((query) => query.table === 'entries')!;
    assertEquals(entries.eq.restaurant_id, RESTAURANT);
    const photos = queries.find((query) => query.table === 'entry_photos')!;
    assertEquals(photos.in.entry_id, [ENTRY]);
});

Deno.test('overlap rung: a member sees the newest photo shared into the exact table', async () => {
    const { data, queries } = await run(
        { layer: 'overlap', table_id: TABLE_A },
        { tables: tableBranchTables('overlap') },
    );

    assertEquals(entryMedia(data), [{
        kind: 'entry',
        url: 'table-shared.jpg',
        photo_source: 'table',
    }]);
    const membership = queries.find((query) => query.table === 'table_members')!;
    assertEquals(membership.select, 'member_id');
    assertEquals(membership.eq, { table_id: TABLE_A, member_id: VIEWER });
    const shares = queries.find((query) => query.table === 'entry_tables')!;
    assertEquals(shares.eq, { table_id: TABLE_A });
    const entries = queries.find((query) => query.table === 'entries')!;
    assertEquals(entries.in.id, [ENTRY]);
    assertEquals(entries.eq.restaurant_id, RESTAURANT);
    const block = queries.find((query) => query.table === 'blocked_users')!;
    assertEquals(block.or, [exactBlockPredicate([AUTHOR])]);
    const photos = queries.find((query) => query.table === 'entry_photos')!;
    assertEquals(photos.in.entry_id, [ENTRY]);
});

Deno.test("overlap rung: a member's unshared entry never reaches entry or photo reads", async () => {
    const { data, queries } = await run(
        { layer: 'overlap', table_id: TABLE_A },
        {
            tables: tableBranchTables('overlap', {
                entry_tables: [],
            }),
        },
    );

    assertEquals(entryMedia(data), []);
    for (const table of ['entries', 'blocked_users', 'entry_photos']) {
        assertEquals(queries.some((query) => query.table === table), false);
    }
});

Deno.test('overlap rung: an entry shared only to another table never surfaces', async () => {
    const { data, queries } = await run(
        { layer: 'overlap', table_id: TABLE_A },
        {
            tables: tableBranchTables('overlap', {
                entry_tables: [{
                    table_id: TABLE_B,
                    entry_id: ENTRY,
                    posted_at: '2026-07-02',
                }],
            }),
        },
    );

    assertEquals(entryMedia(data), []);
    const shares = queries.find((query) => query.table === 'entry_tables')!;
    assertEquals(shares.eq, { table_id: TABLE_A });
    for (const table of ['entries', 'blocked_users', 'entry_photos']) {
        assertEquals(queries.some((query) => query.table === table), false);
    }
});

Deno.test('overlap rung: a forged foreign table id fails membership before every downstream read', async () => {
    const { data, queries } = await run(
        { layer: 'overlap', table_id: TABLE_B },
        { tables: tableBranchTables('overlap') },
    );

    assertEquals(entryMedia(data), []);
    const membership = queries.find((query) => query.table === 'table_members')!;
    assertEquals(membership.eq, { table_id: TABLE_B, member_id: VIEWER });
    for (
        const table of [
            'entry_tables',
            'entries',
            'blocked_users',
            'entry_photos',
        ]
    ) {
        assertEquals(queries.some((query) => query.table === table), false);
    }
});

Deno.test('overlap rung: legacy context without table_id keeps fallback and performs zero table auth reads', async () => {
    const { data, queries } = await run(
        { layer: 'overlap' },
        {
            tables: {
                restaurants: [restaurant({
                    photo_url: 'places-fallback.jpg',
                    photo_source: 'places',
                    places_photo_attribution_html: '<a>Fallback Guide</a>',
                })],
            },
        },
    );

    assertEquals(data.media, [{
        kind: 'places',
        url: 'places-fallback.jpg',
        photo_source: 'places',
        attribution: 'Fallback Guide',
    }]);
    for (
        const table of [
            'table_members',
            'entry_tables',
            'entries',
            'blocked_users',
            'entry_photos',
        ]
    ) {
        assertEquals(queries.some((query) => query.table === table), false);
    }
});

Deno.test('overlap rung: a photoless member falls through after the authorized photo read', async () => {
    const { data, queries } = await run(
        { layer: 'overlap', table_id: TABLE_A },
        {
            tables: tableBranchTables('overlap', {
                entry_photos: [],
            }),
        },
    );

    assertEquals(entryMedia(data), []);
    const block = queries.find((query) => query.table === 'blocked_users')!;
    assertEquals(block.or, [exactBlockPredicate([AUTHOR])]);
    assertEquals(queries.some((query) => query.table === 'entry_photos'), true);
});

Deno.test('list rung: a table list derives its table and enriches for a member', async () => {
    const { data, queries } = await run(
        { layer: 'list', list_id: TABLE_LIST },
        { tables: tableBranchTables('list') },
    );

    assertEquals(entryMedia(data), [{
        kind: 'entry',
        url: 'table-shared.jpg',
        photo_source: 'table',
    }]);
    const list = queries.find((query) => query.table === 'lists')!;
    assertEquals(list.eq, { id: TABLE_LIST });
    const membership = queries.find((query) => query.table === 'table_members')!;
    assertEquals(membership.eq, { table_id: TABLE_A, member_id: VIEWER });
    const block = queries.find((query) => query.table === 'blocked_users')!;
    assertEquals(block.or, [exactBlockPredicate([AUTHOR])]);
});

for (
    const [label, listRows] of [
        ['personal', [{ id: PERSONAL_LIST, table_id: null }]],
        ['nonexistent', []],
    ] as const
) {
    Deno.test(`list rung: a ${label} list stays un-enriched with zero table reads`, async () => {
        const listId = label === 'personal' ? PERSONAL_LIST : TABLE_LIST;
        const { data, queries } = await run(
            { layer: 'list', list_id: listId },
            { tables: { lists: [...listRows] } },
        );

        assertEquals(entryMedia(data), []);
        for (
            const table of [
                'table_members',
                'entry_tables',
                'entries',
                'blocked_users',
                'entry_photos',
            ]
        ) {
            assertEquals(queries.some((query) => query.table === table), false);
        }
    });
}

Deno.test('list rung: a maybeSingle error stays un-enriched with zero table reads', async () => {
    const { data, queries } = await run(
        { layer: 'list', list_id: TABLE_LIST },
        {
            listError: { code: 'LIST_READ_FAILED' },
            tables: { lists: [{ id: TABLE_LIST, table_id: TABLE_A }] },
        },
    );

    assertEquals(entryMedia(data), []);
    assertEquals(queries.filter((query) => query.table === 'lists').length, 1);
    for (
        const table of [
            'table_members',
            'entry_tables',
            'entries',
            'blocked_users',
            'entry_photos',
        ]
    ) {
        assertEquals(queries.some((query) => query.table === table), false);
    }
});

Deno.test('list rung: a foreign table list fails membership with zero downstream reads', async () => {
    const { data, queries } = await run(
        { layer: 'list', list_id: TABLE_LIST },
        {
            tables: tableBranchTables('list', {
                lists: [{ id: TABLE_LIST, table_id: TABLE_B }],
            }),
        },
    );

    assertEquals(entryMedia(data), []);
    const membership = queries.find((query) => query.table === 'table_members')!;
    assertEquals(membership.eq, { table_id: TABLE_B, member_id: VIEWER });
    for (
        const table of [
            'entry_tables',
            'entries',
            'blocked_users',
            'entry_photos',
        ]
    ) {
        assertEquals(queries.some((query) => query.table === table), false);
    }
});

for (const layer of ['overlap', 'list'] as const) {
    for (
        const [label, blocker_id, blocked_id] of [
            ['viewer blocks author', VIEWER, AUTHOR],
            ['author blocks viewer', AUTHOR, VIEWER],
        ] as const
    ) {
        Deno.test(`${layer} rung: either-direction block (${label}) suppresses before photos`, async () => {
            const { data, queries } = await run(
                tableBranchContext(layer),
                {
                    tables: tableBranchTables(layer, {
                        blocked_users: [{ blocker_id, blocked_id }],
                    }),
                },
            );

            assertEquals(entryMedia(data), []);
            const block = queries.find((query) => query.table === 'blocked_users')!;
            assertEquals(block.or, [exactBlockPredicate([AUTHOR])]);
            assertEquals(
                queries.some((query) => query.table === 'entry_photos'),
                false,
            );
        });
    }
}

for (const layer of ['overlap', 'list'] as const) {
    Deno.test(`${layer} rung: blocked authors are filtered and the newest unblocked photo wins`, async () => {
        const { data, queries } = await run(
            tableBranchContext(layer),
            {
                tables: tableBranchTables(layer, {
                    entry_tables: [
                        {
                            table_id: TABLE_A,
                            entry_id: ENTRY,
                            posted_at: '2026-07-03',
                        },
                        {
                            table_id: TABLE_A,
                            entry_id: OTHER_ENTRY,
                            posted_at: '2026-07-02',
                        },
                    ],
                    entries: [
                        networkEntry(),
                        networkEntry({
                            id: OTHER_ENTRY,
                            user_id: SECOND_AUTHOR,
                        }),
                    ],
                    blocked_users: [{
                        blocker_id: VIEWER,
                        blocked_id: AUTHOR,
                    }],
                    entry_photos: [
                        {
                            entry_id: ENTRY,
                            photo_url: 'newest-but-blocked.jpg',
                            created_at: '2026-07-03',
                        },
                        {
                            entry_id: OTHER_ENTRY,
                            photo_url: 'newest-unblocked.jpg',
                            created_at: '2026-07-02',
                        },
                    ],
                }),
            },
        );

        assertEquals(entryMedia(data), [{
            kind: 'entry',
            url: 'newest-unblocked.jpg',
            photo_source: 'table',
        }]);
        const block = queries.find((query) => query.table === 'blocked_users')!;
        assertEquals(block.or, [exactBlockPredicate([AUTHOR, SECOND_AUTHOR])]);
        const photo = queries.find((query) => query.table === 'entry_photos')!;
        assertEquals(photo.in.entry_id, [OTHER_ENTRY]);
    });
}

for (const layer of ['overlap', 'list'] as const) {
    Deno.test(`${layer} rung: a block-query error fails closed before photo reads`, async () => {
        const { data, queries } = await run(
            tableBranchContext(layer),
            {
                blockError: { code: 'BLOCK_READ_FAILED' },
                tables: tableBranchTables(layer),
            },
        );

        assertEquals(entryMedia(data), []);
        const block = queries.find((query) => query.table === 'blocked_users')!;
        assertEquals(block.or, [exactBlockPredicate([AUTHOR])]);
        assertEquals(
            queries.some((query) => query.table === 'entry_photos'),
            false,
        );
    });
}

Deno.test('overlap rung: 31 sorted authors produce two exact block chunks before photos', async () => {
    const authorIds = Array.from(
        { length: 31 },
        (_, index) => `70000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    );
    const entryIds = Array.from(
        { length: 31 },
        (_, index) => `80000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    );
    const { data, queries } = await run(
        { layer: 'overlap', table_id: TABLE_A },
        {
            tables: tableBranchTables('overlap', {
                entry_tables: entryIds.map((entry_id, index) => ({
                    table_id: TABLE_A,
                    entry_id,
                    posted_at: `2026-07-${String(index + 1).padStart(2, '0')}`,
                })),
                entries: entryIds.map((id, index) => ({
                    id,
                    user_id: authorIds[index],
                    restaurant_id: RESTAURANT,
                })),
                blocked_users: [],
                entry_photos: [{
                    entry_id: entryIds[30],
                    photo_url: 'after-all-block-chunks.jpg',
                    created_at: '2026-07-31',
                }],
            }),
        },
    );

    assertEquals(entryMedia(data), [{
        kind: 'entry',
        url: 'after-all-block-chunks.jpg',
        photo_source: 'table',
    }]);
    const blocks = queries.filter((query) => query.table === 'blocked_users');
    assertEquals(blocks.length, 2);
    assertEquals(blocks[0].or, [exactBlockPredicate(authorIds.slice(0, 30))]);
    assertEquals(blocks[1].or, [exactBlockPredicate(authorIds.slice(30))]);
    const photoIndex = queries.findIndex((query) => query.table === 'entry_photos');
    assert(photoIndex > queries.indexOf(blocks[0]));
    assert(photoIndex > queries.indexOf(blocks[1]));
});

Deno.test('clip rung walks past an unthumbed winner; count is pre-social-filter and k-floored', async () => {
    const topUrl = 'https://www.tiktok.com/@one/video/100';
    const secondUrl = 'https://www.tiktok.com/@two/video/200';
    const secondKey = await contentKey(secondUrl);
    const { data } = await run(
        { layer: 'saved' },
        {
            saverRows: [
                {
                    relationship: 'self',
                    created_at: '2026-07-03',
                    source: { type: 'tiktok', url: topUrl },
                },
                {
                    relationship: 'following',
                    created_at: '2026-07-02',
                    source: { type: 'tiktok', url: secondUrl },
                },
                {
                    relationship: 'stranger',
                    created_at: '2026-07-01',
                    source: { type: 'manual' },
                },
            ],
            tables: {
                clip_thumbs: [{
                    content_key: secondKey,
                    storage_path: 'two/cover.jpg',
                    status: 'cached',
                }],
            },
        },
    );
    assertEquals(data.media[0], {
        kind: 'clip',
        url: `${SUPABASE_URL}/storage/v1/object/public/clip-thumbs/two/cover.jpg`,
    });
    assertEquals(data.visible_saves_count, 3);
});

Deno.test('overlap omits visible_saves_count even when the SECDEF row count clears the floor', async () => {
    const { data } = await run(
        { layer: 'overlap' },
        { saverRows: [{}, {}, {}] },
    );
    assertEquals('visible_saves_count' in data, false);
});

Deno.test('canonical media order is authorized entry → clip → mirrored Places hero', async () => {
    const clipUrl = 'https://www.tiktok.com/@clip/video/300';
    const clipKey = await contentKey(clipUrl);
    const { data } = await run(
        { layer: 'network', entry_id: ENTRY },
        {
            publicAccount: true,
            saverRows: [{
                relationship: 'self',
                created_at: '2026-07-03',
                source: { type: 'tiktok', url: clipUrl },
            }],
            tables: {
                restaurants: [restaurant({
                    photo_url: 'https://storage.example/places.jpg',
                    photo_source: 'places',
                    places_photo_attribution_html: '<a href="https://maps.google.com">Jane &amp; Co</a>',
                })],
                entries: [networkEntry()],
                follows: [{ follower_id: VIEWER, following_id: AUTHOR }],
                blocked_users: [],
                entry_photos: [{
                    entry_id: ENTRY,
                    photo_url: 'entry.jpg',
                    sort_order: 0,
                }],
                clip_thumbs: [{
                    content_key: clipKey,
                    storage_path: 'clip.jpg',
                    status: 'cached',
                }],
            },
        },
    );
    assertEquals(data.media, [
        { kind: 'entry', url: 'entry.jpg', photo_source: 'user' },
        {
            kind: 'clip',
            url: `${SUPABASE_URL}/storage/v1/object/public/clip-thumbs/clip.jpg`,
        },
        {
            kind: 'places',
            url: 'https://storage.example/places.jpg',
            photo_source: 'places',
            attribution: 'Jane & Co',
        },
    ]);
});

Deno.test('Places media fails closed when stored author attribution is missing', async () => {
    for (const places_photo_attribution_html of [null, '   ', '<a href="https://maps.google.com"></a>']) {
        const { data } = await run(
            { layer: 'saved' },
            {
                tables: {
                    restaurants: [restaurant({
                        photo_url: 'https://storage.example/places.jpg',
                        photo_source: 'places',
                        places_photo_attribution_html,
                    })],
                },
            },
        );

        assertEquals(data.media.some((candidate) => candidate.kind === 'places'), false);
    }
});

Deno.test('response always carries required scalar keys and derives the short address', async () => {
    const { data } = await run({ layer: 'saved' }, {});
    assertEquals(data.google_rating, 4.5);
    assertEquals(data.google_rating_count, 1200);
    assertEquals(data.price_level, 2);
    assertEquals(data.hours, {
        weekdayDescriptions: ['Wednesday: 12:00 PM – 11:30 PM'],
    });
    assertEquals(data.address_short, '55 Shirland Rd');
    assertStrictEquals(data.reserve_url, null);
    assert(Array.isArray(data.media));
});

Deno.test('missing restaurant returns the complete nullable response contract', async () => {
    const built = fakeClient({ tables: { restaurants: [] } });
    const data = await loadPeekCard(built.client, {
        viewerId: VIEWER,
        restaurantId: RESTAURANT,
        context: { layer: 'saved' },
        supabaseUrl: SUPABASE_URL,
    });
    assertEquals(data, {
        media: [],
        google_rating: null,
        google_rating_count: null,
        price_level: null,
        hours: null,
        address_short: null,
        reserve_url: null,
    });
});
