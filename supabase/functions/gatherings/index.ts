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
 *   rsvp — a table member answers 'in' | 'out' | 'counter' on a proposed
 *     gathering. Upsert on (gathering_id, user_id) so changing your answer is one
 *     call. A 'counter' ("can't that day — try this one") carries counter_on
 *     (>= today); 'in'/'out' clear it (TICKET-127).
 *
 *   reschedule — the host moves gather_on to a new date (proposed only,
 *     TICKET-127). RSVPs whose counter_on = the new date flip to 'in'; every
 *     prior 'in' is DELETED (they said yes to a different day → unanswered) and
 *     the host is re-asserted 'in' (they chose the new date); 'out' and counters
 *     for other dates persist. rescheduled_from records the old date so the card
 *     can show "date moved · was <old>". Atomic via fn_reschedule_gathering.
 *
 *   list_upcoming — a table member reads the Table's future plans: proposed +
 *     dispatched gatherings with gather_on >= today, ascending (TICKET-127/128).
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
import { reportError } from '../_shared/report.ts';

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
        if (action === 'reschedule') {
            return await handleReschedule(supabase, user, body);
        }
        if (action === 'list_upcoming') {
            return await handleListUpcoming(supabase, user, body);
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
        reportError(error, { fn: 'gatherings' });
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
    const rawCounterOn = body.counter_on;

    if (typeof gatheringId !== 'string' || !UUID_RE.test(gatheringId)) {
        return err('INVALID_INPUT', 'gathering_id is required');
    }
    if (response !== 'in' && response !== 'out' && response !== 'counter') {
        return err('INVALID_INPUT', "response must be 'in', 'out' or 'counter'");
    }

    // A counter must name a future-or-today date; in/out never carry one. The
    // paired CHECK enforces this at the DB too, but validate here for a clean 400.
    let counterOn: string | null = null;
    if (response === 'counter') {
        if (typeof rawCounterOn !== 'string' || !DATE_RE.test(rawCounterOn) ||
            Number.isNaN(Date.parse(`${rawCounterOn}T00:00:00Z`))) {
            return err('INVALID_INPUT', 'counter_on must be a valid YYYY-MM-DD date');
        }
        // >= today (HKT), within 90 days — same window as create/reschedule.
        // Lexical compare is safe on zero-padded YYYY-MM-DD.
        const today = todayHKT();
        if (rawCounterOn < today) {
            return err('INVALID_INPUT', 'counter_on cannot be in the past');
        }
        if (rawCounterOn > addDays(today, MAX_DAYS_AHEAD)) {
            return err('INVALID_INPUT', `counter_on must be within ${MAX_DAYS_AHEAD} days`);
        }
        counterOn = rawCounterOn;
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
                counter_on: counterOn, // null for in/out — clears a prior counter
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'gathering_id,user_id' },
        );
    if (upsertErr) throw upsertErr;

    return json({ gathering_id: gatheringId, response, counter_on: counterOn });
}

// ── Action: reschedule ──────────────────────────────────────────────────────
// Host moves gather_on to a new date (proposed only). Amended AC8:
//   • RSVPs with counter_on = new_date  → flip to 'in' (counter_on cleared).
//   • every prior 'in'                  → DELETED (reset to unanswered).
//   • the host                          → re-asserted 'in' (chose the new date).
//   • 'out' + counters for other dates  → persist untouched.
//   • rescheduled_from = the old gather_on (the "date moved · was <old>" breadcrumb).
// The read + host/status/date-window checks below give clean 400/403/409 codes;
// the whole re-date then runs as ONE atomic SECDEF call (fn_reschedule_gathering)
// whose guarded claim on status='proposed' is the authoritative race guard — if
// dispatch/cancel won the race it returns NULL and no RSVP is touched (mirrors
// cancel/delete doctrine). One-active-per-spot index is unaffected — same row mutates.
async function handleReschedule(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any,
    user: { id: string },
    body: Record<string, unknown>,
): Promise<Response> {
    const gatheringId = body.gathering_id;
    const newDate = body.new_date;

    if (typeof gatheringId !== 'string' || !UUID_RE.test(gatheringId)) {
        return err('INVALID_INPUT', 'gathering_id is required');
    }
    if (typeof newDate !== 'string' || !DATE_RE.test(newDate) ||
        Number.isNaN(Date.parse(`${newDate}T00:00:00Z`))) {
        return err('INVALID_INPUT', 'new_date must be a valid YYYY-MM-DD date');
    }
    const today = todayHKT();
    if (newDate < today) {
        return err('INVALID_INPUT', 'new_date cannot be in the past');
    }
    if (newDate > addDays(today, MAX_DAYS_AHEAD)) {
        return err('INVALID_INPUT', `new_date must be within ${MAX_DAYS_AHEAD} days`);
    }

    const { data: gathering, error: gatheringErr } = await supabase
        .from('gatherings')
        .select('id, host_user_id, status, gather_on')
        .eq('id', gatheringId)
        .maybeSingle();
    if (gatheringErr) throw gatheringErr;
    if (!gathering) {
        return err('NOT_FOUND', 'Gathering not found', 404);
    }
    if (gathering.host_user_id !== user.id) {
        return err('NOT_HOST', 'Only the host can move the date', 403);
    }
    if (gathering.status !== 'proposed') {
        return err('GATHERING_CLOSED', 'Only a proposed gathering can be moved', 409);
    }

    const oldDate = gathering.gather_on as string;
    if (newDate === oldDate) {
        return err('INVALID_INPUT', 'new_date is the current date');
    }

    // The whole re-date is ONE atomic SECDEF call (claim + prior-'in' delete +
    // counter flip + host re-'in'). The read+checks above give clean 400/403/409
    // codes; the rpc's claim clause (host_user_id + status='proposed' + date-moved)
    // is the authoritative race guard, so a lost race never half-mutates the RSVPs.
    // A NULL return = the claim matched nothing (dispatch/cancel/expiry won) → 409.
    const { data: moved, error: rpcErr } = await supabase.rpc('fn_reschedule_gathering', {
        p_gathering_id: gatheringId,
        p_host: user.id,
        p_new_date: newDate,
    });
    if (rpcErr) throw rpcErr;
    if (!moved) {
        return err('GATHERING_CLOSED', 'Only a proposed gathering can be moved', 409);
    }

    return json(moved);
}

