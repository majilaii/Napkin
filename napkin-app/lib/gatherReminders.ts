/**
 * gatherReminders — day-of LOCAL reminders for booked gatherings (TICKET-128 Part B).
 *
 * When a member is `in` on an upcoming gathering, their own device schedules a local
 * notification for the morning of `gather_on` (10:00 local): `tonight — Kono with <table>`.
 * NO remote push, NO server — this is entirely client-side state, reconciled on every
 * upcoming-gatherings refetch. Reuses TICKET-120's expo-notifications binding discipline
 * (getPermissionState + the lazy-require idiom) but owns its own file — localNotify.ts
 * stays untouched (it's separately tested).
 *
 * Reconcile pass (idempotent):
 *   - schedule for every row where viewer_response === 'in' and gather_on >= today,
 *   - cancel for gatherings that dropped off (cancelled/expired/past or viewer no longer in),
 *   - reschedule (cancel old + schedule new) when gather_on moved (TICKET-127 re-date).
 * Idempotency is an AsyncStorage map gathering_id → { notifId, gather_on }.
 *
 * The diff decision (planReminders) is PURE — no native, no storage — so the whole
 * schedule/cancel/reschedule matrix is unit-testable without a build. The native
 * schedule/cancel calls + storage I/O live in reconcileGatherReminders and are all
 * try/catch guarded; a missing module or an OS denial makes the pass a silent no-op
 * (AC9 — never prompts; TICKET-120's soft-prompt cadence owns asking).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getPermissionState } from '@/lib/localNotify';
import type { UpcomingGathering } from '@/hooks/gatherings/useUpcomingGatherings';

// LAZY native binding — identical idiom to localNotify.ts. `require` throws when the
// module isn't in this build; resolve on first CALL, cache null so we probe once.
type ExpoNotifications = typeof import('expo-notifications');
let notifModule: ExpoNotifications | null | undefined;

function getNotif(): ExpoNotifications | null {
    if (notifModule !== undefined) return notifModule;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        notifModule = require('expo-notifications') as ExpoNotifications;
    } catch {
        notifModule = null;
    }
    return notifModule;
}

// ── Storage map (gathering_id → scheduled reminder) ─────────────────────────────

export const GATHER_REMINDERS_KEY = 'napkin.gatherReminders.v1';

/** One scheduled reminder, keyed in the map by gathering id. */
export interface StoredReminder {
    /** The OS notification identifier (used to cancel). */
    notifId: string;
    /** 'YYYY-MM-DD' the notif was scheduled for — drives re-date detection. */
    gather_on: string;
    /**
     * The table this reminder belongs to — scopes the cancel/drop path so a
     * reconcile for one table never cancels another table's reminders. An empty
     * string is the LEGACY sentinel for pre-scoping entries (written before this
     * field existed); they're dropped-and-cancelled defensively on the first pass
     * that touches them, then rescheduled fresh by their own table's next pass.
     */
    table_id: string;
}

/** gathering_id → StoredReminder. */
export type ReminderMap = Record<string, StoredReminder>;

export async function readReminderMap(): Promise<ReminderMap> {
    try {
        const raw = await AsyncStorage.getItem(GATHER_REMINDERS_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object') return {};
        const out: ReminderMap = {};
        for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
            const r = v as Partial<StoredReminder> | null;
            if (r && typeof r.notifId === 'string' && typeof r.gather_on === 'string') {
                // Tolerate legacy entries written before table_id existed: keep them
                // with the '' sentinel so planReminders can migrate them defensively.
                out[id] = {
                    notifId: r.notifId,
                    gather_on: r.gather_on,
                    table_id: typeof r.table_id === 'string' ? r.table_id : '',
                };
            }
        }
        return out;
    } catch {
        return {};
    }
}

async function writeReminderMap(map: ReminderMap): Promise<void> {
    try {
        await AsyncStorage.setItem(GATHER_REMINDERS_KEY, JSON.stringify(map));
    } catch {
        /* best-effort — a lost map only means a redundant reschedule next pass */
    }
}

