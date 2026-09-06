import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
    appendPageProjections,
    loadSelfLog,
    loadTableNotes,
    isBareVisit,
} from './pageProjections.ts';

type QueryLog = {
    table: string;
    select: string;
    eq: Record<string, unknown>;
    in: Record<string, unknown[]>;
    is: Record<string, unknown>;
    not: Array<[string, string, unknown]>;
};

type RpcLog = { name: string; args: Record<string, unknown> };

function nestedValue(row: any, path: string): unknown {
    return path.split('.').reduce((value, key) => {
        const next = value?.[key];
        return Array.isArray(next) ? next[0] : next;
    }, row);
}

function fakeClient(
    tables: Record<string, any[]>,
    visibleEntryIds: string[] = [],
) {
    const queries: QueryLog[] = [];
    const rpcs: RpcLog[] = [];
    const client = {
        from(table: string) {
            const log: QueryLog = {
                table,
                select: '',
                eq: {},
                in: {},
                is: {},
                not: [],
            };
            queries.push(log);
            const rows = () => {
                let result = [...(tables[table] ?? [])];
                for (const [column, value] of Object.entries(log.eq)) {
                    result = result.filter((row) => nestedValue(row, column) === value);
                }
                for (const [column, values] of Object.entries(log.in)) {
                    result = result.filter((row) => values.includes(nestedValue(row, column)));
                }
                for (const [column, value] of Object.entries(log.is)) {
                    result = result.filter((row) => nestedValue(row, column) === value);
                }
                for (const [column, operator, value] of log.not) {
                    if (operator === 'is' && value === null) {
                        result = result.filter((row) => nestedValue(row, column) != null);
                    }
                }
                return result;
            };
            const builder: any = {
                select(selection: string) {
                    log.select = selection;
                    return builder;
                },
                eq(column: string, value: unknown) {
                    log.eq[column] = value;
                    return builder;
                },
                in(column: string, values: unknown[]) {
                    log.in[column] = values;
                    return builder;
                },
                is(column: string, value: unknown) {
                    log.is[column] = value;
                    return builder;
                },
                not(column: string, operator: string, value: unknown) {
                    log.not.push([column, operator, value]);
                    return builder;
                },
                then(resolve: (result: { data: any[]; error: null }) => void) {
                    resolve({ data: rows(), error: null });
                },
            };
            return builder;
        },
        rpc(name: string, args: Record<string, unknown>) {
            rpcs.push({ name, args });
            return Promise.resolve({
                data: visibleEntryIds.map((entry_id) => ({ entry_id })),
                error: null,
            });
        },
    };
    return { client, queries, rpcs };
}

const VIEWER = 'viewer';
const OTHER = 'other';
const CURRENT_A = 'current-a';
const RESTAURANT = 'restaurant';
const TABLE_A = 'table-a';
const TABLE_B = 'table-b';

const entry = (overrides: Record<string, unknown> = {}) => ({
    id: 'entry-a',
    user_id: VIEWER,
    restaurant_id: RESTAURANT,
    rating: 4.5,
    content: 'charred leeks',
    visited_at: '2026-08-20T12:00:00.000Z',
    created_at: '2026-08-20T11:00:00.000Z',
    table_night_id: null,
    entry_photos: [],
    ...overrides,
});

function projector(
    participantsByRound: Record<string, Array<{ user_id: string; display_name: string }>>,
) {
    return async (roundId: string) => ({
        participants: (participantsByRound[roundId] ?? []).map((participant) => ({
            ...participant,
            rating: null,
            notes: null,
        })),
    });
}

Deno.test('self_log fixture: solo rated entry', async () => {
    const { client } = fakeClient({ entries: [entry()] });
    const rows = await loadSelfLog(client, VIEWER, RESTAURANT, projector({}));

    assertEquals(rows, [{
        id: 'entry:entry-a',
        entry_id: 'entry-a',
        table_night_id: null,
        source: 'solo',
        rating: 4.5,
        note: 'charred leeks',
        visited_at: '2026-08-20T12:00:00.000Z',
        created_at: '2026-08-20T11:00:00.000Z',
        is_bare: false,
        supper_id: null,
        companions: [],
        photos: [],
    }]);
});

Deno.test('self_log fixture: solo unrated private own entry is included', async () => {
    const { client } = fakeClient({
        entries: [entry({ rating: null, content: null, visibility: 'private' })],
    });
    const rows = await loadSelfLog(client, VIEWER, RESTAURANT, projector({}));

    assertEquals(rows[0].rating, null);
    assertEquals(rows[0].note, null);
    assertEquals(rows.length, 1);
});