// ── Action: list_upcoming ───────────────────────────────────────────────────
// The Table-screen "what's booked" strip: proposed + dispatched gatherings whose
// day hasn't passed, ascending by date. Member-gated (member_id doctrine).
async function handleListUpcoming(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any,
    user: { id: string },
    body: Record<string, unknown>,
): Promise<Response> {
    const tableId = body.table_id;
    if (typeof tableId !== 'string' || !UUID_RE.test(tableId)) {
        return err('INVALID_INPUT', 'table_id is required');
    }

    if (!(await isTableMember(supabase, tableId, user.id))) {
        return err('FORBIDDEN', 'Not a member of this table', 403);
    }

    const today = todayHKT();
    const { data: rows, error: rowsErr } = await supabase
        .from('gatherings')
        .select('id, restaurant_id, gather_on, status, supper_id')
        .eq('table_id', tableId)
        .in('status', ['proposed', 'dispatched'])
        .gte('gather_on', today)
        .order('gather_on', { ascending: true });
    if (rowsErr) throw rowsErr;

    const gatherings = (rows ?? []) as {
        id: string; restaurant_id: string; gather_on: string;
        status: string; supper_id: string | null;
    }[];

    if (gatherings.length === 0) {
        return json({ rows: [] });
    }

    const gatheringIds = gatherings.map((g) => g.id);
    const restIds = [...new Set(gatherings.map((g) => g.restaurant_id).filter(Boolean))];

    // Restaurants (id + name only — the strip is a one-liner).
    const { data: restaurants } = restIds.length > 0
        ? await supabase.from('restaurants').select('id, name').in('id', restIds)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        : { data: [] as any[] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const restMap = new Map((restaurants ?? []).map((r: any) => [r.id, r]));

    // Current roster — in_count intersects 'in' RSVPs with live members so an
    // ex-member's stale 'in' never inflates the count (member_id doctrine).
    const { data: rosterRows } = await supabase
        .from('table_members')
        .select('member_id')
        .eq('table_id', tableId);
    const roster = new Set(((rosterRows ?? []) as { member_id: string }[]).map((m) => m.member_id));

    // RSVPs for these gatherings: in_count + the caller's own response.
    const { data: rsvpRows } = await supabase
        .from('gathering_rsvps')
        .select('gathering_id, user_id, response')
        .in('gathering_id', gatheringIds);
    const inCountByGathering = new Map<string, number>();
    const viewerRespByGathering = new Map<string, string>();
    for (const r of (rsvpRows ?? []) as { gathering_id: string; user_id: string; response: string }[]) {
        if (r.response === 'in' && roster.has(r.user_id)) {
            inCountByGathering.set(r.gathering_id, (inCountByGathering.get(r.gathering_id) ?? 0) + 1);
        }
        if (r.user_id === user.id) {
            viewerRespByGathering.set(r.gathering_id, r.response);
        }
    }

    const out = gatherings.map((g) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rest = (restMap.get(g.restaurant_id) ?? null) as any;
        return {
            id: g.id,
            gather_on: g.gather_on,
            status: g.status,
            restaurant: rest ? { id: rest.id, name: rest.name ?? null } : null,
            in_count: inCountByGathering.get(g.id) ?? 0,
            supper_id: g.supper_id ?? null,
            viewer_response: (viewerRespByGathering.get(g.id) ?? null) as
                'in' | 'out' | 'counter' | null,
        };
    });

    return json({ rows: out });
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