// ── Pure diff (no native, no storage — the unit-tested core) ─────────────────────

/** The set of actions a reconcile pass must take, derived purely from inputs. */
export interface ReminderPlan {
    /** Gatherings needing a fresh OS schedule (brand-new or re-dated). */
    toSchedule: { id: string; gather_on: string }[];
    /** OS notifIds to cancel (superseded re-dates + gatherings that dropped off). */
    toCancel: string[];
    /** gathering_ids to remove from the map (dropped off — cancelled/past/out/gone). */
    toDrop: string[];
    /** gathering_ids left exactly as they are (already scheduled for the right day). */
    unchanged: string[];
}

/** True when the viewer should carry a day-of reminder for this row. */
function isReminderEligible(row: UpcomingGathering, todayYmd: string): boolean {
    // 'in' on a still-future (or today) plan — proposed OR dispatched both count.
    return row.viewer_response === 'in' && row.gather_on >= todayYmd;
}

/**
 * Pure schedule/cancel/reschedule decision for ONE table's reconcile pass.
 * `rows` are that table's upcoming gatherings; `existing` is the whole cross-table
 * map. `todayYmd` is the local 'YYYY-MM-DD' — string comparison against gather_on
 * is correct for the ISO date form.
 *
 * The drop path is TABLE-SCOPED: only map entries owned by `tableId` (or the ''
 * legacy sentinel, migrated defensively) are considered for cancel + drop. Entries
 * belonging to OTHER tables pass through untouched — this pass has none of their
 * rows, so it must not mistake their absence for a drop-off (the P0 that this fixes).
 */
export function planReminders(
    rows: UpcomingGathering[],
    existing: ReminderMap,
    todayYmd: string,
    tableId: string,
): ReminderPlan {
    const plan: ReminderPlan = { toSchedule: [], toCancel: [], toDrop: [], unchanged: [] };

    // Desired state: eligible rows → gather_on. Last write wins on a duplicate id.
    const desired = new Map<string, string>();
    for (const row of rows) {
        if (isReminderEligible(row, todayYmd)) desired.set(row.id, row.gather_on);
    }

    // New / rescheduled / unchanged.
    for (const [id, gather_on] of desired) {
        const prev = existing[id];
        if (!prev) {
            plan.toSchedule.push({ id, gather_on });
        } else if (prev.gather_on !== gather_on) {
            // Re-dated (TICKET-127): cancel the stale notif, schedule the new day.
            plan.toCancel.push(prev.notifId);
            plan.toSchedule.push({ id, gather_on });
        } else {
            plan.unchanged.push(id);
        }
    }

    // Dropped off: owned by THIS table (or legacy) but no longer an eligible row →
    // cancel + forget. Other tables' entries are out of scope for this pass.
    for (const [id, prev] of Object.entries(existing)) {
        const inScope = prev.table_id === tableId || prev.table_id === '';
        if (inScope && !desired.has(id)) {
            plan.toCancel.push(prev.notifId);
            plan.toDrop.push(id);
        }
    }

    return plan;
}

/** True when the plan changes nothing — lets the impure pass skip all I/O. */
export function isNoopPlan(plan: ReminderPlan): boolean {
    return plan.toSchedule.length === 0 && plan.toCancel.length === 0 && plan.toDrop.length === 0;
}

// ── Native schedule/cancel (guarded) ─────────────────────────────────────────────

/** Local 'YYYY-MM-DD' for `date` (defaults to now). */
export function localTodayYmd(date: Date = new Date()): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** Reminder body copy — lowercase, em-dash: `tonight — Kono with the usuals`. */
export function reminderBody(restaurantName: string, tableName: string): string {
    return `tonight — ${restaurantName} with ${tableName}`;
}

/**
 * Schedule one one-shot notif at 10:00 local on `gather_on`. Returns the OS notifId,
 * or null if the module is absent, the day is malformed, the 10:00 moment is already
 * past, or the native call throws. Never throws.
 *
 * Uses the cross-platform DATE trigger (fires once at an absolute moment) rather than
 * the iOS-only CALENDAR trigger — one code path, no Platform branch. `fireAt` is the
 * absolute 10:00-local instant already computed for the past-guard.
 */
