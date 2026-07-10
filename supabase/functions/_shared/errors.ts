import { corsHeaders } from './cors.ts';

export type ErrorCode =
    | 'UNAUTHORIZED'
    | 'FORBIDDEN'
    | 'NOT_FOUND'
    | 'INVALID_INPUT'
    | 'METHOD_NOT_ALLOWED'
    | 'CONFLICT'
    | 'NOT_A_PARTICIPANT'
    | 'NOT_A_TABLE_MEMBER'
    | 'ROUND_NOT_RATING'
    | 'ALREADY_SUBMITTED'
    | 'NOT_OWNER'
    | 'NOT_MUTUAL_FOLLOW'
    | 'ATTENDEE_NOT_MEMBER'
    | 'DUPLICATE_SUBMISSION'
    | 'INTERNAL';

export interface EdgeErrorBody {
    error: { code: ErrorCode | string; message: string; details?: unknown };
}

export function errorResponse(code: ErrorCode | string, message: string, status: number, details?: unknown): Response {
    const body: EdgeErrorBody = { error: { code, message, ...(details !== undefined ? { details } : {}) } };
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

/** Map Postgres SQLSTATE + RAISE EXCEPTION message to a canonical error code. */
export function mapPgError(err: { code?: string; message?: string }): { code: ErrorCode | string; status: number } {
    const m = (err.message ?? '').split(':')[0].trim().toUpperCase();
    switch (m) {
        case 'NOT_A_PARTICIPANT':
        case 'NOT_A_TABLE_MEMBER':
        case 'NOT_AUTHORIZED':
        case 'NOT_OWNER':
            return { code: m, status: 403 };
        case 'ROUND_NOT_RATING':
        case 'ALREADY_SUBMITTED':
        case 'ATTENDEE_NOT_MEMBER':
            return { code: m, status: 409 };
        default:
            return { code: 'INTERNAL', status: 500 };
    }
}
