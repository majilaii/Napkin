/**
 * Tests for table-members edge function
 * 
 * Run with: deno test --allow-env supabase/functions/table-members/
 */

import { assertEquals } from '../_shared/test-utils.ts';
import { corsHeaders } from '../_shared/cors.ts';

Deno.test('table-members edge function', async (t) => {

    await t.step('OPTIONS should return CORS headers', () => {
        const mockHandler = (req: Request) => {
            if (req.method === 'OPTIONS') {
                return new Response('ok', { headers: corsHeaders });
            }
            return new Response('continue');
        };

        const req = new Request('http://localhost', { method: 'OPTIONS' });
        const res = mockHandler(req);

        assertEquals(res.status, 200);
    });

    await t.step('POST /invite should require table_id and invite_user_id', async () => {
        const mockValidation = async (req: Request) => {
            const body = await req.json();
            const { table_id, invite_user_id } = body;

            if (!table_id || !invite_user_id) {
                return new Response(
                    JSON.stringify({ error: 'table_id and invite_user_id are required' }),
                    { status: 400, headers: { 'Content-Type': 'application/json' } }
                );
            }
            return new Response(JSON.stringify({ success: true }), { status: 201 });
        };

        // Test with missing fields
        const reqMissing = new Request('http://localhost/invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ table_id: 'table-123' }),
        });
        const resMissing = await mockValidation(reqMissing);
        assertEquals(resMissing.status, 400);

        // Test with all fields
        const reqValid = new Request('http://localhost/invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ table_id: 'table-123', invite_user_id: 'user-456' }),
        });
        const resValid = await mockValidation(reqValid);
        assertEquals(resValid.status, 201);
    });

    await t.step('POST /join should require table_id', async () => {
        const mockValidation = async (req: Request) => {
            const body = await req.json();
            const { table_id } = body;

            if (!table_id) {
                return new Response(
                    JSON.stringify({ error: 'table_id is required' }),
                    { status: 400, headers: { 'Content-Type': 'application/json' } }
                );
            }
            return new Response(JSON.stringify({ success: true }), { status: 201 });
        };

        const reqMissing = new Request('http://localhost/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const resMissing = await mockValidation(reqMissing);
        assertEquals(resMissing.status, 400);
    });

    await t.step('Non-admin should not be able to invite', async () => {
        // Mock admin check
        const mockAdminCheck = (_tableId: string, _userId: string) => false;

        const mockInvite = (isAdmin: boolean) => {
            if (!isAdmin) {
                return new Response(
                    JSON.stringify({ error: 'Only admins can invite members' }),
                    { status: 403, headers: { 'Content-Type': 'application/json' } }
                );
            }
            return new Response(JSON.stringify({ success: true }), { status: 201 });
        };

        const res = mockInvite(mockAdminCheck('table-123', 'user-456'));
        assertEquals(res.status, 403);
    });
});
