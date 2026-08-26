import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
    loadVisibleEntryIds,
    type EntryVisibilityRpcClient,
} from './entryVisibility.ts';

const VIEWER = 'viewer-id';

type RpcArgs = {
    p_viewer: string;
    p_entry_ids: string[];
    p_require_content: boolean;
};

function fakeClient(
    visibleIds: string[] | ((args: RpcArgs) => string[]) = [],
    error: Error | null = null,
): { client: EntryVisibilityRpcClient; calls: Array<{ name: string; args: Record<string, unknown> }> } {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    return {
        calls,
        client: {
            rpc(name, args) {
                calls.push({ name, args });
                const resolvedIds = typeof visibleIds === 'function'
                    ? visibleIds(args)
                    : visibleIds;
                return Promise.resolve({
                    data: resolvedIds.map((entry_id) => ({ entry_id })),
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
    ], { requireContent: false });

    assertEquals([...visible], ['self-entry']);
    assertEquals(calls, []);
});

Deno.test('restaurant page visibility: aggregate and photos request separate content modes', async () => {
    const { client, calls } = fakeClient((args) =>
        args.p_require_content
            ? ['review-entry', 'not-requested']
            : ['silent-rating', 'review-entry', 'not-requested']
    );
    const candidates = [
        { entryId: 'silent-rating', authorId: 'author-a' },
        { entryId: 'silent-rating', authorId: 'author-a' },
        { entryId: 'review-entry', authorId: 'author-b' },
    ];

    const aggregateVisible = await loadVisibleEntryIds(
        client,
        VIEWER,
        candidates,
        { requireContent: false },
    );
    const photoVisible = await loadVisibleEntryIds(
        client,
        VIEWER,
        candidates,
        { requireContent: true },
    );

    assertEquals([...aggregateVisible], ['silent-rating', 'review-entry']);
    assertEquals([...photoVisible], ['review-entry']);
    assertEquals(calls, [
        {
            name: 'fn_visible_entry_ids',
            args: {
                p_viewer: VIEWER,
                p_entry_ids: ['silent-rating', 'review-entry'],
                p_require_content: false,
            },
        },
        {
            name: 'fn_visible_entry_ids',
            args: {
                p_viewer: VIEWER,
                p_entry_ids: ['silent-rating', 'review-entry'],
                p_require_content: true,
            },
        },
    ]);
});

Deno.test('restaurant page visibility: batch RPC errors fail closed', async () => {
    const { client } = fakeClient([], new Error('visibility lookup failed'));

    await assertRejects(
        () => loadVisibleEntryIds(client, VIEWER, [
            { entryId: 'other-entry', authorId: 'author-a' },
        ], { requireContent: true }),
        Error,
        'visibility lookup failed',
    );
});

Deno.test({
    name: 'restaurant page visibility SQL: private strangers and either-direction blocks are withheld while Tablemates remain',
    ignore: true,
    fn() {
        // Requires a migrated Postgres fixture: fn_visible_entry_ids is SECURITY
        // DEFINER and its account/block/Table/content-mode branches cannot be
        // simulated by the hermetic Edge Function client seam above.
    },
});
