/**
 * mockEdgeFn — helpers for mocking callEdgeFn in hook tests.
 * TICKET-042.
 *
 * The module-level jest.mock() call is registered here so all hook
 * test files can import these helpers and get a consistent mock.
 *
 * Usage in a test file:
 *   import { mockEdgeFnResolves, mockEdgeFnRejects } from '@/__tests__/utils/mockEdgeFn';
 *   jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));
 *
 *   beforeEach(() => {
 *     mockEdgeFnResolves({ id: 'server-1', ...serverShape });
 *   });
 *
 * Each test should add jest.mock('@/lib/edgeInvoke', ...) at the module level.
 * clearMocks: true in jest.config.js resets call history between tests.
 */

import type { UnwrappedError } from '@/lib/edgeInvoke';

// Lazy-import the mock fn so this helper works whether or not jest.mock()
// was called at the calling test's module level. Callers still own the
// jest.mock() registration.
function getCallEdgeFnMock(): jest.Mock {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@/lib/edgeInvoke');
    return mod.callEdgeFn as jest.Mock;
}

/**
 * Set callEdgeFn to resolve with `payload` on the next call.
 */
export function mockEdgeFnResolves(payload: unknown): jest.Mock {
    const mock = getCallEdgeFnMock();
    mock.mockResolvedValueOnce(payload);
    return mock;
}

/**
 * Set callEdgeFn to reject with a structured error on the next call.
 * Matches the Error + .cause: UnwrappedError shape from callEdgeFn.
 */
export function mockEdgeFnRejects(error: Partial<UnwrappedError>): jest.Mock {
    const mock = getCallEdgeFnMock();
    const err = new Error(error.message ?? 'Edge function error') as Error & { cause?: UnwrappedError };
    err.cause = {
        code: error.code ?? 'SERVER_ERROR',
        message: error.message ?? 'Edge function error',
        details: error.details,
        status: error.status ?? 500,
    };
    mock.mockRejectedValueOnce(err);
    return mock;
}

/**
 * Set callEdgeFn to resolve with `payload` after `ms` milliseconds.
 * Useful for testing the optimistic state before the server responds.
 */
export function mockEdgeFnDelayed(payload: unknown, ms: number): jest.Mock {
    const mock = getCallEdgeFnMock();
    mock.mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve(payload), ms)),
    );
    return mock;
}
