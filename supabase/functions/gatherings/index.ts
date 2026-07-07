/**
 * gatherings edge function — TICKET-095 "Gather the table"
 *
 * POST actions:
 *   create — propose a future gathering at a restaurant to one of your Tables.
 *     Inserts the gathering + the host's auto-RSVP ('in'); rolls the gathering
 *     back if the RSVP insert fails (no partial proposal survives — mirrors
 *     entry/set-table). One active proposal per (table, restaurant): the partial
 *     unique index raises 23505 → 409 ALREADY_PROPOSED.
 *
 *   rsvp — a table member answers 'in' | 'out' on a proposed gathering. Upsert
 *     on (gathering_id, user_id) so changing your answer is one call.
 *
 *   cancel — the host calls it off (proposed only). Soft state flip to
 *     'cancelled'; fn_table_activity_page excludes cancelled rows.
 *
 *   delete — the host clears a dead gathering off the table for good: hard
 *     DELETE (rsvps cascade). Allowed for proposed / expired / cancelled and
 *     for a dispatched row whose supper link died (supper_id null). The ONE
 *     block: dispatched with a live supper — that history belongs to the
 *     supper; cancel the supper first.
 *
 * All writes are service-role (gatherings/gathering_rsvps have NO client write
 * policy) — membership is validated here against table_members.member_id
 * (NEVER tm.user_id — CLAUDE.md doctrine).
 *
 * Dispatch (proposal → supper) does NOT live here: fn_dispatch_due_gatherings
 * runs from table-activity on the first feed page load.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200) {
    return new Response(JSON.stringify({ data }), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

function err(code: string, message: string, status = 400, details?: unknown) {
    return new Response(
        JSON.stringify({ error: { code, message, ...(details ? { details } : {}) } }),
        { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NOTE_LENGTH = 140;
const MAX_DAYS_AHEAD = 90;

/** Today as 'YYYY-MM-DD' in Hong Kong time. Friend-test cohort is HK/Macau;
 *  per-table timezones are a later ticket (matches fn_dispatch_due_gatherings). */
function todayHKT(): string {
    // en-CA locale formats as ISO YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date());
}