async function scheduleOne(gatherOn: string, body: string): Promise<string | null> {
    const N = getNotif();
    if (!N) return null;
    const parts = gatherOn.split('-');
    if (parts.length !== 3) return null;
    const year = Number(parts[0]);
    const month = Number(parts[1]); // 1-based YYYY-MM-DD component
    const day = Number(parts[2]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;

    // Don't schedule a moment that's already gone (e.g. app opened after 10:00 on the day).
    const fireAt = new Date(year, month - 1, day, 10, 0, 0, 0);
    if (Number.isNaN(fireAt.getTime()) || fireAt.getTime() <= Date.now()) return null;

    try {
        const id = await N.scheduleNotificationAsync({
            content: { body },
            trigger: {
                type: N.SchedulableTriggerInputTypes.DATE,
                date: fireAt,
            },
        });
        return typeof id === 'string' ? id : null;
    } catch {
        return null;
    }
}

async function cancelOne(notifId: string): Promise<void> {
    const N = getNotif();
    if (!N) return;
    try {
        await N.cancelScheduledNotificationAsync(notifId);
    } catch {
        /* best-effort — a stale scheduled notif is harmless */
    }
}

// ── The reconcile pass (the one entry point) ─────────────────────────────────────

/**
 * Reconcile the device's scheduled day-of reminders against the current upcoming rows.
 * Schedules for rows the viewer is `in` on, cancels ones that dropped off, reschedules
 * re-dated ones. Silent no-op without OS permission (AC9 — never prompts) or when the
 * native module is absent. Fully guarded; safe to call on every refetch.
 *
 * @param rows      current upcoming gatherings for the selected table
 * @param tableName the table's display name (for the notif body)
 * @param tableId   the table these rows belong to — scopes the cancel/drop path
 */
export async function reconcileGatherReminders(
    rows: UpcomingGathering[],
    tableName: string,
    tableId: string,
): Promise<void> {
    try {
        // AC9: no permission → don't schedule anything and don't prompt. Cancel every
        // notif we still track (cancelScheduledNotificationAsync works regardless of
        // authorization) BEFORE clearing the map, so a later re-grant can't leave
        // orphaned OS notifs and double-schedule. Permission is device-global, so a
        // denial moots every table's reminders — clearing the whole map is correct.
        if (getNotif() === null) return;
        const permission = await getPermissionState();
        if (permission !== 'granted') {
            const existing = await readReminderMap();
            const ids = Object.keys(existing);
            if (ids.length > 0) {
                for (const id of ids) await cancelOne(existing[id].notifId);
                await writeReminderMap({});
            }
            return;
        }

        const existing = await readReminderMap();
        const plan = planReminders(rows, existing, localTodayYmd(), tableId);
        if (isNoopPlan(plan)) return;

        // Restaurant name lookup for the bodies of the rows we're (re)scheduling.
        const nameById = new Map<string, string>();
        for (const row of rows) nameById.set(row.id, row.restaurant?.name ?? 'a spot');

        const next: ReminderMap = { ...existing };

        // Cancel first (covers both re-date supersedes and drop-offs).
        for (const notifId of plan.toCancel) await cancelOne(notifId);
        for (const id of plan.toDrop) delete next[id];
        // Re-dated ids keep their (now-cancelled) map entry until the reschedule below
        // replaces it; drop them now so a failed reschedule doesn't leave a dead id.
        for (const { id } of plan.toSchedule) delete next[id];

        // Schedule the new/re-dated ones — stamp table_id so future passes scope right.
        for (const { id, gather_on } of plan.toSchedule) {
            const notifId = await scheduleOne(gather_on, reminderBody(nameById.get(id) ?? 'a spot', tableName));
            if (notifId) next[id] = { notifId, gather_on, table_id: tableId };
        }

        await writeReminderMap(next);
    } catch {
        /* never let a reminder pass surface an error into the UI */
    }
}