Deno.test('self_log fixture: merged round host keeps their own take', async () => {
    const roundId = 'round-host';
    const { client } = fakeClient({
        entries: [entry({ rating: 5, content: 'my host note' })],
        round_entries: [{ entry_id: 'entry-a', round_id: roundId }],
        table_nights: [{
            id: roundId,
            restaurant_id: RESTAURANT,
            kind: 'merged',
            revealed_at: '2026-08-21T20:00:00.000Z',
            created_at: '2026-08-21T18:00:00.000Z',
        }],
    });
    const rows = await loadSelfLog(client, VIEWER, RESTAURANT, projector({
        [roundId]: [
            { user_id: VIEWER, display_name: 'Jacky' },
            { user_id: OTHER, display_name: 'Clara' },
        ],
    }));

    assertEquals(rows[0].rating, 5);
    assertEquals(rows[0].note, 'my host note');
    assertEquals(rows[0].companions, ['Clara']);
    assertEquals(rows[0].table_night_id, roundId);
});

Deno.test('self_log fixture: merged round non-host keeps their own take', async () => {
    const roundId = 'round-non-host';
    const { client } = fakeClient({
        entries: [entry({ rating: 3.5, content: 'my participant note' })],
        round_entries: [{ entry_id: 'entry-a', round_id: roundId }],
        table_nights: [{
            id: roundId,
            restaurant_id: RESTAURANT,
            kind: 'merged',
            revealed_at: null,
            created_at: '2026-08-22T18:00:00.000Z',
        }],
    });
    const rows = await loadSelfLog(client, VIEWER, RESTAURANT, projector({
        [roundId]: [
            { user_id: OTHER, display_name: 'Host' },
            { user_id: VIEWER, display_name: 'Jacky' },
        ],
    }));

    assertEquals(rows[0].rating, 3.5);
    assertEquals(rows[0].note, 'my participant note');
    assertEquals(rows[0].companions, ['Host']);
});

Deno.test('self_log fixture: live round take has no entry id', async () => {
    const roundId = 'round-live';
    const { client } = fakeClient({
        entries: [],
        table_night_participants: [{
            user_id: VIEWER,
            table_night_id: roundId,
            rating: 4,
            notes: 'smoky and bright',
            table_nights: {
                id: roundId,
                restaurant_id: RESTAURANT,
                kind: 'live',
                status: 'revealed',
                revealed_at: '2026-08-23T20:00:00.000Z',
                created_at: '2026-08-23T18:00:00.000Z',
            },
        }],
    });
    const rows = await loadSelfLog(client, VIEWER, RESTAURANT, projector({
        [roundId]: [
            { user_id: VIEWER, display_name: 'Jacky' },
            { user_id: OTHER, display_name: 'Thomas' },
        ],
    }));

    assertEquals(rows[0].entry_id, null);
    assertEquals(rows[0].table_night_id, roundId);
    assertEquals(rows[0].rating, 4);
    assertEquals(rows[0].note, 'smoky and bright');
    assertEquals(rows[0].photos, []);
});

Deno.test('self_log fixture: closed live round remains in the ledger', async () => {
    const roundId = 'round-closed';
    const { client } = fakeClient({
        entries: [],
        table_night_participants: [{
            user_id: VIEWER,
            table_night_id: roundId,
            rating: 4.5,
            notes: 'last sitting',
            table_nights: {
                id: roundId,
                restaurant_id: RESTAURANT,
                kind: 'live',
                status: 'closed',
                revealed_at: '2026-08-24T20:00:00.000Z',
                created_at: '2026-08-24T18:00:00.000Z',
            },
        }],
    });

    const rows = await loadSelfLog(client, VIEWER, RESTAURANT, projector({
        [roundId]: [
            { user_id: VIEWER, display_name: 'Jacky' },
            { user_id: OTHER, display_name: 'Clara' },
        ],
    }));

    assertEquals(rows.map((row) => [row.id, row.rating, row.companions]), [
        [`round:${roundId}`, 4.5, ['Clara']],
    ]);
});

