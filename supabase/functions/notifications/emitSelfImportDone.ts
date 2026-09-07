import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { emitImportDone } from '../_shared/notify.ts';
import { expectedImportOwnerDecision } from '../resolve-url/_helpers.ts';

/** Self-directed lifecycle notices; recipient always comes from the verified JWT. */
export async function emitSelfImportDone(
    supabase: SupabaseClient,
    userId: string,
    body: Record<string, unknown>,
): Promise<{ status: number; payload: Record<string, unknown> }> {
    const reject = (status: number, code: string, message: string) => ({ status, payload: { error: { code, message } } });
    const owner = expectedImportOwnerDecision(body.expected_owner_id, userId);
    if (owner === 'invalid') return reject(400, 'INVALID_EXPECTED_OWNER', 'expected_owner_id must be a UUID');
    if (owner === 'mismatch') return reject(403, 'EXPECTED_OWNER_MISMATCH', 'Import belongs to a different signed-in account');
    if (body.kind !== 'import_done') return reject(400, 'INVALID_INPUT', "kind must be 'import_done'");
    const meta = (body.subject_meta ?? {}) as { job_id?: unknown; count?: unknown; outcome?: unknown };
    const outcome = meta.outcome;
    if (outcome !== 'review' && outcome !== 'failed') return reject(400, 'INVALID_INPUT', 'outcome must be review|failed');
    const rawCount = Number(meta.count);
    const count = Number.isFinite(rawCount) && rawCount > 0 ? Math.floor(rawCount) : 0;
    const jobId = typeof meta.job_id === 'string' ? meta.job_id : null;
    const emitted = await emitImportDone(supabase, { recipientUserId: userId, jobId, count, outcome, deduplicate: true });
    // Durable clients retry delivery, without rerunning perception or saving places.
    if (!emitted) return reject(503, 'NOTIFICATION_UNAVAILABLE', 'Could not record import notification');
    return { status: 200, payload: { data: { ok: true } } };
}
