/**
 * importFailureCopy — turns a save/import failure into one honest line.
 *
 * Why this exists: on 2026-09-04 four paid extractions failed in a row and the
 * founder saw nothing at all. The save path can throw BEFORE any network call
 * (three v2 preconditions in useSaveImportSpots / useProcessImportQueue), and
 * every one of those throws landed in an `onError: () => {}`. A dead button is
 * indistinguishable from a slow one, so the import looked "processed" forever.
 *
 * Rules:
 *  - Never blame the user for a provenance bug — say the spot needs resolving
 *    again and give them the retry, because that is the actual remedy.
 *  - Never surface a raw Error message; they are engineer-facing.
 *  - Lowercase, one clause, middle dot for the second beat (Heirloom voice).
 *
 * Pure + no RN imports so the mapping is unit-testable.
 */

/** Stable reason slug — also the Sentry tag and the `track` prop. */
export type ImportFailureReason =
    | 'missing_provenance' //  a candidate carries no server resolution_id
    | 'incomplete_routing' //  destinations/expected count never got frozen
    | 'offline' //             no network
    | 'rate_limited' //        429 from the edge function
    | 'server' //              5xx
    | 'rejected' //            4xx we can name
    | 'unknown';

export interface ClassifiedImportFailure {
    reason: ImportFailureReason;
    /** One line for the sheet. */
    message: string;
    /** True when tapping the same button again could plausibly work. */
    retryable: boolean;
}

/** The three client-side preconditions that throw before any fetch. */
const PRECONDITION_MESSAGES: ReadonlyMap<string, ImportFailureReason> = new Map([
    ['Incomplete v2 import request', 'missing_provenance'],
    ['A v2 import item is missing server provenance', 'missing_provenance'],
    ['Incomplete v2 import routing declaration', 'incomplete_routing'],
]);

function statusOf(error: unknown): number | undefined {
    const cause = (error as { cause?: { status?: unknown } } | null)?.cause;
    const status = cause?.status;
    return typeof status === 'number' ? status : undefined;
}

function codeOf(error: unknown): string | undefined {
    const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
    const code = cause?.code;
    return typeof code === 'string' && code.length > 0 ? code : undefined;
}

function messageOf(error: unknown): string {
    if (error instanceof Error) return error.message ?? '';
    if (typeof error === 'string') return error;
    return '';
}

export function classifyImportFailure(error: unknown): ClassifiedImportFailure {
    const raw = messageOf(error);

    if (codeOf(error) === 'NETWORK') {
        return {
            reason: 'offline',
            message: 'no connection · your clip is safe, try again',
            retryable: true,
        };
    }

    const precondition = PRECONDITION_MESSAGES.get(raw);
    if (precondition === 'missing_provenance') {
        return {
            reason: 'missing_provenance',
            // The remedy really is a re-resolve: the candidate never got a
            // server resolution_id, so the save can't prove where it came from.
            message: "couldn't confirm this spot · tap to look it up again",
            retryable: true,
        };
    }
    if (precondition === 'incomplete_routing') {
        return {
            reason: 'incomplete_routing',
            message: "couldn't work out where to save this · close and start again",
            retryable: false,
        };
    }

    const status = statusOf(error);
    if (status === 429) {
        return {
            reason: 'rate_limited',
            message: 'too many imports just now · try again in a minute',
            retryable: true,
        };
    }
    if (status !== undefined && status >= 500) {
        return {
            reason: 'server',
            message: "our end fell over · it's not you, try again",
            retryable: true,
        };
    }
    if (status !== undefined && status >= 400) {
        return {
            reason: 'rejected',
            message: "couldn't pin these · tap to try again",
            retryable: true,
        };
    }

    // callEdgeFn surfaces a fetch failure with no status.
    if (status === undefined && /network|fetch|timeout|abort/i.test(raw)) {
        return {
            reason: 'offline',
            message: 'no connection · your clip is safe, try again',
            retryable: true,
        };
    }

    return {
        reason: 'unknown',
        message: "couldn't pin these · tap to try again",
        retryable: true,
    };
}

/** Sentry/track tags for one failure — never carries user content. */
export function importFailureTags(
    error: unknown,
    surface: string,
): Record<string, string> {
    const { reason, retryable } = classifyImportFailure(error);
    const status = statusOf(error);
    const code = codeOf(error);
    return {
        surface,
        reason,
        retryable: String(retryable),
        ...(status !== undefined ? { status: String(status) } : {}),
        ...(code ? { code } : {}),
    };
}
