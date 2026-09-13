import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { emitImportDone } from './notify.ts';

type Delivery = {
    id: string; user_id: string; job_id: string; installation_id: string;
    ready_count: number; expo_push_token: string; sent_token: string | null;
    ticket_id: string | null; attempts: number; created_at: string;
};
type ExpoResult = { status?: string; id?: string; details?: { error?: string } };
const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const RETRY_LIMIT = 8;

/** Generic lock-screen copy. No source URL, restaurant name, or account name. */
export function importReadyPushMessage(delivery: Delivery) {
    return {
        to: delivery.expo_push_token,
        title: 'Your import is ready',
        body: 'Open Napkin to review your spots.',
        data: {
            kind: 'import_ready', url: `/import-progress?openJob=${delivery.job_id}&outcome=review&owner=${delivery.user_id}`,
            job_id: delivery.job_id, owner_id: delivery.user_id,
            ready_count: delivery.ready_count,
        },
        channelId: 'imports', sound: 'default', ttl: 3600,
        collapseId: `import:${delivery.job_id}`, tag: `import:${delivery.job_id}`,
    };
}

/** Internal producer only. The durable job, not caller-supplied text, establishes
 * that a real import owned by this recipient has reached review. No autopinning. */
export async function enqueueImportReadyPush(
    supabase: SupabaseClient,
    input: { userId: string; jobId: string; readyCount: number },
): Promise<number> {
    const job = await supabase.from('background_import_jobs').select('id,user_id,installation_id,status,response')
        .eq('id', input.jobId).eq('user_id', input.userId).maybeSingle();
    if (job.error) throw new Error('IMPORT_PUSH_JOB_READ_FAILED');
    const candidates = job.data?.response?.candidates;
    if (job.data?.status !== 'ready' || !Array.isArray(candidates) || candidates.length === 0) return 0;
    const count = Math.min(candidates.length, 1000, Math.floor(input.readyCount));
    if (!Number.isFinite(count) || count < 1) return 0;
    const emitted = await emitImportDone(supabase, {
        recipientUserId: input.userId, jobId: input.jobId, count,
        outcome: 'review', deduplicate: true,
    });
    if (!emitted) throw new Error('IMPORT_PUSH_INBOX_FAILED');
    // Review state belongs to the installation that captured this import. A
    // different signed-in device cannot open that local review queue entry.
    if (!job.data.installation_id) return 0;
    const devices = await supabase.from('import_push_devices').select('installation_id').eq('user_id', input.userId)
        .eq('installation_id', job.data.installation_id)
        .not('session_id', 'is', null).not('expo_push_token', 'is', null);
    if (devices.error) throw new Error('IMPORT_PUSH_DEVICE_READ_FAILED');
    if (!devices.data?.length) return 0;
    const { error } = await supabase.from('import_push_deliveries').upsert(devices.data.map(device => ({
        installation_id: device.installation_id, user_id: input.userId,
        job_id: input.jobId, ready_count: count,
    })), { onConflict: 'job_id,installation_id', ignoreDuplicates: true });
    if (error) throw new Error('IMPORT_PUSH_ENQUEUE_FAILED');
    return devices.data.length;
}

async function postExpo(url: string, body: unknown, fetcher: typeof fetch): Promise<Record<string, unknown>> {
    const accessToken = Deno.env.get('EXPO_PUSH_ACCESS_TOKEN');
    const response = await fetcher(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`EXPO_HTTP_${response.status}`);
    const result = await response.json();
    if (result.errors?.length) throw new Error('EXPO_REQUEST_REJECTED');
    return result;
}

async function updateDelivery(supabase: SupabaseClient, row: Delivery, values: Record<string, unknown>) {
    // Attempt is the claim generation, so an expired worker cannot clobber a retry.
    const { error } = await supabase.from('import_push_deliveries').update({ locked_at: null, ...values })
        .eq('id', row.id).eq('status', 'sending').eq('attempts', row.attempts);
    if (error) throw new Error('IMPORT_PUSH_CHECKPOINT_FAILED');
}

async function failOrRetry(supabase: SupabaseClient, row: Delivery, code: string, terminal = false) {
    await updateDelivery(supabase, row, {
        status: terminal || row.attempts >= RETRY_LIMIT ? 'failed' : (row.ticket_id ? 'ticketed' : 'pending'),
        next_attempt_at: new Date(Date.now() + Math.min(3600, 30 * 2 ** row.attempts) * 1000).toISOString(),
        last_error: code,
    });
}