Deno.test('self_log fixture: entry photos are stable, ordered id/url pairs', async () => {
    const { client } = fakeClient({
        entries: [entry({
            entry_photos: [
                { id: 'photo-b', photo_url: 'https://example/b.jpg', sort_order: 2 },
                { id: 'photo-a', photo_url: 'https://example/a.jpg', sort_order: 0 },
            ],
        })],
    });
    const rows = await loadSelfLog(client, VIEWER, RESTAURANT, projector({}));

    assertEquals(rows[0].photos, [
        { id: 'photo-a', url: 'https://example/a.jpg' },
        { id: 'photo-b', url: 'https://example/b.jpg' },
    ]);
});

function tableShare(overrides: Record<string, unknown> = {}) {
    return {
        entry_id: 'note-a',
        table_id: TABLE_A,
        entries: {
            id: 'note-a',
            user_id: OTHER,
            restaurant_id: RESTAURANT,
            rating: 4.5,
            content: 'order the turbot',
            visited_at: '2026-08-24T20:00:00.000Z',
            created_at: '2026-08-24T19:00:00.000Z',
        },
        tables: { id: TABLE_A, name: 'Thursday table' },
        ...overrides,
    };
}

Deno.test('table_notes fixture: authorized shared note uses fn_visible_entry_ids with content required', async () => {
    const { client, queries, rpcs } = fakeClient({
        entry_tables: [tableShare()],
        profiles: [{ user_id: OTHER, display_name: 'Clara', avatar_url: 'avatar.jpg' }],
    }, ['note-a']);
    const rows = await loadTableNotes(
        client,
        VIEWER,
        RESTAURANT,
        [{ table_id: TABLE_A, member_id: OTHER }],
    );

    assertEquals(rows, [{
        entry_id: 'note-a',
        table_id: TABLE_A,
        table_name: 'Thursday table',
        author: { user_id: OTHER, display_name: 'Clara', avatar_url: 'avatar.jpg' },
        rating: 4.5,
        note: 'order the turbot',
        visited_at: '2026-08-24T20:00:00.000Z',
        created_at: '2026-08-24T19:00:00.000Z',
    }]);
    assertEquals(rpcs, [{
        name: 'fn_visible_entry_ids',
        args: {
            p_viewer: VIEWER,
            p_entry_ids: ['note-a'],
            p_require_content: true,
        },
    }]);
    const shareQuery = queries.find((query) => query.table === 'entry_tables')!;
    assert(shareQuery.select.includes('entries!inner'));
    assert(shareQuery.select.includes('tables(id, name)'));
    assert(!shareQuery.select.includes('entries.table_id'));
});

Deno.test('table_notes fixture: inaccessible tables, feed-only rows, self rows, and blank notes never become candidates', async () => {
    const { client, rpcs } = fakeClient({
        entry_tables: [
            tableShare({ table_id: TABLE_B }),
            tableShare({ entry_id: 'self', entries: { ...tableShare().entries, id: 'self', user_id: VIEWER } }),
            tableShare({ entry_id: 'blank', entries: { ...tableShare().entries, id: 'blank', content: '   ' } }),
        ],
        profiles: [],
    }, ['note-a']);
    const rows = await loadTableNotes(
        client,
        VIEWER,
        RESTAURANT,
        [{ table_id: TABLE_A, member_id: OTHER }],
    );

    assertEquals(rows, []);
    assertEquals(rpcs, []);
});

Deno.test('table_notes fixture: canonical gate includes private-account Table share and excludes either-direction blocks', async () => {
    const privateShared = tableShare({
        entry_id: 'private-shared',
        entries: { ...tableShare().entries, id: 'private-shared', account_privacy: 'private' },
    });
    const blocked = tableShare({
        entry_id: 'blocked',
        entries: { ...tableShare().entries, id: 'blocked', content: 'must not leak' },
    });
    const { client } = fakeClient({
        entry_tables: [privateShared, blocked],
        profiles: [{ user_id: OTHER, display_name: 'Clara', avatar_url: null }],
    }, ['private-shared']);
    const rows = await loadTableNotes(
        client,
        VIEWER,
        RESTAURANT,
        [{ table_id: TABLE_A, member_id: OTHER }],
    );

    assertEquals(rows.map((row) => row.entry_id), ['private-shared']);
});

Deno.test('table_notes fixture: multi-Table shares project only memberships and preserve the real edge', async () => {
    const shareA = tableShare({ table_id: TABLE_A, tables: { id: TABLE_A, name: 'A' } });
    const shareB = tableShare({ table_id: TABLE_B, tables: { id: TABLE_B, name: 'B' } });
    const { client } = fakeClient({
        entry_tables: [shareA, shareB],
        profiles: [{ user_id: OTHER, display_name: 'Clara', avatar_url: null }],
    }, ['note-a']);

    const onlyB = await loadTableNotes(
        client,
        VIEWER,
        RESTAURANT,
        [{ table_id: TABLE_B, member_id: OTHER }],
    );
    assertEquals(onlyB.map((row) => row.table_id), [TABLE_B]);
});

