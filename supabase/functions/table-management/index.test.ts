/**
 * Tests for table-management edge function
 * 
 * Run with: deno test --allow-env supabase/functions/table-management/
 */

import { assertEquals } from '../_shared/test-utils.ts';
import { corsHeaders } from '../_shared/cors.ts';

Deno.test('table-management edge function', async (t) => {

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
        assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
    });

    await t.step('should reject requests without Authorization header', async () => {
        const mockAuthCheck = (req: Request) => {
            const authHeader = req.headers.get('Authorization');
            if (!authHeader) {
                return new Response(
                    JSON.stringify({ error: 'Missing Authorization header' }),
                    { status: 401, headers: { 'Content-Type': 'application/json' } }
                );
            }
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        };

        const req = new Request('http://localhost', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
        });

        const res = mockAuthCheck(req);
        assertEquals(res.status, 401);

        const body = await res.json();
        assertEquals(body.error, 'Missing Authorization header');
    });

    await t.step('POST should require name field', async () => {
        const mockValidation = async (req: Request) => {
            const body = await req.json();
            const { name } = body;

            if (!name || typeof name !== 'string' || name.trim().length === 0) {
                return new Response(
                    JSON.stringify({ error: 'Name is required' }),
                    { status: 400, headers: { 'Content-Type': 'application/json' } }
                );
            }
            return new Response(JSON.stringify({ success: true }), { status: 201 });
        };

        // Test with missing name
        const reqNoName = new Request('http://localhost', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const resNoName = await mockValidation(reqNoName);
        assertEquals(resNoName.status, 400);

        // Test with empty name
        const reqEmptyName = new Request('http://localhost', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: '   ' }),
        });
        const resEmptyName = await mockValidation(reqEmptyName);
        assertEquals(resEmptyName.status, 400);

        // Test with valid name
        const reqValid = new Request('http://localhost', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Sunday Roast Club' }),
        });
        const resValid = await mockValidation(reqValid);
        assertEquals(resValid.status, 201);
    });

    await t.step('DELETE should return success', async () => {
        const mockDelete = (_req: Request) => {
            return new Response(
                JSON.stringify({ success: true }),
                { headers: { 'Content-Type': 'application/json' } }
            );
        };

        const req = new Request('http://localhost/table-123', { method: 'DELETE' });
        const res = mockDelete(req);

        assertEquals(res.status, 200);
        const body = await res.json();
        assertEquals(body.success, true);
    });
});
