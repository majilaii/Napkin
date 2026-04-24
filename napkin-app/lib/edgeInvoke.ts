import { supabase } from '@/lib/supabase';

export interface UnwrappedError {
    code: string;
    message: string;
    details?: unknown;
    status?: number;
}

export interface CallEdgeFnOptions<TBody = unknown> {
    /** Routed via `?action=` query param. Most edge functions in this repo use this. */
    action?: string;
    /** Defaults to 'POST'. Use 'GET' for read-only endpoints with query params. */
    method?: 'GET' | 'POST';
    /** Extra query-string params (added alongside `action` if present). */
    params?: Record<string, string | number | boolean | null | undefined>;
    /** JSON body for POST. Ignored for GET. */
    body?: TBody;
    /** AbortSignal for cancellation (GET path only). */
    signal?: AbortSignal;
}

/**
 * Throw a structured Error from an UnwrappedError shape, exposing it on `.cause`.
 */
function throwInvokeError(unwrapped: UnwrappedError): never {
    const e = new Error(unwrapped.message) as Error & { cause?: UnwrappedError };
    e.cause = unwrapped;
    throw e;
}

/**
 * Shared edge-function invoke helper (TICKET-039 P2-7).
 *
 * One way to call edge functions:
 *   - POST → supabase.functions.invoke (auto-attaches auth)
 *   - GET  → raw fetch (invoke is POST-only) with auth headers
 *
 * Returns the unwrapped `data.data` payload on success; throws an Error
 * with structured `.cause: UnwrappedError` on failure (TICKET-037 envelope).
 *
 * Example (POST):
 *   const item = await callEdgeFn<WishlistItem>('wishlist', {
 *     action: 'add', body: { restaurant_id }
 *   });
 *
 * Example (GET with params):
 *   const page = await callEdgeFn<DiaryPage>('user-profile', {
 *     method: 'GET', action: 'diary', params: { user_id, limit: 30 }
 *   });
 */
export async function callEdgeFn<T = unknown>(
    name: string,
    opts: CallEdgeFnOptions = {},
): Promise<T> {
    const { action, method = 'POST', params, body, signal } = opts;

    if (method === 'GET') {
        const { data: { session } } = await supabase.auth.getSession();
        const baseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
        const url = new URL(`${baseUrl}/functions/v1/${name}`);
        if (action) url.searchParams.set('action', action);
        if (params) {
            for (const [k, v] of Object.entries(params)) {
                if (v === undefined || v === null) continue;
                url.searchParams.set(k, String(v));
            }
        }
        let res: Response;
        try {
            res = await fetch(url.toString(), {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    ...(session?.access_token
                        ? { Authorization: `Bearer ${session.access_token}` }
                        : {}),
                    apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
                },
                signal,
            });
        } catch (fetchErr) {
            throwInvokeError({
                code: 'NETWORK',
                message: fetchErr instanceof Error ? fetchErr.message : 'Network error',
            });
        }
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            const errPayload = json?.error;
            if (errPayload && typeof errPayload === 'object' && errPayload.code) {
                throwInvokeError({
                    code: errPayload.code,
                    message: errPayload.message ?? `HTTP ${res.status}`,
                    details: errPayload.details,
                    status: res.status,
                });
            }
            throwInvokeError({
                code: `http_${res.status}`,
                message: typeof errPayload === 'string' ? errPayload : `HTTP ${res.status}`,
                details: json,
                status: res.status,
            });
        }
        if (json?.error) {
            const errPayload = json.error;
            if (typeof errPayload === 'object' && errPayload.code) {
                throwInvokeError({
                    code: errPayload.code,
                    message: errPayload.message ?? 'Edge function error',
                    details: errPayload.details,
                });
            }
            throwInvokeError({ code: 'LEGACY', message: String(errPayload) });
        }
        return (json?.data ?? json) as T;
    }

    // POST via supabase-js invoke (auto-attaches auth)
    const invokeBody = action
        ? { action, ...((body as object | undefined) ?? {}) }
        : body;
    const { data, error } = await supabase.functions.invoke(name, {
        body: invokeBody,
    });
    if (error) {
        const wrapped = await unwrapInvokeError(error);
        throwInvokeError(wrapped);
    }
    if (data?.error) {
        const errPayload = data.error;
        if (typeof errPayload === 'object' && errPayload.code) {
            throwInvokeError({
                code: errPayload.code,
                message: errPayload.message ?? 'Edge function error',
                details: errPayload.details,
            });
        }
        throwInvokeError({ code: 'LEGACY', message: String(errPayload) });
    }
    return (data?.data ?? data) as T;
}

/**
 * Unwrap supabase-js FunctionsHttpError into the canonical edge error envelope.
 * Falls back to the raw Error.message if the response body isn't the new shape.
 * Safe to call on any thrown value from `supabase.functions.invoke`.
 */
export async function unwrapInvokeError(err: unknown): Promise<UnwrappedError> {
    const status = (err as { context?: { status?: number } })?.context?.status;
    const ctx = (err as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
        try {
            const body = await ctx.json();
            // New shape: { error: { code, message, details? } }
            if (body?.error && typeof body.error === 'object' && body.error.code) {
                return { code: body.error.code, message: body.error.message ?? 'Unknown error', details: body.error.details, status };
            }
            // Legacy shape: { error: string }
            if (typeof body?.error === 'string') {
                return { code: 'LEGACY', message: body.error, status };
            }
        } catch {
            // fall through
        }
    }
    const message = err instanceof Error ? err.message : String(err);
    return { code: 'UNKNOWN', message, status };
}