Deno.test('table_notes fixture: an author who left A but remains in B projects only under B', async () => {
    const shareA = tableShare({ table_id: TABLE_A, tables: { id: TABLE_A, name: 'A' } });
    const shareB = tableShare({ table_id: TABLE_B, tables: { id: TABLE_B, name: 'B' } });
    const { client, rpcs } = fakeClient({
        entry_tables: [shareA, shareB],
        profiles: [{ user_id: OTHER, display_name: 'Clara', avatar_url: null }],
    }, ['note-a']);

    const rows = await loadTableNotes(
        client,
        VIEWER,
        RESTAURANT,
        [
            { table_id: TABLE_A, member_id: CURRENT_A },
            { table_id: TABLE_B, member_id: OTHER },
        ],
    );

    assertEquals(rows.map((row) => row.table_id), [TABLE_B]);
    assertEquals(rpcs[0].args.p_entry_ids, ['note-a']);
});

Deno.test('restaurant page additions are byte-additive over untouched keys', () => {
    const recordedVisitsBytes = '[{"kind":"solo","id":"visit-a","entry_id":"visit-a","rating":4.5,"date":"2026-08-20T12:00:00.000Z","user_display_names":["Jacky"],"note":"charred leeks","is_self":true}]';
    const before = {
        visits: JSON.parse(recordedVisitsBytes),
        whos_been: [{ user_id: OTHER }],
        personal: { average: 4.5, visit_count: 1 },
        photos: { from_your_table: [], from_others: [] },
        distributions: { you: [0, 0, 0, 1, 0], your_table: null, napkin: [] },
        distributions_half: { you: [], your_table: null, napkin: [] },
        public_reviews: [],
        public_reviews_total: 0,
    };
    const after = appendPageProjections(before, { self_log: [], table_notes: [] });
    const { self_log: _selfLog, table_notes: _tableNotes, ...untouched } = after;

    assertEquals(JSON.stringify(before.visits), recordedVisitsBytes);
    assertEquals(JSON.stringify(after.visits), recordedVisitsBytes);
    assertEquals(JSON.stringify(untouched), JSON.stringify(before));
});

Deno.test('self_log keeps undated bare visits and record order after backdating', async () => {
    const old = entry({ id: 'old', created_at: '2026-08-01', visited_at: '2026-08-01' });
    const recent = entry({ id: 'recent', created_at: '2026-09-05', visited_at: null, rating: null, content: null });
    const first = await loadSelfLog(fakeClient({ entries: [old, recent] }).client, VIEWER, RESTAURANT);
    assertEquals(first.map((row) => row.entry_id), ['recent', 'old']);
    assertEquals(first[0].visited_at, null);
    assertEquals(first[0].created_at, '2026-09-05');
    assertEquals(first[0].is_bare, true);
    recent.visited_at = '2010-01-01';
    const second = await loadSelfLog(fakeClient({ entries: [old, recent] }).client, VIEWER, RESTAURANT);
    assertEquals(second.map((row) => row.entry_id), ['recent', 'old']);
    // A backdated (or today-dated) check-in is still bare: the date is metadata.
    assertEquals(second[0].is_bare, true);
});

Deno.test('bare advice includes legacy fields and other participants, allowing the author row', () => {
    const bare = { user_id: VIEWER, entry_participants: [{ user_id: VIEWER }] };
    assertEquals(isBareVisit(bare), true);
    for (const patch of [
        { photo_url: 'legacy.jpg' }, { entry_photos: [{ photo_url: 'photo.jpg' }] },
        { entry_tables: [{ entry_id: 'entry' }] }, { supper_id: 'supper' },
        { entry_participants: [{ user_id: OTHER }] }, { entry_companions: [{ user_id: OTHER }] },
        { value_rating: 4 }, { dish_description: 'leeks' },
    ]) assertEquals(isBareVisit({ ...bare, ...patch }), false);
    // A date is metadata, not enrichment (mirrors fn_visit_entry_result since 2026-09-06).
    assertEquals(isBareVisit({ ...bare, visited_at: '2020-01-01' }), true);
});
