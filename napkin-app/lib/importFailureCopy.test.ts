import { classifyImportFailure, importFailureTags } from './importFailureCopy';

/** Build the error shape callEdgeFn produces (Error + .cause: UnwrappedError). */
function edgeError(message: string, cause: { code?: string; status?: number }): Error {
    const err = new Error(message);
    (err as Error & { cause?: unknown }).cause = { message, ...cause };
    return err;
}

describe('classifyImportFailure', () => {
    // The 2026-09-04 regression: these three throw BEFORE any fetch, so they
    // used to reach an empty onError and render as a dead button.
    it.each([
        'Incomplete v2 import request',
        'A v2 import item is missing server provenance',
    ])('maps the provenance precondition %p to a retryable look-up-again line', (message) => {
        const result = classifyImportFailure(new Error(message));
        expect(result.reason).toBe('missing_provenance');
        expect(result.retryable).toBe(true);
        expect(result.message).toContain('look it up again');
    });

    it('maps the routing precondition to a non-retryable start-again line', () => {
        const result = classifyImportFailure(new Error('Incomplete v2 import routing declaration'));
        expect(result.reason).toBe('incomplete_routing');
        expect(result.retryable).toBe(false);
    });

    it('names a 429 as rate limiting rather than a generic failure', () => {
        const result = classifyImportFailure(edgeError('rate limited', { status: 429 }));
        expect(result.reason).toBe('rate_limited');
        expect(result.retryable).toBe(true);
    });

    it('reassures on a 5xx that it is not the user', () => {
        const result = classifyImportFailure(edgeError('boom', { status: 503 }));
        expect(result.reason).toBe('server');
        expect(result.message).toContain("not you");
    });

    it('treats a non-429 4xx as a retryable rejection', () => {
        const result = classifyImportFailure(edgeError('nope', { status: 409 }));
        expect(result.reason).toBe('rejected');
    });

    it('detects an offline fetch failure, which carries no status', () => {
        const result = classifyImportFailure(new Error('Network request failed'));
        expect(result.reason).toBe('offline');
        expect(result.message).toContain('your clip is safe');
    });

    it('detects the structured callEdgeFn connectivity failure', () => {
        const result = classifyImportFailure(edgeError(
            'Couldn’t reach Napkin. Check your connection and try again.',
            { code: 'NETWORK' },
        ));
        expect(result.reason).toBe('offline');
    });

    it('falls back to a retryable generic line for an unrecognised error', () => {
        const result = classifyImportFailure(new Error('something odd'));
        expect(result.reason).toBe('unknown');
        expect(result.retryable).toBe(true);
    });

    it('never throws on a non-Error value', () => {
        expect(() => classifyImportFailure(null)).not.toThrow();
        expect(classifyImportFailure(null).reason).toBe('unknown');
        expect(classifyImportFailure('plain string').reason).toBe('unknown');
    });

    it('keeps every line lowercase and single-clause (Heirloom voice)', () => {
        const errors = [
            new Error('Incomplete v2 import request'),
            new Error('Incomplete v2 import routing declaration'),
            edgeError('x', { status: 429 }),
            edgeError('x', { status: 500 }),
            edgeError('x', { status: 400 }),
            new Error('Network request failed'),
            new Error('unknown'),
        ];
        for (const err of errors) {
            const { message } = classifyImportFailure(err);
            expect(message[0]).toBe(message[0].toLowerCase());
            expect(message).not.toMatch(/[.!]$/);
        }
    });
});

describe('importFailureTags', () => {
    it('carries status and code without any user content', () => {
        const tags = importFailureTags(
            edgeError('nope', { status: 409, code: 'ALREADY_PINNED' }),
            'import_link_sheet',
        );
        expect(tags).toEqual({
            surface: 'import_link_sheet',
            reason: 'rejected',
            retryable: 'true',
            status: '409',
            code: 'ALREADY_PINNED',
        });
    });

    it('omits status and code when the error carries neither', () => {
        const tags = importFailureTags(new Error('Incomplete v2 import request'), 'queue');
        expect(tags).toEqual({
            surface: 'queue',
            reason: 'missing_provenance',
            retryable: 'true',
        });
    });
});
