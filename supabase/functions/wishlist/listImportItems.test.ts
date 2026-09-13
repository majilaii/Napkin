import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { listImportItems } from './listImportItems.ts';

const OWNER = 'owner-a';
const JOB = 'job-a';
const TIKTOK = { type: 'tiktok', url: 'https://vm.tiktok.com/example/' };

function fixture(options: {
    job?: Record<string, unknown> | null;
    items?: Array<Record<string, unknown>>;
    checks?: Array<Record<string, unknown>>;
    errorTable?: string;
} = {}) {
    const calls: Array<{ table: string; operations: Array<[string, ...unknown[]]> }> = [];
    const supabase = {
        from(table: string) {
            const call = { table, operations: [] as Array<[string, ...unknown[]]> };
            calls.push(call);
            const result = () => ({
                data: table === 'import_jobs'
                    ? ('job' in options ? options.job : { job_id: JOB, source: null, status: 'resolved' })
                    : table === 'wishlist_items' ? options.items ?? [] : options.checks ?? [],
                error: options.errorTable === table ? new Error('database unavailable') : null,
            });
            const chain: Record<string, unknown> = {};
            for (const op of ['select', 'eq', 'is', 'order', 'limit']) {
                chain[op] = (...args: unknown[]) => { call.operations.push([op, ...args]); return chain; };
            }
            chain.maybeSingle = async () => result();
            chain.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
                Promise.resolve(result()).then(resolve, reject);
            return chain;
        },
    };
    return { supabase, calls };
}

Deno.test('source recovery survives a checks-only job and scopes every service-role read', async () => {
    const { supabase, calls } = fixture({ checks: [{ source: { ...TIKTOK, private_debug: 'never return' } }] });
    const result = await listImportItems(supabase, OWNER, JOB);
    assertEquals(result?.job.source, TIKTOK);
    assertEquals(result?.items, []);
    for (const call of calls) {
        assertEquals(call.operations.filter(([op]) => op === 'eq'), call.table === 'restaurant_completeness_queue'
            ? [['eq', 'owner_id', OWNER], ['eq', 'job_id', JOB]]
            : call.table === 'import_jobs'
            ? [['eq', 'job_id', JOB], ['eq', 'user_id', OWNER]]
            : [['eq', 'user_id', OWNER], ['eq', 'job_id', JOB]]);
    }
    assertEquals(calls[2].operations.find(([op]) => op === 'select'), ['select', 'source:client_facts->source']);
    assertEquals(calls[2].operations.find(([op]) => op === 'limit'), ['limit', 51]);
    assertEquals(calls[1].operations.find(([op]) => op === 'is'), ['is', 'deleted_at', null]);
});

Deno.test('missing or non-owned job stops before any source or item read', async () => {
    const { supabase, calls } = fixture({ job: null });
    assertEquals(await listImportItems(supabase, OWNER, JOB), null);
    assertEquals(calls.length, 1);
});

Deno.test('existing job source remains authoritative without a fallback query', async () => {
    const { supabase, calls } = fixture({ job: { job_id: JOB, source: TIKTOK }, items: [{ id: 'item', source: TIKTOK }] });
    const result = await listImportItems(supabase, OWNER, JOB);
    assertEquals(result?.job.source, TIKTOK);
    assertEquals(result?.items, [{ id: 'item' }]);
    assertEquals(calls.length, 2);
});

Deno.test('queue retains original source after a pin changes and repeats are unambiguous', async () => {
    const { supabase } = fixture({
        checks: [{ source: TIKTOK }, { source: TIKTOK }],
        items: [{ id: 'item', source: { type: 'web', url: 'https://example.com/newer' } }],
    });
    assertEquals((await listImportItems(supabase, OWNER, JOB))?.job.source, TIKTOK);
});

Deno.test('saved item sources recover a legacy job without queue provenance', async () => {
    const { supabase } = fixture({ items: [{ id: 'item', source: TIKTOK }] });
    assertEquals((await listImportItems(supabase, OWNER, JOB))?.job.source, TIKTOK);
});

Deno.test('conflicting sources do not select an arbitrary original', async () => {
    for (const key of ['checks', 'items'] as const) {
        const { supabase } = fixture({ [key]: [
            { source: TIKTOK },
            { source: { type: 'tiktok', url: 'https://vm.tiktok.com/other/' } },
        ] });
        assertEquals((await listImportItems(supabase, OWNER, JOB))?.job.source, null);
    }
});

Deno.test('truncated source samples stay hidden even when the visible portion agrees', async () => {
    const { supabase } = fixture({ checks: Array.from({ length: 51 }, () => ({ source: TIKTOK })) });
    assertEquals((await listImportItems(supabase, OWNER, JOB))?.job.source, null);
});

Deno.test('local and malformed sources never become external actions', async () => {
    const { supabase } = fixture({ checks: [
        { source: { type: 'video' } },
        { source: { type: 'tiktok', url: 'https://tiktok.com.evil.example/' } },
        { source: { type: 'web', url: 'file:///private/clip.mp4' } },
        { source: { type: 'web', url: 'https://user:secret@example.com' } },
    ] });
    assertEquals((await listImportItems(supabase, OWNER, JOB))?.job.source, null);
});

Deno.test('optional source lookup failure preserves usable review details', async () => {
    const { supabase } = fixture({ errorTable: 'restaurant_completeness_queue', items: [{ id: 'item' }] });
    const result = await listImportItems(supabase, OWNER, JOB);
    assertEquals(result?.items, [{ id: 'item' }]);
    assertEquals(result?.job.source, null);
});

Deno.test('required read errors are not reported as empty successful clips', async () => {
    for (const errorTable of ['import_jobs', 'wishlist_items']) {
        const { supabase } = fixture({ errorTable });
        await assertRejects(() => listImportItems(supabase, OWNER, JOB), Error, 'database unavailable');
    }
});
