import { enqueueImportReadyPush } from '../_shared/importPush.ts';
import { reportError } from '../_shared/report.ts';

type ReadyJob = { id: string; user_id: string; response?: { candidates?: unknown[] } };
// deno-lint-ignore no-explicit-any
export async function produceReadyNotice(supabase: any, job: ReadyJob,
    enqueue = enqueueImportReadyPush): Promise<void> {
    const { error: attemptError } = await supabase.from('background_import_jobs')
        .update({ notification_attempt_at: new Date().toISOString() })
        .eq('id', job.id).eq('user_id', job.user_id).eq('status', 'ready');
    if (attemptError) throw attemptError;
    await enqueue(supabase, { userId: job.user_id, jobId: job.id,
        readyCount: job.response?.candidates?.length ?? 0 });
    // Commit after both durable producers. A crash repeats their idempotent keys.
    const { error } = await supabase.from('background_import_jobs')
        .update({ notification_enqueued_at: new Date().toISOString() })
        .eq('id', job.id).eq('user_id', job.user_id).eq('status', 'ready');
    if (error) throw error;
}

// deno-lint-ignore no-explicit-any
export async function recoverReadyNotices(supabase: any, enqueue = enqueueImportReadyPush): Promise<void> {
    const { data, error } = await supabase.from('background_import_jobs')
        .select('id,user_id,response').eq('status', 'ready').is('notification_enqueued_at', null)
        .order('notification_attempt_at', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: true }).limit(100);
    if (error) throw error;
    for (const job of data ?? []) {
        try { await produceReadyNotice(supabase, job, enqueue); }
        catch (error) { reportError(error, { fn: 'background-imports', action: 'notice-recovery' }); }
    }
}
