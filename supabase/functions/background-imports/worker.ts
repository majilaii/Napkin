import { reportError } from '../_shared/report.ts';

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
    url: string;
    serviceKey: string;
    internalSecret: string;
    jobId?: string;
    fetcher?: typeof fetch;
    notifyReady?: (job: BackgroundImportJob, count: number) => Promise<void>;
}

/** Persisted leases make both the immediate kick and scheduled rescue safe. */
export async function drainBackgroundImports(options: WorkerOptions): Promise<{ processed: number }> {
    const { supabase, url, serviceKey, internalSecret, jobId, notifyReady } = options;
    if (!internalSecret || !serviceKey) throw new Error('Background import resolver is not configured');
    const { data, error } = await supabase.rpc('fn_claim_background_imports', {
        p_job_id: jobId ?? null, p_limit: jobId ? 1 : 2,
    });
    if (error) throw new Error(`Background import claim failed: ${error.message}`);
    const jobs = (data ?? []) as BackgroundImportJob[];
    await Promise.all(jobs.map(async (job) => {
        let status: 'pending' | 'ready' | 'needs_device' | 'failed' = 'pending';
        let result: Record<string, unknown> | null = null;
        let reason = 'temporarily_unavailable';
        try {
            const response = await (options.fetcher ?? fetch)(`${url}/functions/v1/resolve-url?action=resolve_background`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}`,
                    apikey: serviceKey, 'x-internal-secret': internalSecret },
                body: JSON.stringify({ action: 'resolve_background', job_id: job.id, lease_token: job.lease_token }),
                signal: AbortSignal.timeout(60_000),
            });
            if (!response.ok) {
                // Auth/deployment/transient failures retry. A malformed source remains
                // recoverable on device; no server result is invented from an error.
                if ([400, 404, 422].includes(response.status)) {
                    status = 'needs_device';
                    reason = 'perception_required';
                }
            } else {
                const payload = (await response.json())?.data;
                if (payload?.state === 'needs_device') {
                    status = 'needs_device';
                    reason = typeof payload.reason === 'string' ? payload.reason.slice(0, 100) : 'perception_required';
                } else if (payload?.state === 'ready' && Array.isArray(payload.result?.candidates)
                    && payload.result.candidates.length > 0 && payload.result.candidates.length <= 20) {
                    status = 'ready';
                    result = payload.result;
                    reason = '';
                }
            }
        } catch {
            // A crashed or timed-out request may have consumed provider budget.
            // The bounded lease attempts cap replays and never create duplicate saves.
        }
        if (status === 'pending' && job.attempts >= 3) status = 'failed';
        const { data: finished, error: finishError } = await supabase.rpc('fn_finish_background_import', {
            p_job_id: job.id, p_lease_token: job.lease_token, p_status: status,
            p_response: result, p_reason: reason || null,
            p_retry_seconds: Math.min(300, 30 * 2 ** (job.attempts - 1)),
        });
        if (finishError) throw new Error(`Background import completion failed: ${finishError.message}`);
        // A cancelled job or superseded lease cannot notify from stale work.
        if (finished === true && status === 'ready' && notifyReady) {
            try { await notifyReady(job, (result!.candidates as unknown[]).length); }
            catch (error) { reportError(error, { fn: 'background-imports', action: 'ready-notification' }); }
        }
    }));
    return { processed: jobs.length };
}
