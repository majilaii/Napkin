import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { validateUrl } from '../_shared/urlValidation.ts';
import { timingSafeSecretEqual } from '../_shared/completeness.ts';
import { reportError } from '../_shared/report.ts';
import { drainBackgroundImports } from './worker.ts';
import { dispatchImportPushes } from '../_shared/importPush.ts';
import { produceReadyNotice, recoverReadyNotices } from './notifications.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^nbi_[0-9a-f]{64}$/;
const JOB_COLUMNS = 'id,user_id,import_nonce,request,status,response,reason,created_at,updated_at';
type Environment = (name: string) => string | undefined;
interface Dependencies {
    // deno-lint-ignore no-explicit-any
    supabase?: any;
    env?: Environment;
    defer?: (promise: Promise<unknown>) => void;
    drain?: typeof drainBackgroundImports;
}
function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify({ data }), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
function failure(code: string, status: number): Response {
    return new Response(JSON.stringify({ error: { code, message: code.toLowerCase().replaceAll('_', ' ') } }),
        { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
export async function hashCredential(token: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
function mintToken(): string {
    return 'nbi_' + Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
}
function verifiedSessionId(jwt: string): string | null {
    try {
        const claims = JSON.parse(atob(jwt.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
        return typeof claims.session_id === 'string' && UUID.test(claims.session_id) ? claims.session_id : null;
    } catch { return null; }
}
async function readBody(req: Request): Promise<Record<string, unknown>> {
    const reader = req.body?.getReader();
    if (!reader) return {};
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > 65536) { await reader.cancel(); throw new Error('BODY_TOO_LARGE'); }
        chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = JSON.parse(new TextDecoder().decode(bytes) || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('INVALID_BODY');
    return body;
}
// deno-lint-ignore no-explicit-any
function publicJob(job: any) {
    return { job_id: job.id, owner_id: job.user_id, import_nonce: job.import_nonce,
        url: job.request?.url, status: job.status, result: job.status === 'ready' ? job.response : null,
        reason: job.reason, created_at: job.created_at };
}

export function createBackgroundImportsHandler(deps: Dependencies = {}) {
    const env = deps.env ?? ((name: string) => Deno.env.get(name));
    return async (req: Request): Promise<Response> => {
        if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
        if (req.method !== 'POST') return failure('METHOD_NOT_ALLOWED', 405);
        const url = env('SUPABASE_URL');
        const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
        if (!url || !serviceKey) return failure('MISCONFIGURED', 503);
        let body: Record<string, unknown>;
        try { body = await readBody(req); } catch { return failure('INVALID_BODY', 400); }
        const queryAction = new URL(req.url).searchParams.get('action');
        if (queryAction && body.action && queryAction !== body.action) return failure('INVALID_ACTION', 400);
        const action = queryAction ?? body.action;
        const supabase = deps.supabase ?? createClient(url, serviceKey);
        const defer = deps.defer ?? ((promise: Promise<unknown>) => {
            // deno-lint-ignore no-explicit-any
            (globalThis as any).EdgeRuntime?.waitUntil?.(promise);
        });
        const run = async (jobId?: string) => {
            const result = await (deps.drain ?? drainBackgroundImports)({
                supabase, url, serviceKey, internalSecret: env('INTERNAL_CALL_SECRET') ?? '', jobId,
                notifyReady: async (job, count) => {
                    await produceReadyNotice(supabase, { ...job, response: { candidates: Array(count) } });
                },
            });
            // Rescue a crash after ready was committed but before notifications were
            // enqueued. Delivery keys and inbox ids make repeated producers harmless.
            if (!jobId) {
                await recoverReadyNotices(supabase);
            }
            await dispatchImportPushes(supabase);
            return result;
        };
        try {
            if (action === 'drain') {
                // Reuse the existing scheduled-worker two-factor credential pair.
                if (!timingSafeSecretEqual(req.headers.get('x-completeness-cron'), env('COMPLETENESS_CRON_SECRET'))
                    || !timingSafeSecretEqual(req.headers.get('apikey'), env('COMPLETENESS_SERVICE_ROLE_KEY'))) {
                    return failure('UNAUTHORIZED', 401);
                }
                return json(await run());
            }
            const bearer = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
            let ownerId: string | undefined;
            let credentialId: string | null = null;
            if (TOKEN.test(bearer)) {
                if (action !== 'enqueue' && action !== 'wake' && action !== 'revoke_intake') return failure('FORBIDDEN', 403);
                const { data, error } = await supabase.from('background_import_credentials')
                    .select('id,user_id').eq('token_hash', await hashCredential(bearer))
                    .is('revoked_at', null).gt('expires_at', new Date().toISOString()).maybeSingle();
                if (error) return failure('TEMPORARILY_UNAVAILABLE', 503);
                if (!data) return failure('UNAUTHORIZED', 401);
                ownerId = data.user_id;
                credentialId = data.id;
            } else {
                if (!bearer) return failure('UNAUTHORIZED', 401);
                const { data, error } = await supabase.auth.getUser(bearer);
                if (error || !data?.user?.id) return failure('UNAUTHORIZED', 401);
                ownerId = data.user.id;
            }
            if (body.expected_owner_id && body.expected_owner_id !== ownerId) return failure('OWNER_CHANGED', 403);

            if (action === 'register_intake') {
                if (typeof body.installation_id !== 'string' || !UUID.test(body.installation_id)) return failure('INVALID_INSTALLATION', 400);
                const sessionId = verifiedSessionId(bearer); // only after auth.getUser verified the JWT
                if (!sessionId) return failure('UNAUTHORIZED', 401);
                // Bound credential creation separately from paid processing.
                const { data: rate, error: rateError } = await supabase.rpc('check_and_increment_rate_limit', {
                    p_user_id: ownerId, p_bucket_key: 'import_intake_registration', p_max: 20, p_window_seconds: 3600,
                });
                if (rateError || !rate?.[0]?.allowed) return failure('RATE_LIMITED', 429);
                const token = mintToken();
                const expiresAt = new Date(Date.now() + 90 * 86400_000).toISOString();
                const { data, error } = await supabase.from('background_import_credentials').insert({
                    user_id: ownerId, session_id: sessionId, installation_id: body.installation_id,
                    token_hash: await hashCredential(token), expires_at: expiresAt,
                }).select('id').single();
                if (error) return failure('TEMPORARILY_UNAVAILABLE', 503);
                if (typeof body.previous_credential === 'string' && TOKEN.test(body.previous_credential)) {
                    // Possession can revoke only that prior credential, never read its owner/data.
                    const { error: revokeError } = await supabase.from('background_import_credentials')
                        .update({ revoked_at: new Date().toISOString() })
                        .eq('token_hash', await hashCredential(body.previous_credential));
                    if (revokeError) return failure('TEMPORARILY_UNAVAILABLE', 503);
                }
                return json({ credential_id: data.id, token, expires_at: expiresAt });
            }
            if (action === 'revoke_intake') {
                const id = credentialId ?? body.credential_id;
                if (typeof id !== 'string' || !UUID.test(id)) return failure('INVALID_CREDENTIAL', 400);
                const { error } = await supabase.from('background_import_credentials')
                    .update({ revoked_at: new Date().toISOString() }).eq('id', id).eq('user_id', ownerId);
                return error ? failure('TEMPORARILY_UNAVAILABLE', 503) : json({ revoked: true });
            }
            if (action === 'wake') {
                // TICKET-248: the share extension's background upload exists only
                // so iOS relaunches Napkin to process the share on the device when
                // it completes. Authenticate and answer; nothing is stored or run.
                if (typeof body.job_id !== 'string' || !UUID.test(body.job_id)
                    || body.expected_owner_id !== ownerId) return failure('INVALID_IMPORT', 400);
                return json({ job_id: body.job_id, status: 'wake' });
            }
            if (action === 'enqueue') {
                if (typeof body.job_id !== 'string' || !UUID.test(body.job_id)
                    || typeof body.import_nonce !== 'string' || !UUID.test(body.import_nonce)
                    || typeof body.url !== 'string' || body.url.length > 4096
                    || body.protocol_generation !== 'v2' || body.expected_owner_id !== ownerId) return failure('INVALID_IMPORT', 400);
                const validated = validateUrl(body.url);
                if (!validated.ok) return failure('INVALID_URL', 400);
                // URL-only intake. Native evidence keeps its existing owner-JWT path.
                const request = { url: body.url.trim(), protocol_generation: 'v2' };
                const { data, error } = await supabase.rpc('fn_enqueue_background_import', {
                    p_owner: ownerId, p_job_id: body.job_id, p_import_nonce: body.import_nonce,
                    p_request: request, p_credential_id: credentialId,
                    p_installation_id: typeof body.installation_id === 'string' && UUID.test(body.installation_id)
                        ? body.installation_id : null,
                });
                if (error) {
                    if (error.code === '42501') return failure('FORBIDDEN', 403);
                    if (error.code === '23505') return failure('NONCE_REUSE', 409);
                    if (/IMPORT_RATE_LIMITED|IMPORT_QUEUE_FULL/.test(error.message)) return failure('RATE_LIMITED', 429);
                    return failure('TEMPORARILY_UNAVAILABLE', 503);
                }
                if (data.status === 'pending') {
                    // TICKET-248: the phone owns every share. The worker cannot read
                    // TikTok/Instagram media, and a pending job made installed builds
                    // wait for it (for hours when the first attempt failed).
                    // needs_device sends them straight to on-device processing,
                    // including when this upload wakes the app in the background.
                    const { error: handoffError } = await supabase.from('background_import_jobs')
                        .update({ status: 'needs_device', reason: 'device_owns_import', updated_at: new Date().toISOString() })
                        .eq('id', data.id).eq('user_id', ownerId).eq('status', 'pending');
                    if (handoffError) {
                        // The job stays pending: the scheduled worker is the fallback.
                        defer(run(data.id).catch(error => reportError(error, { fn: 'background-imports', action: 'kick' })));
                        return json({ job_id: data.id, status: data.status }, 202);
                    }
                    return json({ job_id: data.id, status: 'needs_device' }, 202);
                }
                return json({ job_id: data.id, status: data.status }, 202);
            }
            if (action === 'list') {
                const { data, error } = await supabase.from('background_import_jobs').select(JOB_COLUMNS)
                    .eq('user_id', ownerId).not('status', 'in', '(dismissed,acknowledged)')
                    .order('created_at', { ascending: false }).limit(100);
                return error ? failure('TEMPORARILY_UNAVAILABLE', 503) : json({ jobs: (data ?? []).map(publicJob) });
            }
            if (['status', 'dismiss', 'acknowledge', 'retry'].includes(String(action))) {
                if (typeof body.job_id !== 'string' || !UUID.test(body.job_id)) return failure('INVALID_JOB', 400);
                if (action === 'status') {
                    const { data, error } = await supabase.from('background_import_jobs').select(JOB_COLUMNS)
                        .eq('id', body.job_id).eq('user_id', ownerId).maybeSingle();
                    if (error) return failure('TEMPORARILY_UNAVAILABLE', 503);
                    return data ? json(publicJob(data)) : failure('NOT_FOUND', 404);
                }
                if (action === 'dismiss') {
                    // Tombstones never fetch their input. Preserve even a rejected
                    // source so its local capture can be discarded durably.
                    const validCapture = typeof body.import_nonce === 'string' && UUID.test(body.import_nonce)
                        && typeof body.url === 'string' && body.url.length <= 16384;
                    const { data, error } = await supabase.rpc('fn_dismiss_background_import', {
                        p_owner: ownerId, p_job_id: body.job_id,
                        p_import_nonce: validCapture ? body.import_nonce : null,
                        p_request: validCapture ? { url: (body.url as string).trim(), protocol_generation: 'v2' } : null,
                    });
                    if (error) return failure('TEMPORARILY_UNAVAILABLE', 503);
                    return data === true ? json({ ok: true }) : failure('NOT_FOUND', 404);
                }
                // Retry means allow the native evidence path, not unbounded paid replay.
                const status = action === 'acknowledge' ? 'acknowledged' : 'needs_device';
                let query = supabase.from('background_import_jobs').update({ status, response: null,
                    lease_token: null, lease_until: null, updated_at: new Date().toISOString() })
                    .eq('id', body.job_id).eq('user_id', ownerId);
                if (action === 'acknowledge') query = query.in('status', ['ready', 'needs_device', 'failed']);
                if (action === 'retry') query = query.eq('status', 'failed');
                const { error } = await query;
                return error ? failure('TEMPORARILY_UNAVAILABLE', 503) : json({ ok: true });
            }
            return failure('INVALID_ACTION', 400);
        } catch (error) {
            reportError(error, { fn: 'background-imports' });
            return failure('TEMPORARILY_UNAVAILABLE', 503);
        }
    };
}

if (import.meta.main) Deno.serve(createBackgroundImportsHandler());
