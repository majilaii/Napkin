import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { loadReviewPhotos } from './reviewPhotos.ts';

Deno.test('review photo enrichment uses only eligible IDs, real columns/order, and retains a legacy hero', async () => {
    const calls: unknown[] = [];
    const db = { from(table: string) {
        const result = { data: table === 'entries' ? [{ id: 'eligible', photo_url: 'legacy' }] : [
            { entry_id: 'eligible', photo_url: 'first' }, { entry_id: 'eligible', photo_url: 'second' },
            { entry_id: 'eligible', photo_url: 'first' },
        ], error: null };
        const query = {
            select(columns: string) { calls.push([table, 'select', columns]); return query; },
            in(column: string, ids: string[]) { calls.push([table, 'in', column, ids]); return query; },
            order(column: string, opts: unknown) { calls.push([table, 'order', column, opts]); return query; },
            then: Promise.resolve(result).then.bind(Promise.resolve(result)),
        };
        return query;
    } };
    const photos = await loadReviewPhotos(db, ['eligible']);
    assertEquals(photos.get('eligible'), ['legacy', 'first', 'second']);
    assertEquals(calls, [
        ['entry_photos','select','entry_id, photo_url'], ['entry_photos','in','entry_id',['eligible']],
        ['entry_photos','order','sort_order',{ascending:true}], ['entry_photos','order','id',{ascending:true}],
        ['entries','select','id, photo_url'], ['entries','in','id',['eligible']],
    ]);
    calls.length = 0;
    assertEquals((await loadReviewPhotos(db, [])).size, 0);
    assertEquals(calls, []);
});

Deno.test('review photos read failure surfaces as a failed page instead of silently hiding photos', async () => {
    const query = { select: () => query, in: () => query, order: () => query,
        then: Promise.resolve({ error: new Error('photo read failed') }).then.bind(Promise.resolve({ error: new Error('photo read failed') })) };
    await assertRejects(() => loadReviewPhotos({ from: () => query }, ['eligible']), Error, 'photo read failed');
});
