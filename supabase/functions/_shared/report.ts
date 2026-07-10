/**
 * TICKET-121: minimal Sentry error reporting for edge functions.
 *
 * reportError(err, { fn, action?, extra? }) POSTs a minimal event to the
 * Sentry store API. The activation switch is the SENTRY_DSN secret:
 * unset/empty (the default) makes every call a no-op, so
 * `supabase secrets set SENTRY_DSN=... --project-ref ftvmseaqwwlcxtdlvxxz`
 * turns reporting on fleet-wide with NO redeploy.
 *
 * Guarantees:
 *   - NEVER throws (whole body wrapped in try/catch).
 *   - NEVER blocks or delays the response (fetch is fire-and-forget,
 *     rejection swallowed — no await).
 *   - Dependency-free: plain fetch, no Sentry SDK.
 */

/**
 * Report an error to Sentry (no-op when SENTRY_DSN is unset).
 *
 * @param err  The caught error (unknown — any thrown value is acceptable).
 * @param ctx  fn: edge function dir name; action: routed action if known;
 *             extra: any additional context (kept small — this rides the
 *             error path).
 */
export function reportError(
    err: unknown,
    ctx: { fn: string; action?: string; extra?: Record<string, unknown> },
): void {
    try {
        const dsn = Deno.env.get('SENTRY_DSN');
        if (!dsn) return;

        // DSN format: https://<key>@<host>/<projectId>
        const match = dsn.match(/^https?:\/\/([^@]+)@([^/]+)\/(.+)$/);
        if (!match) return;
        const [, key, host, projectId] = match;

        const e = err as { name?: unknown; message?: unknown } | null | undefined;
        const type = typeof e?.name === 'string' && e.name.length > 0 ? e.name : 'Error';
        const value = String(e?.message ?? err).slice(0, 1000);

        const event = {
            timestamp: Math.floor(Date.now() / 1000),
            platform: 'javascript',
            level: 'error',
            server_name: 'supabase-edge',
            tags: { fn: ctx.fn, ...(ctx.action ? { action: ctx.action } : {}) },
            ...(ctx.extra ? { extra: ctx.extra } : {}),
            exception: { values: [{ type, value }] },
        };

        // Fire-and-forget: the response must never wait on Sentry.
        const p = fetch(
            `https://${host}/api/${projectId}/store/?sentry_key=${key}&sentry_version=7`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(event),
            },
        ).catch(() => {
            // Swallow — reporting failures must never surface to the caller.
        });

        // TICKET-121 fix-pass: the edge isolate can tear down right after the
        // response is returned, dropping the in-flight fetch. Supabase's edge
        // runtime exposes EdgeRuntime.waitUntil to keep the isolate alive
        // until the send settles WITHOUT delaying the response. Not available
        // everywhere (local deno, tests) — fall back silently to plain
        // fire-and-forget.
        try {
            // deno-lint-ignore no-explicit-any
            (globalThis as any).EdgeRuntime?.waitUntil?.(p);
        } catch {
            // ignore — plain fire-and-forget still stands.
        }
    } catch {
        // reportError must never throw, full stop.
    }
}
