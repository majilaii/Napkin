// Redeploy marker (2026-07-08, TICKET-133): emitTableInvite now carries the
// invitation_id + member_count, and emitTableInviteAccepted is new — this
// _shared touch makes the next run redeploy every function that imports it.
/**
 * TICKET-048: Best-effort notification fan-out helpers.
 *
 * Each export wraps a notifications INSERT in try/catch. A failed insert
 * NEVER throws — it logs and returns. This keeps producers (entry create,
 * add_member, top_four_set) working even when the inbox has issues.
 *
 * The invariant "actor ≠ recipient" is enforced here (uniqueExcluding /
 * early-return guard). Producers must not rely on DB constraints alone.
 */
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { reportError } from './report.ts';

interface BaseFanout {
    actorUserId: string;
    recipientUserIds: string[];   // helper de-dupes and excludes actor
}

/**
 * Emit `friend_logged` notifications to a set of recipients.
 * Both subject_entry_id AND subject_restaurant_id must be provided —
 * the per-kind CHECK constraint on the notifications table enforces this,
 * and hydration reads restaurant directly from the notification row.
 */
export async function emitFriendLogged(
    supabase: SupabaseClient,
    args: BaseFanout & { entryId: string; restaurantId: string },
): Promise<void> {
    const recipients = uniqueExcluding(args.recipientUserIds, args.actorUserId);
    if (recipients.length === 0) return;
    const rows = recipients.map(uid => ({
        user_id: uid,
        kind: 'friend_logged',
        actor_user_id: args.actorUserId,
        subject_entry_id: args.entryId,
        subject_restaurant_id: args.restaurantId,
    }));
    try {
        const { error } = await supabase.from('notifications').insert(rows);
        if (error) {
            console.error('[notify] friend_logged insert failed:', error.message);
            reportError(error, { fn: 'notify', action: 'friend_logged' });
        }
    } catch (e) {
        console.error('[notify] friend_logged threw:', e);
        reportError(e, { fn: 'notify', action: 'friend_logged' });
    }
}

/**
 * TICKET-133: Emit a `table_invite` notification to a PENDING invitee.
 * Carries the invitation_id (so the inbox can respond without an extra lookup)
 * and a denormalized member_count (stable-enough, saves a per-row count at
 * hydration). Status is joined LIVE at read time — it changes after this insert.
 * No row is emitted if actor === recipient.
 */
export async function emitTableInvite(
    supabase: SupabaseClient,
    args: {
        actorUserId: string;
        recipientUserId: string;
        tableId: string;
        invitationId: string;
        memberCount: number;
    },
): Promise<void> {
    if (args.recipientUserId === args.actorUserId) return;
    try {
        const { error } = await supabase.from('notifications').insert({
            user_id: args.recipientUserId,
            kind: 'table_invite',
            actor_user_id: args.actorUserId,
            subject_table_id: args.tableId,
            subject_meta: { invitation_id: args.invitationId, member_count: args.memberCount },
        });
        if (error) {
            console.error('[notify] table_invite insert failed:', error.message);
            reportError(error, { fn: 'notify', action: 'table_invite' });
        }
    } catch (e) {
        console.error('[notify] table_invite threw:', e);
        reportError(e, { fn: 'notify', action: 'table_invite' });
    }
}

/**
 * TICKET-133: Emit a `table_invite_accepted` notification to the INVITER when
 * their invitee accepts. recipient = inviter, actor = joiner, subject = table.
 * Best-effort (same try/catch idiom) — a failed insert never blocks the seat.
 */
export async function emitTableInviteAccepted(
    supabase: SupabaseClient,
    args: { actorUserId: string; recipientUserId: string; tableId: string },
): Promise<void> {
    if (args.recipientUserId === args.actorUserId) return;
    try {
        const { error } = await supabase.from('notifications').insert({
            user_id: args.recipientUserId,
            kind: 'table_invite_accepted',
            actor_user_id: args.actorUserId,
            subject_table_id: args.tableId,
        });
        if (error) {
            console.error('[notify] table_invite_accepted insert failed:', error.message);
            reportError(error, { fn: 'notify', action: 'table_invite_accepted' });
        }
    } catch (e) {
        console.error('[notify] table_invite_accepted threw:', e);
        reportError(e, { fn: 'notify', action: 'table_invite_accepted' });
    }
}

/**
 * Emit `top_four_swap` notifications to all other Table members.
 * addedName / removedName are denormalized into subject_meta at insert time
 * so hydration doesn't need an extra join.
 */
export async function emitTopFourSwap(
    supabase: SupabaseClient,
    args: BaseFanout & {
        tableId: string;
        addedName: string;
        removedName: string;
    },
): Promise<void> {
    const recipients = uniqueExcluding(args.recipientUserIds, args.actorUserId);
    if (recipients.length === 0) return;
    const rows = recipients.map(uid => ({
        user_id: uid,
        kind: 'top_four_swap',
        actor_user_id: args.actorUserId,
        subject_table_id: args.tableId,
        subject_meta: { added_name: args.addedName, removed_name: args.removedName },
    }));
    try {
        const { error } = await supabase.from('notifications').insert(rows);
        if (error) {
            console.error('[notify] top_four_swap insert failed:', error.message);
            reportError(error, { fn: 'notify', action: 'top_four_swap' });
        }
    } catch (e) {
        console.error('[notify] top_four_swap threw:', e);
        reportError(e, { fn: 'notify', action: 'top_four_swap' });
    }
}

/**
 * TICKET-123: Emit a self-directed `import_done` row (no actor — "your import
 * finished", not "someone did X to you"). The recipient IS the sharer.
 *
 * Used by BOTH the server auto-save path (resolve-url?action=save_spots, outcome
 * 'saved') AND the notifications `emit_self` action (outcome 'review' | 'failed',
 * called by the client drain which has no service-role INSERT of its own). DRY:
 * one insert shape for all three outcomes.
 *
 * Best-effort — a failed insert NEVER throws (never fail an import over a
 * notification). subject_meta must carry `outcome` (notifications_import_done_shape
 * CHECK); actor_user_id is null (notifications_actor_not_self allows it).
 */
export async function emitImportDone(
    supabase: SupabaseClient,
    args: {
        recipientUserId: string;
        jobId: string | null;
        count: number;
        outcome: 'saved' | 'review' | 'failed';
    },
): Promise<void> {
    try {
        const { error } = await supabase.from('notifications').insert({
            user_id: args.recipientUserId,
            kind: 'import_done',
            actor_user_id: null,
            subject_meta: { job_id: args.jobId, count: args.count, outcome: args.outcome },
        });
        if (error) {
            console.error('[notify] import_done insert failed:', error.message);
            reportError(error, { fn: 'notify', action: 'import_done' });
        }
    } catch (e) {
        console.error('[notify] import_done threw:', e);
        reportError(e, { fn: 'notify', action: 'import_done' });
    }
}

function uniqueExcluding(ids: string[], exclude: string): string[] {
    return [...new Set(ids.filter(id => id && id !== exclude))];
}
