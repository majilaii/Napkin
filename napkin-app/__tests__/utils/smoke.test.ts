/**
 * Smoke test — verifies the test infrastructure wires up correctly.
 * TICKET-042.
 */

import { makeTestClient } from './queryWrapper';

describe('test infrastructure smoke test', () => {
    it('makeTestClient returns a QueryClient with retry:false and gcTime:Infinity', () => {
        const client = makeTestClient();
        expect(client.getDefaultOptions().queries?.retry).toBe(false);
        expect(client.getDefaultOptions().queries?.gcTime).toBe(Infinity);
    });
});
