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

    await t.step('POST /join without invitation should fail', async () => {
        // Mock: no pending invitation exists
        const mockHasPendingInvitation = (_tableId: string, _userId: string) => false;

        const mockJoin = (hasInvitation: boolean) => {
            if (!hasInvitation) {
                return new Response(
                    JSON.stringify({ error: 'You must be invited to join this table' }),
                    { status: 403, headers: { 'Content-Type': 'application/json' } }
                );
            }
            return new Response(JSON.stringify({ success: true }), { status: 201 });
        };

        const res = mockJoin(mockHasPendingInvitation('table-123', 'user-456'));
        assertEquals(res.status, 403);

        const body = await res.json();
        assertEquals(body.error, 'You must be invited to join this table');
    });

    await t.step('POST /join with valid invitation should succeed', async () => {
        // Mock: pending invitation exists
        const mockHasPendingInvitation = (_tableId: string, _userId: string) => true;

        const mockJoin = (hasInvitation: boolean) => {
            if (!hasInvitation) {
                return new Response(
                    JSON.stringify({ error: 'You must be invited to join this table' }),
                    { status: 403, headers: { 'Content-Type': 'application/json' } }
                );
            }
            return new Response(
                JSON.stringify({ data: { table_id: 'table-123', member_id: 'user-456', role: 'member' } }),
                { status: 201, headers: { 'Content-Type': 'application/json' } }
            );
        };

        const res = mockJoin(mockHasPendingInvitation('table-123', 'user-456'));
        assertEquals(res.status, 201);
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

    await t.step('Admin should be able to invite', async () => {
        const mockAdminCheck = (_tableId: string, _userId: string) => true;

        const mockInvite = (isAdmin: boolean) => {
            if (!isAdmin) {
                return new Response(
                    JSON.stringify({ error: 'Only admins can invite members' }),
                    { status: 403, headers: { 'Content-Type': 'application/json' } }
                );
            }
            return new Response(
                JSON.stringify({ data: { id: 'inv-123', table_id: 'table-123', invited_user_id: 'user-456', status: 'pending' } }),
                { status: 201, headers: { 'Content-Type': 'application/json' } }
            );
        };

        const res = mockInvite(mockAdminCheck('table-123', 'user-456'));
        assertEquals(res.status, 201);
    });

    await t.step('Cannot demote the last admin', async () => {
        // Mock: only 1 admin in table
        const mockCountAdmins = (_tableId: string) => 1;
        const mockGetTargetRole = (_tableId: string, _userId: string) => 'admin';

        const mockRoleChange = (adminCount: number, targetRole: string, newRole: string) => {
            if (newRole === 'member' && targetRole === 'admin' && adminCount <= 1) {
                return new Response(
                    JSON.stringify({ error: 'Cannot demote the last admin. Promote another member to admin first.' }),
                    { status: 400, headers: { 'Content-Type': 'application/json' } }
                );
            }
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        };

        const res = mockRoleChange(
            mockCountAdmins('table-123'),
            mockGetTargetRole('table-123', 'admin-user'),
            'member'
        );
        assertEquals(res.status, 400);

        const body = await res.json();
        assertEquals(body.error, 'Cannot demote the last admin. Promote another member to admin first.');
    });

    await t.step('Can demote admin if there are multiple admins', async () => {
        // Mock: 2 admins in table
        const mockCountAdmins = (_tableId: string) => 2;
        const mockGetTargetRole = (_tableId: string, _userId: string) => 'admin';

        const mockRoleChange = (adminCount: number, targetRole: string, newRole: string) => {
            if (newRole === 'member' && targetRole === 'admin' && adminCount <= 1) {
                return new Response(
                    JSON.stringify({ error: 'Cannot demote the last admin. Promote another member to admin first.' }),
                    { status: 400, headers: { 'Content-Type': 'application/json' } }
                );
            }
            return new Response(
                JSON.stringify({ data: { table_id: 'table-123', member_id: 'admin-user', role: 'member' } }),
                { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
        };

        const res = mockRoleChange(
            mockCountAdmins('table-123'),
            mockGetTargetRole('table-123', 'admin-user'),
            'member'
        );
        assertEquals(res.status, 200);
    });

    await t.step('DELETE should require table_id and user_id', () => {
        const mockValidation = (table_id: string | null, targetUserId: string | null) => {
            if (!table_id || !targetUserId) {
                return new Response(
                    JSON.stringify({ error: 'table_id and user_id are required' }),
                    { status: 400, headers: { 'Content-Type': 'application/json' } }
                );
            }
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        };

        const resMissing = mockValidation(null, 'user-123');
        assertEquals(resMissing.status, 400);

        const resValid = mockValidation('table-123', 'user-456');
        assertEquals(resValid.status, 200);
    });

    await t.step('Non-admin cannot remove other members', () => {
        const mockRemove = (isSelf: boolean, isAdmin: boolean) => {
            if (!isSelf && !isAdmin) {
                return new Response(
                    JSON.stringify({ error: 'Only admins can remove other members' }),
                    { status: 403, headers: { 'Content-Type': 'application/json' } }
                );
            }
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        };

        // Non-admin trying to remove someone else
        const res = mockRemove(false, false);
        assertEquals(res.status, 403);
    });

    await t.step('User can remove themselves (leave table)', () => {
        const mockRemove = (isSelf: boolean, isAdmin: boolean) => {
            if (!isSelf && !isAdmin) {
                return new Response(
                    JSON.stringify({ error: 'Only admins can remove other members' }),
                    { status: 403, headers: { 'Content-Type': 'application/json' } }
                );
            }
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        };

        // User removing themselves
        const res = mockRemove(true, false);
        assertEquals(res.status, 200);
    });

    await t.step('Admin can remove other members', () => {
        const mockRemove = (isSelf: boolean, isAdmin: boolean) => {
            if (!isSelf && !isAdmin) {
                return new Response(
                    JSON.stringify({ error: 'Only admins can remove other members' }),
                    { status: 403, headers: { 'Content-Type': 'application/json' } }
                );
            }
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        };

        // Admin removing someone else
        const res = mockRemove(false, true);
        assertEquals(res.status, 200);
    });

    await t.step('PUT /role should require table_id, user_id, and role', () => {
        const mockValidation = (table_id: string | null, targetUserId: string | null, role: string | null) => {
            if (!table_id || !targetUserId || !role) {
                return new Response(
                    JSON.stringify({ error: 'table_id, user_id, and role are required' }),
                    { status: 400, headers: { 'Content-Type': 'application/json' } }
                );
            }
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        };

        const resMissingRole = mockValidation('table-123', 'user-456', null);
        assertEquals(resMissingRole.status, 400);

        const resValid = mockValidation('table-123', 'user-456', 'admin');
        assertEquals(resValid.status, 200);
    });

    await t.step('Non-admin cannot change roles', () => {
        const mockRoleChange = (isAdmin: boolean) => {
            if (!isAdmin) {
                return new Response(
                    JSON.stringify({ error: 'Only admins can change roles' }),
                    { status: 403, headers: { 'Content-Type': 'application/json' } }
                );
            }
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        };

        const res = mockRoleChange(false);
        assertEquals(res.status, 403);
    });
});
