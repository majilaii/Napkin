import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { recoverReadyNotices } from './notifications.ts';

function fixture(completed: number, waiting: number) {
    const rows = Array.from({ length: completed + waiting }, (_, id) => ({
        id: String(id), user_id: 'owner', status: 'ready', response: { candidates: [{}] },
        notification_enqueued_at: id < completed ? '2026-09-12' : null as string | null,
        notification_attempt_at: null as string | null,
    }));
    const supabase = { from: () => {
        let result = [...rows]; let patch: object | undefined;
        const builder = {
            select: () => builder,
            update: (value: object) => { patch = value; return builder; },
            eq: (key: string, value: unknown) => {
                result = result.filter(row => row[key as keyof typeof row] === value); return builder;
            },
            is: (key: string, value: unknown) => builder.eq(key, value),
            order: (key: string) => {
                if (key === 'notification_attempt_at') result.sort((a, b) =>
                    (a.notification_attempt_at ?? '').localeCompare(b.notification_attempt_at ?? ''));
                return builder;
            },
            limit: (limit: number) => { result = result.slice(0, limit); return builder; },
            then: (resolve: (result: unknown) => unknown) => {
                if (patch) result.forEach(row => Object.assign(row, patch));
                return Promise.resolve(resolve({ data: result, error: null }));
            },
        }; return builder;
    } };
    return { rows, supabase };
}

Deno.test('notice recovery reaches the 101st job after older ready jobs were already produced', async () => {
    const f = fixture(100, 1); const produced: string[] = [];
    await recoverReadyNotices(f.supabase, async (_db, job) => { produced.push(job.jobId); return 0; });
    assertEquals(produced, ['100']);
    assertEquals(!!f.rows[100].notification_enqueued_at, true);
});

Deno.test('failed notice production rotates behind untried jobs and retains retry state', async () => {
    const f = fixture(0, 101); const produced: string[] = [];
    const enqueue: Parameters<typeof recoverReadyNotices>[1] = async (_db, job) => {
        if (job.jobId === '0') throw new Error('fixture outage');
        produced.push(job.jobId); return 0;
    };
    await recoverReadyNotices(f.supabase, enqueue);
    assertEquals(f.rows[0].notification_enqueued_at, null);
    assertEquals(!!f.rows[0].notification_attempt_at, true);
    await recoverReadyNotices(f.supabase, enqueue);
    assertEquals(produced.at(-1), '100');
});
