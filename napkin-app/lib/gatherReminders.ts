/**
 * gatherReminders — device-LOCAL reminders for gatherings, per-channel
 * (TICKET-128 Part B day-of; TICKET-159 morning-after + stateful reconcile).
 *
 * Two channels per gathering, each its own one-shot OS notification:
 *   day_of        — 10:00 local on gather_on:      `tonight — <restaurant> with <table>`
 *   morning_after — 10:00 local on gather_on + 1:  `last night — <restaurant> · add your take`
 * Both deep-link `/gathering/<id>` via content.data.url (the gathering screen
 * routes onward by live state — dispatched → see the table, expired → the
 * rescue CTA). NO remote push, NO server (doctrine) — this is entirely
 * client-side, reconciled against the `reconcile_window` read.
 *
 * TICKET-159 reconcile model (findings 5/12/13):
 *   - Driven by the AUTHORITATIVE window read (yesterday..+90d INCLUDING
 *     cancelled/expired rows, with viewer_response + restaurant id/name).
 *     Keep/cancel is decided purely from STATE: cancelled → cancel; viewer no
 *     longer 'in' → cancel; date moved → reschedule; restaurant id OR name
 *     changed → reschedule with fresh copy. Expired rows KEEP the
 *     morning-after ping (it lands on the rescue CTA — intended). A row absent
 *     from the window can only mean hard-deleted → cancel.
 *   - Records are keyed (gathering_id, channel) and persist
 *     { notifId, gather_on, restaurant_id, restaurant_name, table_id }.
 *   - Reconciliation is SERIALIZED through a module-level promise queue (no
 *     concurrent-pass races) and cross-checked against
 *     getAllScheduledNotificationsAsync() via the stable
 *     content.data = { gatheringId, channel, tableId } identity.
 *   - Exactly-once per device install: a one-shot schedule + the past-fire
 *     guard (never schedule a moment that already passed) + post-fire record
 *     cleanup ⇒ never a re-nudge, even if the take is still unadded.
 *     Multi-device / reinstall may double-ping — accepted and documented.
 *
 * The diff decision (planChannelReminders) is PURE — no native, no storage —
 * so the whole schedule/cancel/reschedule matrix is unit-testable without a
 * build. Native calls + storage I/O live in the impure pass and are all
 * try/catch guarded; a missing module or an OS denial makes the pass a silent
 * no-op (never prompts; TICKET-120's soft-prompt cadence owns asking).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getPermissionState } from '@/lib/localNotify';
import type { ReminderWindowRow } from '@/hooks/gatherings/useReminderWindow';

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

// ── Storage (per-channel records) ────────────────────────────────────────────

/** TICKET-128's single-channel v1 map — drained once, then removed. */
export const GATHER_REMINDERS_LEGACY_KEY = 'napkin.gatherReminders.v1';
/** The per-channel record map (TICKET-159). */
export const GATHER_REMINDERS_KEY = 'napkin.gatherReminders.v2';

export type ReminderChannel = 'day_of' | 'morning_after';

/** One scheduled channel reminder, keyed in the map by `${gatheringId}:${channel}`. */
export interface StoredChannelReminder {
    /** The OS notification identifier (used to cancel). */
    notifId: string;
    gathering_id: string;
    channel: ReminderChannel;
    /** 'YYYY-MM-DD' the gathering was scheduled for — drives re-date detection. */
    gather_on: string;
    /** Restaurant identity + name at schedule time — either changing = copy refresh. */
    restaurant_id: string;
    restaurant_name: string;
    /** Scopes cancel/drop so one table's pass never touches another's records. */
    table_id: string;
}

/** `${gathering_id}:${channel}` → StoredChannelReminder. */
export type ChannelReminderMap = Record<string, StoredChannelReminder>;

export function reminderKey(gatheringId: string, channel: ReminderChannel): string {
    return `${gatheringId}:${channel}`;
}

