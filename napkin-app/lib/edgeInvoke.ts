export interface UnwrappedError {
    code: string;
    message: string;
    details?: unknown;
    status?: number;
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
