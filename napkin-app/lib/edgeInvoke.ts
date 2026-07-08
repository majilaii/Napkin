import { supabase } from '@/lib/supabase';
import { addBreadcrumb, captureError } from '@/lib/sentry';
import { trackError } from '@/lib/track';

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
    /**
     * AbortSignal for cancellation.
     * - On GET: always wired through to fetch (existing behavior).
     * - On POST with signal: routes to postWithFetch() so the upstream request
     *   is actually cancelled. Without signal, POST uses supabase.functions.invoke
     *   (unchanged behavior for all existing callers). [ARCH-REVIEW-M2]
     */
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
 * TICKET-075: typed error raised when the device session can't be refreshed.
 * The app routes this to sign-out → /auth instead of showing a raw "non-2xx" toast.
 * Detectable via `(err as SessionExpiredError).code === 'session_expired'`.
 */
export class SessionExpiredError extends Error {
    code = 'session_expired' as const;
    constructor(message = 'Your session expired — please sign in again.') {
        super(message);
        this.name = 'SessionExpiredError';
    }
}

/**
 * TICKET-075: decide whether a thrown edge error is an auth failure worth a
 * refresh+retry. Recognizes the 401 status plus the common invalid-JWT codes
 * across all three transports (GET fetch, POST fetch, POST invoke).
 *
 * Exported for unit testing the refresh-retry decision in isolation.
 */
export function isAuthFailure(err: unknown): boolean {
    const cause = (err as { cause?: UnwrappedError })?.cause;
    if (cause?.status === 401) return true;
    const code = (cause?.code ?? '').toLowerCase();
    if (code === 'http_401' || code === '401') return true;
    if (code.includes('jwt') || code.includes('unauthorized')) return true;
    const message = (cause?.message ?? (err as Error)?.message ?? '').toLowerCase();
    return message.includes('invalid jwt') || message.includes('jwt expired');
}

/**
 * TICKET-121: report a terminal edge failure (the error is about to reach the
 * caller) into the events table + Sentry. SessionExpiredError is routine
 * (sign-out flow), never reported. Marks the error `__napkinReported` so the
 * QueryCache/MutationCache global handlers don't double-report it.
 */
function reportEdgeFailure(err: unknown, fn: string, action?: string): void {
    if (err instanceof SessionExpiredError) return;
    try {
        const context = `edge:${fn}:${action ?? ''}`;
        const cause = (err as { cause?: UnwrappedError })?.cause;
        trackError(err, context);
        captureError(err, {
            context,
            tags: {
                fn,
                action: action ?? '',
                code: cause?.code ?? '',
                status: cause?.status != null ? String(cause.status) : '',
            },
        });
        if (err && typeof err === 'object') {
            (err as { __napkinReported?: boolean }).__napkinReported = true;
        }
    } catch {
        /* reporting must never mask the original error */
    }
}

/**
 * TICKET-075: attempt a single session refresh. Returns true when a new session
 * is obtained, false otherwise (caller surfaces SessionExpiredError on false).
 */
async function tryRefreshSession(): Promise<boolean> {
    try {
        const { data, error } = await supabase.auth.refreshSession();
        return !error && !!data.session;
    } catch {
        return false;
    }
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
/**
 * Public entry point. Runs the call once; on a 401 / invalid-JWT failure it
 * refreshes the session ONE time and retries. If the refresh fails, it throws a
 * typed SessionExpiredError the app routes to sign-out → /auth. Happy path is
 * untouched — the retry shell only activates on an auth failure. [TICKET-075]
 */
export async function callEdgeFn<T = unknown>(
    name: string,
    opts: CallEdgeFnOptions = {},
): Promise<T> {
    try {
        return await callEdgeFnOnce<T>(name, opts);
    } catch (err) {
        if (!isAuthFailure(err)) {
            reportEdgeFailure(err, name, opts.action);
            throw err;
        }
        const refreshed = await tryRefreshSession();
        if (!refreshed) throw new SessionExpiredError();
        // Retry once with the fresh session. A second auth failure is terminal.
        try {
            return await callEdgeFnOnce<T>(name, opts);
        } catch (retryErr) {
            if (isAuthFailure(retryErr)) throw new SessionExpiredError();
            reportEdgeFailure(retryErr, name, opts.action);
            throw retryErr;
        }
    }
}

async function callEdgeFnOnce<T = unknown>(
    name: string,
    opts: CallEdgeFnOptions = {},
): Promise<T> {
    const { action, method = 'POST', params, body, signal } = opts;

    addBreadcrumb({ category: 'edge', message: `${name}:${action ?? ''}` });

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

    // POST: if a signal is provided, use raw fetch so AbortSignal actually cancels
    // the upstream request. Without signal, fall through to supabase.functions.invoke
    // (unchanged behavior for all existing callers). [ARCH-REVIEW-M2]
    if (signal) {
        return postWithFetch<T>(name, opts);
    }

    // POST via supabase-js invoke (auto-attaches auth).
    // `action` and any `params` are appended to the function name as a query
    // string — supabase-js preserves query strings in the function name. This
    // mirrors the GET and postWithFetch paths so a top-level `action` reaches
    // the query string on EVERY transport: functions that route POST on
    // `?action=` (e.g. table-management, index.ts:51) work whether the caller
    // passes `action` at the top level or via `params: { action }`. `action`
    // is ALSO kept in the body (invokeBody) so body-reading functions are
    // unaffected — this is purely additive. Closes the misroute footgun behind
    // the TICKET-121 "Name is required" fire (top_four_get/set, mark_welcomed).
    const invokeBody = action
        ? { action, ...((body as object | undefined) ?? {}) }
        : body;
    let invokeName = name;
    const qs = new URLSearchParams();
    if (action) qs.set('action', action);
    // If a caller ever passed BOTH a top-level `action` and `params.action`
    // (none does today), `params.action` wins the query here — consistent with
    // the GET path and postWithFetch. The two are equivalent only when not both
    // are supplied.
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            if (v === undefined || v === null) continue;
            qs.set(k, String(v));
        }
    }
    const queryStr = qs.toString();
    if (queryStr) invokeName = `${name}?${queryStr}`;
    const { data, error } = await supabase.functions.invoke(invokeName, {
        body: invokeBody as Record<string, unknown> | undefined,
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
 * POST via raw fetch with manual auth header forwarding + AbortSignal support.
 * Mirrors the GET fetch branch — same auth attachment, same error-envelope unwrap.
 * Called by callEdgeFn when method === 'POST' && signal is present. [ARCH-REVIEW-M2]
 */
async function postWithFetch<T>(name: string, opts: CallEdgeFnOptions): Promise<T> {
    const { action, params, body, signal } = opts;
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

    const postBody = action
        ? { action, ...((body as object | undefined) ?? {}) }
        : body;

    let res: Response;
    try {
        res = await fetch(url.toString(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(session?.access_token
                    ? { Authorization: `Bearer ${session.access_token}` }
                    : {}),
                apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
            },
            body: postBody !== undefined ? JSON.stringify(postBody) : undefined,
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