export async function readReminderMap(): Promise<ChannelReminderMap> {
    try {
        const raw = await AsyncStorage.getItem(GATHER_REMINDERS_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object') return {};
        const out: ChannelReminderMap = {};
        for (const [key, v] of Object.entries(parsed as Record<string, unknown>)) {
            const r = v as Partial<StoredChannelReminder> | null;
            if (
                r &&
                typeof r.notifId === 'string' &&
                typeof r.gathering_id === 'string' &&
                (r.channel === 'day_of' || r.channel === 'morning_after') &&
                typeof r.gather_on === 'string' &&
                typeof r.table_id === 'string'
            ) {
                out[key] = {
                    notifId: r.notifId,
                    gathering_id: r.gathering_id,
                    channel: r.channel,
                    gather_on: r.gather_on,
                    restaurant_id: typeof r.restaurant_id === 'string' ? r.restaurant_id : '',
                    restaurant_name: typeof r.restaurant_name === 'string' ? r.restaurant_name : '',
                    table_id: r.table_id,
                };
            }
        }
        return out;
    } catch {
        return {};
    }
}

async function writeReminderMap(map: ChannelReminderMap): Promise<void> {
    try {
        await AsyncStorage.setItem(GATHER_REMINDERS_KEY, JSON.stringify(map));
    } catch {
        /* best-effort — a lost map only means a redundant reschedule next pass */
    }
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** Local 'YYYY-MM-DD' for `date` (defaults to now). */
export function localTodayYmd(date: Date = new Date()): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** 'YYYY-MM-DD' + n days → 'YYYY-MM-DD' (UTC-safe day arithmetic). */
export function addDaysYmd(ymd: string, days: number): string {
    const d = new Date(`${ymd}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return ymd;
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/**
 * The absolute local fire moment for a channel: 10:00 local on gather_on
 * (day_of) or gather_on + 1 (morning_after). NaN when the day is malformed.
 */
export function fireMomentMs(channel: ReminderChannel, gatherOn: string): number {
    const day = channel === 'morning_after' ? addDaysYmd(gatherOn, 1) : gatherOn;
    const parts = day.split('-');
    if (parts.length !== 3) return Number.NaN;
    const year = Number(parts[0]);
    const month = Number(parts[1]); // 1-based
    const dayNum = Number(parts[2]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(dayNum)) {
        return Number.NaN;
    }
    return new Date(year, month - 1, dayNum, 10, 0, 0, 0).getTime();
}

/** Reminder body copy per channel — lowercase, Heirloom punctuation. */
export function reminderBody(
    channel: ReminderChannel,
    restaurantName: string,
    tableName: string,
): string {
    return channel === 'day_of'
        ? `tonight — ${restaurantName} with ${tableName}`
        : `last night — ${restaurantName} · add your take`;
}

/** True when the viewer should carry this channel's ping for this row — pure STATE. */
export function isChannelEligible(
    row: ReminderWindowRow,
    channel: ReminderChannel,
    nowMs: number,
): boolean {
    // The viewer's RSVP at the last reconcile approximates the confirmed roster
    // (accepted); flipping out of 'in' cancels on the next pass.
    if (row.viewer_response !== 'in') return false;
    // Cancelled gathers hold no ping, either channel.
    if (row.status === 'cancelled') return false;
    // The day-of reminder is a *plan* nudge — a dead plan (expired) doesn't get
    // one. The morning-after ping deliberately survives expiry (rescue CTA).
    if (channel === 'day_of' && row.status !== 'proposed' && row.status !== 'dispatched') {
        return false;
    }
    // Past-fire guard: never (re)schedule a moment that already passed — this is
    // both the "never nag twice" rule and the natural date-window gate.
    const fireAt = fireMomentMs(channel, row.gather_on);
    return Number.isFinite(fireAt) && fireAt > nowMs;
}

// ── Pure diff (no native, no storage — the unit-tested core) ─────────────────

/** One OS-scheduled gather notification, as identified by its stable data payload. */
export interface OsScheduledReminder {
    notifId: string;
    gatheringId: string;
    channel: ReminderChannel;
    tableId: string;
}

/** One (gathering, channel) the impure pass must schedule fresh. */
export interface ChannelToSchedule {
    key: string;
    gatheringId: string;
    channel: ReminderChannel;
    gather_on: string;
    restaurant_id: string;
    restaurant_name: string;
}

/** The set of actions a reconcile pass must take, derived purely from inputs. */
export interface ChannelReminderPlan {
    toSchedule: ChannelToSchedule[];
    /** OS notifIds to cancel (superseded/reschedules + state says "no ping"). */
    toCancel: string[];
    /** map keys to remove (cancelled/dropped/fired records). */
    toDrop: string[];
    /** map keys left exactly as they are. */
    unchanged: string[];
}

/**
 * Pure per-table reconcile decision. `rows` is the table's reconcile window
 * (INCLUDING cancelled/expired); `existing` is the whole cross-table record
 * map; `osScheduled` is the OS's actual scheduled set (matched by the stable
 * data identity); `nowMs` anchors the past-fire guard.
 *
 * Scoping: only records/OS items owned by `tableId` are ever cancelled or
 * dropped — other tables' state passes through untouched.
 */
export function planChannelReminders(
    rows: ReminderWindowRow[],
    existing: ChannelReminderMap,
    osScheduled: OsScheduledReminder[],
    nowMs: number,
    tableId: string,
): ChannelReminderPlan {
    const plan: ChannelReminderPlan = { toSchedule: [], toCancel: [], toDrop: [], unchanged: [] };
    const CHANNELS: ReminderChannel[] = ['day_of', 'morning_after'];

    // Desired state, from STATE alone.
    const desired = new Map<string, { row: ReminderWindowRow; channel: ReminderChannel }>();
    for (const row of rows) {
        for (const channel of CHANNELS) {
            if (isChannelEligible(row, channel, nowMs)) {
                desired.set(reminderKey(row.id, channel), { row, channel });
            }
        }
    }

    const osByKey = new Map<string, OsScheduledReminder>();
    for (const os of osScheduled) {
        osByKey.set(reminderKey(os.gatheringId, os.channel), os);
    }

    const scheduleFresh = (key: string, row: ReminderWindowRow, channel: ReminderChannel) => {
        plan.toSchedule.push({
            key,
            gatheringId: row.id,
            channel,
            gather_on: row.gather_on,
            restaurant_id: row.restaurant?.id ?? '',
            restaurant_name: row.restaurant?.name ?? '',
        });
    };

    // 1) Desired keys: new / rescheduled / copy-refresh / unchanged.
    for (const [key, { row, channel }] of desired) {
        const prev = existing[key];
        const os = osByKey.get(key);
        if (!prev) {
            // No record. If the OS still holds one for this key (lost storage),
            // supersede it — cancel + schedule fresh — so a rebuilt map can
            // never leave TWO live pings for the same (gathering, channel).
            if (os) plan.toCancel.push(os.notifId);
            scheduleFresh(key, row, channel);
            continue;
        }
        const dateMoved = prev.gather_on !== row.gather_on;
        const copyChanged =
            prev.restaurant_id !== (row.restaurant?.id ?? '') ||
            prev.restaurant_name !== (row.restaurant?.name ?? '');
        if (dateMoved || copyChanged) {
            // Reschedule: cancel the stale notif(s), schedule the fresh day/copy.
            plan.toCancel.push(prev.notifId);
            if (os && os.notifId !== prev.notifId) plan.toCancel.push(os.notifId);
            scheduleFresh(key, row, channel);
            continue;
        }
        // Same date + same copy — but trust the OS, not the map: a record whose
        // notification the OS no longer holds (purged/reinstall) is re-scheduled
        // while its moment is still ahead (the past-fire guard above already
        // filtered fired ones out of `desired`).
        if (!os) {
            scheduleFresh(key, row, channel);
            continue;
        }
        plan.unchanged.push(key);
    }

    // 2) Existing records owned by THIS table that are no longer desired.
    for (const [key, prev] of Object.entries(existing)) {
        const inScope = prev.table_id === tableId || prev.table_id === '';
        if (!inScope || desired.has(key)) continue;
        const fireAt = fireMomentMs(prev.channel, prev.gather_on);
        if (Number.isFinite(fireAt) && fireAt <= nowMs) {
            // Post-fire cleanup: the moment passed (it fired or never will) —
            // drop the record; nothing to cancel. NEVER re-nudge.
            plan.toDrop.push(key);
        } else {
            // State says no ping (cancelled / viewer flipped out / expired
            // day-of / row hard-deleted from the window) → cancel + forget.
            plan.toCancel.push(prev.notifId);
            plan.toDrop.push(key);
        }
    }

    // 3) OS orphans owned by THIS table: scheduled notifications neither the
    // map nor the desired state knows about (lost storage + the plan died /
    // viewer opted out) → cancel, so a lost map can never leave a stale ping
    // behind. Desired-but-unmapped keys were already superseded in step 1.
    const cancelling = new Set(plan.toCancel);
    for (const [key, os] of osByKey) {
        if (os.tableId !== tableId) continue;
        if (existing[key] || desired.has(key) || cancelling.has(os.notifId)) continue;
        plan.toCancel.push(os.notifId);
    }

    return plan;
}

/** True when the plan changes nothing — lets the impure pass skip all I/O. */
export function isNoopPlan(plan: ChannelReminderPlan): boolean {
    return plan.toSchedule.length === 0 && plan.toCancel.length === 0 && plan.toDrop.length === 0;
}

// ── Native schedule/cancel (guarded) ─────────────────────────────────────────

/**
 * Schedule one one-shot notif for a channel. Returns the OS notifId, or null if
 * the module is absent, the day is malformed, the moment already passed, or the
 * native call throws. Never throws. content.data carries the stable
 * { gatheringId, channel, tableId } identity + the `/gathering/<id>` deep link
 * (the root layout's tap listener routes data.url generically).
 */
async function scheduleOne(
    item: ChannelToSchedule,
    tableId: string,
    body: string,
): Promise<string | null> {
    const N = getNotif();
    if (!N) return null;
    const fireAtMs = fireMomentMs(item.channel, item.gather_on);
    if (!Number.isFinite(fireAtMs) || fireAtMs <= Date.now()) return null;

    try {
        const id = await N.scheduleNotificationAsync({
            content: {
                body,
                data: {
                    gatheringId: item.gatheringId,
                    channel: item.channel,
                    tableId,
                    url: `/gathering/${item.gatheringId}`,
                },
            },
            trigger: {
                type: N.SchedulableTriggerInputTypes.DATE,
                date: new Date(fireAtMs),
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

/** The OS's actual scheduled gather reminders, identified by content.data. */
async function readOsScheduled(): Promise<OsScheduledReminder[]> {
    const N = getNotif();
    if (!N) return [];
    try {
        const all = await N.getAllScheduledNotificationsAsync();
        const out: OsScheduledReminder[] = [];
        for (const req of all ?? []) {
            const data = (req as { content?: { data?: Record<string, unknown> } })?.content?.data;
            const gatheringId = data?.gatheringId;
            const channel = data?.channel;
            const tableId = data?.tableId;
            const notifId = (req as { identifier?: unknown })?.identifier;
            if (
                typeof notifId === 'string' &&
                typeof gatheringId === 'string' &&
                (channel === 'day_of' || channel === 'morning_after') &&
                typeof tableId === 'string'
            ) {
                out.push({ notifId, gatheringId, channel, tableId });
            }
        }
        return out;
    } catch {
        return [];
    }
}

/** One-time v1 drain: cancel TICKET-128's single-channel notifs + drop the key.
 *  v1 records carried no data payload and no channel — they're superseded, and
 *  the next pass reschedules everything fresh under v2. */
async function drainLegacyV1(): Promise<void> {
    try {
        const raw = await AsyncStorage.getItem(GATHER_REMINDERS_LEGACY_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Record<string, { notifId?: unknown }> | null;
        if (parsed && typeof parsed === 'object') {
            for (const v of Object.values(parsed)) {
                if (typeof v?.notifId === 'string') await cancelOne(v.notifId);
            }
        }
        await AsyncStorage.removeItem(GATHER_REMINDERS_LEGACY_KEY);
    } catch {
        /* best-effort — worst case the v1 notif fires once with the old copy */
    }
}

// ── The reconcile pass (serialized — the one entry point) ────────────────────

/** Module-level promise queue: passes NEVER interleave (finding 12). */
let reconcileChain: Promise<void> = Promise.resolve();

/**
 * Reconcile the device's scheduled gather reminders (both channels) against the
 * table's reconcile-window rows. Serialized across callers; silent no-op
 * without OS permission (never prompts) or when the native module is absent.
 * Fully guarded; safe to call on every refetch.
 *
 * @param rows      the table's reconcile-window rows (incl. cancelled/expired)
 * @param tableName the table's display name (day-of body copy)
 * @param tableId   the table these rows belong to — scopes cancel/drop
 */
export function reconcileGatherReminders(
    rows: ReminderWindowRow[],
    tableName: string,
    tableId: string,
): Promise<void> {
    reconcileChain = reconcileChain
        .then(() => doReconcile(rows, tableName, tableId))
        .catch((err) => {
            /* never let a reminder pass surface an error into the UI */
            if (__DEV__) console.warn('[gatherReminders] reconcile failed', err);
        });
    return reconcileChain;
}

async function doReconcile(
    rows: ReminderWindowRow[],
    tableName: string,
    tableId: string,
): Promise<void> {
    try {
        if (getNotif() === null) return;

        // No permission → don't schedule anything and don't prompt. Cancel every
        // notif we still track (cancel works regardless of authorization) BEFORE
        // clearing the map, so a later re-grant can't double-schedule. Permission
        // is device-global, so a denial moots every table's reminders.
        const permission = await getPermissionState();
        if (permission !== 'granted') {
            const existing = await readReminderMap();
            const keys = Object.keys(existing);
            if (keys.length > 0) {
                for (const key of keys) await cancelOne(existing[key].notifId);
                await writeReminderMap({});
            }
            await drainLegacyV1();
            return;
        }

        await drainLegacyV1();

        const existing = await readReminderMap();
        const osScheduled = await readOsScheduled();
        const plan = planChannelReminders(rows, existing, osScheduled, Date.now(), tableId);
        if (isNoopPlan(plan)) return;

        const next: ChannelReminderMap = { ...existing };

        // Cancel first (reschedule supersedes + drop-offs + OS orphans).
        for (const notifId of plan.toCancel) await cancelOne(notifId);
        for (const key of plan.toDrop) delete next[key];
        // Re-scheduled keys keep their (now-cancelled) entry until the schedule
        // below replaces it; drop them now so a failed schedule leaves no dead id.
        for (const { key } of plan.toSchedule) delete next[key];

        for (const item of plan.toSchedule) {
            const body = reminderBody(item.channel, item.restaurant_name || 'a spot', tableName);
            const notifId = await scheduleOne(item, tableId, body);
            if (notifId) {
                next[item.key] = {
                    notifId,
                    gathering_id: item.gatheringId,
                    channel: item.channel,
                    gather_on: item.gather_on,
                    restaurant_id: item.restaurant_id,
                    restaurant_name: item.restaurant_name,
                    table_id: tableId,
                };
            }
        }

        await writeReminderMap(next);
    } catch (err) {
        /* never let a reminder pass surface an error into the UI */
        if (__DEV__) console.warn('[gatherReminders] reconcile failed', err);
    }
}