async function handleExpoError(supabase: SupabaseClient, row: Delivery, code: string) {
    if (code === 'DeviceNotRegistered') {
        // A receipt for a rotated token must not disable the replacement token.
        const { error } = await supabase.from('import_push_devices').update({ session_id: null, expo_push_token: null })
            .eq('installation_id', row.installation_id).eq('user_id', row.user_id)
            .eq('expo_push_token', row.sent_token ?? row.expo_push_token);
        if (error) throw new Error('IMPORT_PUSH_TOKEN_INVALIDATION_FAILED');
        await failOrRetry(supabase, row, code, true);
        return;
    }
    const terminal = ['MessageTooBig', 'InvalidCredentials', 'MismatchSenderId'].includes(code);
    // A receipt-level rate rejection is safe to resubmit with backoff.
    if (row.ticket_id && code === 'MessageRateExceeded') {
        await updateDelivery(supabase, row, {
            status: row.attempts >= RETRY_LIMIT ? 'failed' : 'pending', ticket_id: null,
            next_attempt_at: new Date(Date.now() + 60 * 2 ** row.attempts * 1000).toISOString(),
            last_error: code,
        });
        return;
    }
    await failOrRetry(supabase, row, code, terminal);
}

/** Called after completion and by the scheduled import drain. Sends at most one
 * batch (25 messages) and checks receipts at least 15 minutes after acceptance.
 * Expo acceptance and APNs/FCM receipt success are not proof of device delivery. */
export async function dispatchImportPushes(
    supabase: SupabaseClient,
    options: { fetcher?: typeof fetch; limit?: number } = {},
): Promise<{ claimed: number; ticketed: number; receipts: number }> {
    const { data, error } = await supabase.rpc('fn_claim_import_push_deliveries', { p_limit: options.limit ?? 25 });
    if (error) throw new Error('IMPORT_PUSH_CLAIM_FAILED');
    const rows = (data ?? []) as Delivery[];
    const summary = { claimed: rows.length, ticketed: 0, receipts: 0 };
    if (!rows.length) return summary;
    const fetcher = options.fetcher ?? fetch;
    const jobs = await supabase.from('background_import_jobs').select('id,user_id,installation_id,status').in('id', rows.map(r => r.job_id));
    const devices = await supabase.from('import_push_devices').select('installation_id,user_id,expo_push_token')
        .in('installation_id', rows.map(r => r.installation_id)).not('session_id', 'is', null);
    if (jobs.error || devices.error) {
        for (const row of rows) await failOrRetry(supabase, row, 'OWNER_RECHECK_FAILED');
        return summary;
    }
    const valid: Delivery[] = [];
    for (const row of rows) {
        const owned = devices.data?.some(d => d.installation_id === row.installation_id && d.user_id === row.user_id && d.expo_push_token === row.expo_push_token);
        const ready = jobs.data?.some(j => j.id === row.job_id && j.user_id === row.user_id &&
            j.installation_id === row.installation_id && j.status === 'ready');
        // Receipt processing never emits new notifications, and must still check
        // provider errors after the person has acknowledged the job.
        if (!owned || (!row.ticket_id && !ready)) {
            await updateDelivery(supabase, row, { status: 'cancelled' });
        } else valid.push(row);
    }
    const sends = valid.filter(r => !r.ticket_id);
    if (sends.length) {
        try {
            const result = await postExpo(SEND_URL, sends.map(importReadyPushMessage), fetcher);
            const tickets = Array.isArray(result.data) ? result.data as ExpoResult[] : [];
            for (let i = 0; i < sends.length; i++) {
                const row = sends[i], ticket = tickets[i];
                if (ticket?.status === 'ok' && typeof ticket.id === 'string') {
                    await updateDelivery(supabase, row, {
                        status: 'ticketed', ticket_id: ticket.id, sent_token: row.expo_push_token,
                        next_attempt_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(), last_error: null,
                    });
                    summary.ticketed++;
                } else await handleExpoError(supabase, row, ticket?.details?.error ?? 'EXPO_INVALID_TICKET');
            }
        } catch (error) {
            const code = error instanceof Error && /^EXPO_[A-Z0-9_]+$/.test(error.message) ? error.message : 'EXPO_SEND_FAILED';
            for (const row of sends) await failOrRetry(supabase, row, code, /^EXPO_HTTP_4(?!29)/.test(code));
        }
    }
    const checks = valid.filter(r => r.ticket_id);
    if (checks.length) {
        try {
            const result = await postExpo(RECEIPTS_URL, { ids: checks.map(r => r.ticket_id) }, fetcher);
            const receipts = (result.data ?? {}) as Record<string, ExpoResult>;
            for (const row of checks) {
                const receipt = receipts[row.ticket_id!];
                if (receipt?.status === 'ok') {
                    await updateDelivery(supabase, row, { status: 'delivered', last_error: null });
                    summary.receipts++;
                } else if (receipt?.status === 'error') {
                    await handleExpoError(supabase, row, receipt.details?.error ?? 'EXPO_RECEIPT_REJECTED');
                } else await failOrRetry(supabase, row, 'EXPO_RECEIPT_PENDING');
            }
        } catch {
            for (const row of checks) await failOrRetry(supabase, row, 'EXPO_RECEIPT_FETCH_FAILED');
        }
    }
    return summary;
}