/** 'YYYY-MM-DD' + n days → 'YYYY-MM-DD' (UTC-safe day arithmetic). */
function addDays(isoDate: string, days: number): string {
    const d = new Date(`${isoDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/** Caller must be a member of the table. Throws on a real DB failure so a
 *  transient blip never masquerades as a 403 (table-activity gate doctrine). */
async function isTableMember(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any,
    tableId: string,
    userId: string,
): Promise<boolean> {
    const { data, error } = await supabase
        .from('table_members')
        .select('member_id')          // member_id, NOT user_id
        .eq('table_id', tableId)
        .eq('member_id', userId)
        .maybeSingle();
    if (error) throw error;
    return !!data;
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    if (req.method !== 'POST') {
        return err('METHOD_NOT_ALLOWED', 'POST only', 405);
    }

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return err('UNAUTHORIZED', 'Missing Authorization header', 401);
        }

        const token = authHeader.replace('Bearer ', '');
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return err('UNAUTHORIZED', 'Unauthorized', 401);
        }

        let body: { action?: string } & Record<string, unknown>;
        try {
            body = await req.json();
        } catch {
            return err('INVALID_BODY', 'Request body must be JSON', 400);
        }

        const action = body?.action;
        if (!action) {
            return err('MISSING_ACTION', 'action is required', 400);
        }

        if (action === 'create') {
            return await handleCreate(supabase, user, body);
        }
        if (action === 'rsvp') {
            return await handleRsvp(supabase, user, body);
        }
        if (action === 'cancel') {
            return await handleCancel(supabase, user, body);
        }
        if (action === 'delete') {
            return await handleDelete(supabase, user, body);
        }

        return err('UNKNOWN_ACTION', `Unknown action: ${action}`, 400);
    } catch (error) {
        console.error('gatherings error:', error);
        const details = error instanceof Error ? error.message : JSON.stringify(error);
        return err('INTERNAL', 'Internal Server Error', 500, details);
    }
});

// ── Action: create ────────────────────────────────────────────────────────────

async function handleCreate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any,
    user: { id: string },
    body: Record<string, unknown>,
): Promise<Response> {
    const tableId = body.table_id;
    const restaurantId = body.restaurant_id;
    const gatherOn = body.gather_on;
    const rawNote = body.note;

    if (typeof tableId !== 'string' || typeof restaurantId !== 'string' || !tableId || !restaurantId) {
        return err('INVALID_INPUT', 'table_id and restaurant_id are required');
    }
    if (!UUID_RE.test(tableId) || !UUID_RE.test(restaurantId)) {
        return err('INVALID_INPUT', 'table_id or restaurant_id is malformed');
    }
    if (typeof gatherOn !== 'string' || !DATE_RE.test(gatherOn) || Number.isNaN(Date.parse(`${gatherOn}T00:00:00Z`))) {
        return err('INVALID_INPUT', 'gather_on must be a valid YYYY-MM-DD date');
    }
    const note = typeof rawNote === 'string' && rawNote.trim().length > 0 ? rawNote.trim() : null;
    if (note && note.length > MAX_NOTE_LENGTH) {
        return err('INVALID_INPUT', `note must be ${MAX_NOTE_LENGTH} characters or fewer`);
    }

    // Date window: strictly after today (HKT), within 90 days. Lexical compare is
    // safe — both sides are zero-padded YYYY-MM-DD.
    const today = todayHKT();
    if (gatherOn <= today) {
        return err('INVALID_INPUT', 'gather_on must be a future date');
    }
    if (gatherOn > addDays(today, MAX_DAYS_AHEAD)) {
        return err('INVALID_INPUT', `gather_on must be within ${MAX_DAYS_AHEAD} days`);
    }

    if (!(await isTableMember(supabase, tableId, user.id))) {
        return err('FORBIDDEN', 'Not a member of this table', 403);
    }

    // Restaurant must be persisted (the client upserts a ghost before gathering,
    // same gate as set-a-table).
    const { data: restaurant, error: restaurantErr } = await supabase
        .from('restaurants')
        .select('id')
        .eq('id', restaurantId)
        .maybeSingle();
    if (restaurantErr) throw restaurantErr;
    if (!restaurant) {
        return err('INVALID_INPUT', 'restaurant not found');
    }

    // Insert the gathering, then the host's auto-RSVP. On RSVP failure, roll the
    // gathering back (delete cascades rsvps) so no host-less proposal survives.
    const { data: gathering, error: insertErr } = await supabase
        .from('gatherings')
        .insert({
            table_id: tableId,
            restaurant_id: restaurantId,
            host_user_id: user.id,
            gather_on: gatherOn,
            note,
        })
        .select('id, table_id, restaurant_id, host_user_id, note, gather_on, status, supper_id, created_at, updated_at')
        .single();
    if (insertErr) {
        // Partial unique index (table_id, restaurant_id) WHERE status='proposed'.
        if ((insertErr as { code?: string }).code === '23505') {
            return err('ALREADY_PROPOSED', 'A gathering for this spot is already proposed to this table', 409);
        }
        throw insertErr;
    }

    const { error: rsvpErr } = await supabase
        .from('gathering_rsvps')
        .insert({ gathering_id: gathering.id, user_id: user.id, response: 'in' });
    if (rsvpErr) {
        console.error('[gatherings] host rsvp failed, rolling back gathering:', rsvpErr);
        await supabase.from('gatherings').delete().eq('id', gathering.id);
        return err('CREATE_FAILED', 'Could not propose the gathering', 500);
    }

    return json(gathering);
}

// ── Action: rsvp ──────────────────────────────────────────────────────────────

async function handleRsvp(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any,
    user: { id: string },
    body: Record<string, unknown>,
): Promise<Response> {
    const gatheringId = body.gathering_id;
    const response = body.response;

    if (typeof gatheringId !== 'string' || !UUID_RE.test(gatheringId)) {
        return err('INVALID_INPUT', 'gathering_id is required');
    }
    if (response !== 'in' && response !== 'out') {
        return err('INVALID_INPUT', "response must be 'in' or 'out'");
    }

    const { data: gathering, error: gatheringErr } = await supabase
        .from('gatherings')
        .select('id, table_id, status')
        .eq('id', gatheringId)
        .maybeSingle();
    if (gatheringErr) throw gatheringErr;
    if (!gathering) {
        return err('NOT_FOUND', 'Gathering not found', 404);
    }
    if (gathering.status !== 'proposed') {
        return err('GATHERING_CLOSED', 'RSVPs are closed for this gathering', 409);
    }

    if (!(await isTableMember(supabase, gathering.table_id, user.id))) {
        return err('FORBIDDEN', 'Not a member of this table', 403);
    }

    const { error: upsertErr } = await supabase
        .from('gathering_rsvps')
        .upsert(
            {
                gathering_id: gatheringId,
                user_id: user.id,
                response,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'gathering_id,user_id' },
        );
    if (upsertErr) throw upsertErr;

    return json({ gathering_id: gatheringId, response });
}

// ── Action: cancel ────────────────────────────────────────────────────────────

async function handleCancel(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any,
    user: { id: string },
    body: Record<string, unknown>,
): Promise<Response> {
    const gatheringId = body.gathering_id;
    if (typeof gatheringId !== 'string' || !UUID_RE.test(gatheringId)) {
        return err('INVALID_INPUT', 'gathering_id is required');
    }

    const { data: gathering, error: gatheringErr } = await supabase
        .from('gatherings')
        .select('id, host_user_id, status')
        .eq('id', gatheringId)
        .maybeSingle();
    if (gatheringErr) throw gatheringErr;
    if (!gathering) {
        return err('NOT_FOUND', 'Gathering not found', 404);
    }
    if (gathering.host_user_id !== user.id) {
        return err('NOT_HOST', 'Only the host can call this off', 403);
    }
    if (gathering.status !== 'proposed') {
        return err('GATHERING_CLOSED', 'Only a proposed gathering can be cancelled', 409);
    }

    const { data: cancelledRows, error: cancelErr } = await supabase
        .from('gatherings')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', gatheringId)
        .eq('host_user_id', user.id)
        .eq('status', 'proposed')
        .select('id');
    if (cancelErr) throw cancelErr;
    if (!cancelledRows || cancelledRows.length === 0) {
        // Dispatch/expiry won the race between the status read and this update.
        return err('GATHERING_CLOSED', 'Only a proposed gathering can be cancelled', 409);
    }

    return json({ cancelled: true });
}

// ── Action: delete ────────────────────────────────────────────────────────────

async function handleDelete(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any,
    user: { id: string },
    body: Record<string, unknown>,
): Promise<Response> {
    const gatheringId = body.gathering_id;
    if (typeof gatheringId !== 'string' || !UUID_RE.test(gatheringId)) {
        return err('INVALID_INPUT', 'gathering_id is required');
    }

    const { data: gathering, error: gatheringErr } = await supabase
        .from('gatherings')
        .select('id, host_user_id, status, supper_id')
        .eq('id', gatheringId)
        .maybeSingle();
    if (gatheringErr) throw gatheringErr;
    if (!gathering) {
        return err('NOT_FOUND', 'Gathering not found', 404);
    }
    if (gathering.host_user_id !== user.id) {
        return err('NOT_HOST', 'Only the host can clear this', 403);
    }
    if (gathering.status === 'dispatched' && gathering.supper_id) {
        return err('GATHERING_LOCKED', 'This gathering became a supper — cancel the supper instead', 409);
    }

    // Guarded hard delete (rsvps cascade). The .or() re-asserts the live-supper
    // block so a dispatch that wins the race between the read above and this
    // call can't have its supper history erased (dispatch holds FOR UPDATE row
    // locks, so this delete waits and then re-evaluates against the new state).
    const { data: deletedRows, error: deleteErr } = await supabase
        .from('gatherings')
        .delete()
        .eq('id', gatheringId)
        .eq('host_user_id', user.id)
        .or('status.neq.dispatched,supper_id.is.null')
        .select('id');
    if (deleteErr) throw deleteErr;
    if (!deletedRows || deletedRows.length === 0) {
        return err('GATHERING_LOCKED', 'This gathering became a supper — cancel the supper instead', 409);
    }

    return json({ deleted: true });
}
