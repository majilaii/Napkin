export interface BackgroundImportJob {
    id: string;
    user_id: string;
    import_nonce: string;
    request: Record<string, unknown>;
    status: string;
    attempts: number;
    lease_token: string;
}

interface WorkerOptions {
    // Supabase query builders are supplied by the service-role client or tests.
    // deno-lint-ignore no-explicit-any
    supabase: any;
    jobId?: string;
}

/**
 * TICKET-248: the phone owns every share. The resolver could not read TikTok or
 * Instagram media, and a server result the current app no longer consumes could
 * still send "your import is ready" for a job the phone already handled. A job
 * still pending (a failed enqueue handoff, or one queued before this deploy) is
 * handed to its device: no paid extraction, never a server-side ready result.
 * Persisted leases keep the immediate kick and the scheduled rescue safe.
 */
export async function drainBackgroundImports(options: WorkerOptions): Promise<{ processed: number }> {
    const { supabase, jobId } = options;
    const { data, error } = await supabase.rpc('fn_claim_background_imports', {
        p_job_id: jobId ?? null, p_limit: jobId ? 1 : 5,
    });
    if (error) throw new Error(`Background import claim failed: ${error.message}`);
    const jobs = (data ?? []) as BackgroundImportJob[];
    await Promise.all(jobs.map(async (job) => {
        const { error: finishError } = await supabase.rpc('fn_finish_background_import', {
            p_job_id: job.id, p_lease_token: job.lease_token, p_status: 'needs_device',
            p_response: null, p_reason: 'device_owns_import', p_retry_seconds: 30,
        });
        if (finishError) throw new Error(`Background import completion failed: ${finishError.message}`);
    }));
    return { processed: jobs.length };
}
