import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
    filterVisibleEntrySignals,
    loadVisibleEntryIds,
    type EntryVisibilityRpcClient,
} from './entryVisibility.ts';

const VIEWER = 'viewer-id';

function fakeClient(
    visibleIds: string[] = [],
    error: Error | null = null,
): { client: EntryVisibilityRpcClient; calls: Array<{ name: string; args: Record<string, unknown> }> } {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    return {
        calls,
        client: {
            rpc(name, args) {
                calls.push({ name, args });
                return Promise.resolve({
                    data: visibleIds.map((entry_id) => ({ entry_id })),
                    error,
                });
            },
        },
    };
}

Deno.test('restaurant page visibility: self-only candidates skip the batch RPC', async () => {
    const { client, calls } = fakeClient();
    const visible = await loadVisibleEntryIds(client, VIEWER, [
        { entryId: 'self-entry', authorId: VIEWER },
    ]);

    assertEquals([...visible], ['self-entry']);
    assertEquals(calls, []);
});

Deno.test('restaurant page visibility: aggregate and photos share one deduplicated batch gate', async () => {
    const { client, calls } = fakeClient(['visible-entry', 'not-requested']);
    const visible = await loadVisibleEntryIds(client, VIEWER, [
        { entryId: 'self-entry', authorId: VIEWER },
        { entryId: 'visible-entry', authorId: 'author-a' },
        { entryId: 'visible-entry', authorId: 'author-a' },
        { entryId: 'withheld-entry', authorId: 'author-b' },
    ]);

    assertEquals([...visible], ['self-entry', 'visible-entry']);
    assertEquals(calls, [{
        name: 'fn_visible_entry_ids',
        args: {
            p_viewer: VIEWER,
            p_entry_ids: ['visible-entry', 'withheld-entry'],
        },
    }]);

    const signals = filterVisibleEntrySignals(
        visible,
        [
            { id: 'visible-entry', rating: 4.5 },
            { id: 'withheld-entry', rating: 2.0 },
        ],
        [
            { entry_id: 'visible-entry', photo_url: 'visible.jpg' },
            { entry_id: 'withheld-entry', photo_url: 'withheld.jpg' },
        ],
    );
    assertEquals(signals, {
        entries: [{ id: 'visible-entry', rating: 4.5 }],
        photos: [{ entry_id: 'visible-entry', photo_url: 'visible.jpg' }],
    });
});

Deno.test('restaurant page visibility: batch RPC errors fail closed', async () => {
    const { client } = fakeClient([], new Error('visibility lookup failed'));

    await assertRejects(
        () => loadVisibleEntryIds(client, VIEWER, [
            { entryId: 'other-entry', authorId: 'author-a' },
        ]),
        Error,
        'visibility lookup failed',
    );
});

Deno.test({
    name: 'restaurant page visibility SQL: private strangers and either-direction blocks are withheld while Tablemates remain',
    ignore: true,
    fn() {
        // Requires a migrated Postgres fixture: fn_visible_entry_ids is SECURITY
        // DEFINER and its account/block/Table branches cannot be simulated by
        // the hermetic Edge Function client seam above.
    },
});
