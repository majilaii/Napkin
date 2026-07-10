/**
 * gatherReminders per-channel diff tests (TICKET-128 Part B → TICKET-159).
 *
 * Exercises the PURE reconcile decision (planChannelReminders) across the
 * design's mandated matrix: expired-KEEPS-the-morning-after, cancelled-cancels,
 * viewer-flips-out cancels, date-move reschedules, restaurant id/name change
 * copy-refreshes, post-fire cleanup, cross-table isolation, and the
 * OS-truth reconcile (lost-map orphans / lost-OS reschedules). The pure diff is
 * native-free by design so the whole matrix runs without a build.
 *
 * Impure paths covered against mocks: the permission-not-granted branch
 * (cancels every tracked notif before clearing the map) and the promise-queue
 * serialization (two overlapping passes never interleave — finding 12).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getPermissionState } from '@/lib/localNotify';
import {
    planChannelReminders,
    isNoopPlan,
    isChannelEligible,
    reminderBody,
    reminderKey,
    fireMomentMs,
    addDaysYmd,
    localTodayYmd,
    readReminderMap,
    reconcileGatherReminders,
    GATHER_REMINDERS_KEY,
    GATHER_REMINDERS_LEGACY_KEY,
    type ChannelReminderMap,
    type StoredChannelReminder,
    type ReminderChannel,
    type OsScheduledReminder,
} from './gatherReminders';
import type { ReminderWindowRow } from '@/hooks/gatherings/useReminderWindow';

jest.mock('@/lib/localNotify', () => ({
    getPermissionState: jest.fn(),
}));
jest.mock(
    'expo-notifications',
    () => ({
        scheduleNotificationAsync: jest.fn(async () => 'notif-generated'),
        cancelScheduledNotificationAsync: jest.fn(async () => undefined),
        getAllScheduledNotificationsAsync: jest.fn(async () => []),
        SchedulableTriggerInputTypes: { DATE: 'date', CALENDAR: 'calendar' },
    }),
    { virtual: true },
);

const mockPerm = getPermissionState as jest.MockedFunction<typeof getPermissionState>;
// requireMock (not a static import) so tsc never tries to resolve expo-notifications
// here — the module is virtual-mocked and only present at runtime under jest.
const mockCancel = jest.requireMock('expo-notifications').cancelScheduledNotificationAsync as jest.Mock;
const mockSchedule = jest.requireMock('expo-notifications').scheduleNotificationAsync as jest.Mock;

const TABLE_A = 'table-a';
const TABLE_B = 'table-b';
// A fixed "now": 2026-07-07 08:00 local (before any 10:00 fire moment today).
const NOW = new Date(2026, 6, 7, 8, 0, 0, 0).getTime();
const TODAY = '2026-07-07';

function row(over: Partial<ReminderWindowRow> & { id: string }): ReminderWindowRow {
    return {
        id: over.id,
        gather_on: over.gather_on ?? '2026-07-10',
        status: over.status ?? 'proposed',
        supper_id: over.supper_id ?? null,
        restaurant: 'restaurant' in over ? (over.restaurant ?? null) : { id: 'r1', name: 'Kono' },
        viewer_response: 'viewer_response' in over ? (over.viewer_response ?? null) : 'in',
    };
}

/** Build a StoredChannelReminder — defaults to TABLE_A / Kono ownership. */
function rec(
    gatheringId: string,
    channel: ReminderChannel,
    notifId: string,
    gather_on: string,
    over: Partial<StoredChannelReminder> = {},
): StoredChannelReminder {
    return {
        notifId,
        gathering_id: gatheringId,
        channel,
        gather_on,
        restaurant_id: over.restaurant_id ?? 'r1',
        restaurant_name: over.restaurant_name ?? 'Kono',
        table_id: over.table_id ?? TABLE_A,
    };
}

function mapOf(...records: StoredChannelReminder[]): ChannelReminderMap {
    const out: ChannelReminderMap = {};
    for (const r of records) out[reminderKey(r.gathering_id, r.channel)] = r;
    return out;
}

/** OS mirror of a stored record (the normal, in-sync state). */
function osOf(...records: StoredChannelReminder[]): OsScheduledReminder[] {
    return records.map((r) => ({
        notifId: r.notifId,
        gatheringId: r.gathering_id,
        channel: r.channel,
        tableId: r.table_id,
    }));
}

describe('helpers', () => {
    it('reminderBody: day-of and morning-after copy, verbatim', () => {
        expect(reminderBody('day_of', 'Kono', 'the usuals')).toBe('tonight — Kono with the usuals');
        expect(reminderBody('morning_after', 'Kono', 'the usuals')).toBe(
            'last night — Kono · add your take',
        );
    });

    it('fireMomentMs: day_of fires 10:00 on gather_on; morning_after 10:00 the day after', () => {
        expect(fireMomentMs('day_of', '2026-07-10')).toBe(
            new Date(2026, 6, 10, 10, 0, 0, 0).getTime(),
        );
        expect(fireMomentMs('morning_after', '2026-07-10')).toBe(
            new Date(2026, 6, 11, 10, 0, 0, 0).getTime(),
        );
        expect(Number.isNaN(fireMomentMs('day_of', 'garbage'))).toBe(true);
    });

    it('addDaysYmd crosses month boundaries', () => {
        expect(addDaysYmd('2026-07-31', 1)).toBe('2026-08-01');
        expect(addDaysYmd('2026-07-01', -1)).toBe('2026-06-30');
    });

    it('localTodayYmd formats a Date as zero-padded YYYY-MM-DD', () => {
        expect(localTodayYmd(new Date(2026, 0, 5))).toBe('2026-01-05');
        expect(localTodayYmd(new Date(2026, 11, 31))).toBe('2026-12-31');
    });
});

describe('isChannelEligible — keep/cancel is pure STATE', () => {
    it('an in + proposed future row is eligible on both channels', () => {
        const r = row({ id: 'g1', gather_on: '2026-07-10' });
        expect(isChannelEligible(r, 'day_of', NOW)).toBe(true);
        expect(isChannelEligible(r, 'morning_after', NOW)).toBe(true);
    });

    it('cancelled gathers hold no ping on either channel', () => {
        const r = row({ id: 'g1', status: 'cancelled' });
        expect(isChannelEligible(r, 'day_of', NOW)).toBe(false);
        expect(isChannelEligible(r, 'morning_after', NOW)).toBe(false);
    });

    it("viewer_response !== 'in' holds no ping (out / counter / null)", () => {
        for (const resp of ['out', 'counter', null] as const) {
            const r = row({ id: 'g1', viewer_response: resp });
            expect(isChannelEligible(r, 'day_of', NOW)).toBe(false);
            expect(isChannelEligible(r, 'morning_after', NOW)).toBe(false);
        }
    });

    it('EXPIRED keeps the morning-after ping (it lands on the rescue CTA) but never day-of', () => {
        // Expired means the day passed: gather_on was yesterday; the
        // morning-after moment (today 10:00) is still ahead of NOW (08:00).
        const r = row({ id: 'g1', status: 'expired', gather_on: addDaysYmd(TODAY, -1) });
        expect(isChannelEligible(r, 'morning_after', NOW)).toBe(true);
        expect(isChannelEligible(r, 'day_of', NOW)).toBe(false);
    });

    it('dispatched keeps both channels while their moments are ahead', () => {
        const r = row({ id: 'g1', status: 'dispatched', gather_on: TODAY });
        expect(isChannelEligible(r, 'day_of', NOW)).toBe(true);
        expect(isChannelEligible(r, 'morning_after', NOW)).toBe(true);
    });

    it('past-fire guard: a moment that already passed is never eligible (never nag twice)', () => {
        const afterMorning = new Date(2026, 6, 7, 11, 0, 0, 0).getTime(); // 11:00 today
        const r = row({ id: 'g1', status: 'expired', gather_on: addDaysYmd(TODAY, -1) });
        // morning-after was today 10:00 — now 11:00 → not eligible, no re-nudge.
        expect(isChannelEligible(r, 'morning_after', afterMorning)).toBe(false);
    });
});

describe('planChannelReminders — schedule decisions', () => {
    it('schedules BOTH channels for a brand-new in gathering', () => {
        const plan = planChannelReminders([row({ id: 'g1' })], {}, [], NOW, TABLE_A);
        expect(plan.toSchedule).toHaveLength(2);
        expect(plan.toSchedule.map((s) => s.channel).sort()).toEqual(['day_of', 'morning_after']);
        expect(plan.toCancel).toEqual([]);
        expect(plan.toDrop).toEqual([]);
    });

    it('leaves in-sync records unchanged (same date, same copy, OS still holds them)', () => {
        const d = rec('g1', 'day_of', 'n-d', '2026-07-10');
        const m = rec('g1', 'morning_after', 'n-m', '2026-07-10');
        const plan = planChannelReminders(
            [row({ id: 'g1', gather_on: '2026-07-10' })],
            mapOf(d, m),
            osOf(d, m),
            NOW,
            TABLE_A,
        );
        expect(isNoopPlan(plan)).toBe(true);
        expect(plan.unchanged.sort()).toEqual(['g1:day_of', 'g1:morning_after']);
    });

    it('date moved → cancels BOTH stale notifs and schedules both on the new day', () => {
        const d = rec('g1', 'day_of', 'n-d', '2026-07-10');
        const m = rec('g1', 'morning_after', 'n-m', '2026-07-10');
        const plan = planChannelReminders(
            [row({ id: 'g1', gather_on: '2026-07-15' })],
            mapOf(d, m),
            osOf(d, m),
            NOW,
            TABLE_A,
        );
        expect(plan.toCancel.sort()).toEqual(['n-d', 'n-m']);
        expect(plan.toSchedule.map((s) => s.gather_on)).toEqual(['2026-07-15', '2026-07-15']);
        expect(plan.toDrop).toEqual([]); // rescheduled, not dropped
    });

    it('restaurant RENAME (same id) → reschedule with fresh copy', () => {
        const m = rec('g1', 'morning_after', 'n-m', '2026-07-10', { restaurant_name: 'Kono' });
        const plan = planChannelReminders(
            [row({ id: 'g1', gather_on: '2026-07-10', restaurant: { id: 'r1', name: 'Kono Omakase' } })],
            mapOf(m),
            osOf(m),
            NOW,
            TABLE_A,
        );
        expect(plan.toCancel).toEqual(['n-m']);
        expect(plan.toSchedule).toHaveLength(2); // fresh morning_after + the missing day_of
        const rescheduled = plan.toSchedule.find((s) => s.channel === 'morning_after');
        expect(rescheduled?.restaurant_name).toBe('Kono Omakase');
    });

    it('restaurant ID change → reschedule even when the name matches', () => {
        const m = rec('g1', 'morning_after', 'n-m', '2026-07-10', { restaurant_id: 'r1' });
        const d = rec('g1', 'day_of', 'n-d', '2026-07-10', { restaurant_id: 'r1' });
        const plan = planChannelReminders(
            [row({ id: 'g1', gather_on: '2026-07-10', restaurant: { id: 'r2', name: 'Kono' } })],
            mapOf(m, d),
            osOf(m, d),
            NOW,
            TABLE_A,
        );
        expect(plan.toCancel.sort()).toEqual(['n-d', 'n-m']);
        expect(plan.toSchedule.every((s) => s.restaurant_id === 'r2')).toBe(true);
    });
});

describe('planChannelReminders — cancel decisions (state, never absence-of-strip)', () => {
    it('cancelled row → cancels + drops both channels', () => {
        const d = rec('g1', 'day_of', 'n-d', '2026-07-10');
        const m = rec('g1', 'morning_after', 'n-m', '2026-07-10');
        const plan = planChannelReminders(
            [row({ id: 'g1', gather_on: '2026-07-10', status: 'cancelled' })],
            mapOf(d, m),
            osOf(d, m),
            NOW,
            TABLE_A,
        );
        expect(plan.toCancel.sort()).toEqual(['n-d', 'n-m']);
        expect(plan.toDrop.sort()).toEqual(['g1:day_of', 'g1:morning_after']);
        expect(plan.toSchedule).toEqual([]);
    });

    it('viewer flipped out of in → cancels + drops both channels', () => {
        const d = rec('g1', 'day_of', 'n-d', '2026-07-10');
        const m = rec('g1', 'morning_after', 'n-m', '2026-07-10');
        const plan = planChannelReminders(
            [row({ id: 'g1', gather_on: '2026-07-10', viewer_response: 'out' })],
            mapOf(d, m),
            osOf(d, m),
            NOW,
            TABLE_A,
        );
        expect(plan.toCancel.sort()).toEqual(['n-d', 'n-m']);
        expect(plan.toDrop.sort()).toEqual(['g1:day_of', 'g1:morning_after']);
    });

    it('EXPIRED row: day-of cancels, morning-after is KEPT untouched', () => {
        const yesterday = addDaysYmd(TODAY, -1);
        const d = rec('g1', 'day_of', 'n-d', yesterday);
        const m = rec('g1', 'morning_after', 'n-m', yesterday);
        const plan = planChannelReminders(
            [row({ id: 'g1', gather_on: yesterday, status: 'expired' })],
            mapOf(d, m),
            osOf(d, m),
            NOW,
            TABLE_A,
        );
        // day_of moment (yesterday 10:00) already passed → post-fire drop, no cancel.
        expect(plan.toDrop).toEqual(['g1:day_of']);
        expect(plan.toCancel).toEqual([]);
        expect(plan.unchanged).toEqual(['g1:morning_after']);
    });

    it('row hard-deleted from the window → cancels + drops (absence INSIDE the window = deleted)', () => {
        const m = rec('g1', 'morning_after', 'n-m', '2026-07-10');
        const plan = planChannelReminders([], mapOf(m), osOf(m), NOW, TABLE_A);
        expect(plan.toCancel).toEqual(['n-m']);
        expect(plan.toDrop).toEqual(['g1:morning_after']);
    });

    it('post-fire cleanup: a record whose moment passed is dropped WITHOUT cancel (never re-nudge)', () => {
        const twoDaysAgo = addDaysYmd(TODAY, -2);
        const m = rec('g1', 'morning_after', 'n-m', twoDaysAgo); // fired yesterday 10:00
        const plan = planChannelReminders([], mapOf(m), [], NOW, TABLE_A);
        expect(plan.toCancel).toEqual([]);
        expect(plan.toDrop).toEqual(['g1:morning_after']);
    });
});

describe('planChannelReminders — OS truth reconcile', () => {
    it('record present but OS lost the notification → re-schedules while the moment is ahead', () => {
        const m = rec('g1', 'morning_after', 'n-m', '2026-07-10');
        const plan = planChannelReminders(
            [row({ id: 'g1', gather_on: '2026-07-10' })],
            mapOf(m, rec('g1', 'day_of', 'n-d', '2026-07-10')),
            osOf(rec('g1', 'day_of', 'n-d', '2026-07-10')), // OS holds day_of only
            NOW,
            TABLE_A,
        );
        expect(plan.toSchedule.map((s) => s.channel)).toEqual(['morning_after']);
        expect(plan.unchanged).toEqual(['g1:day_of']);
    });

    it('map lost but OS still holds the notif → supersedes it (cancel + fresh), never a double ping', () => {
        const osOnly: OsScheduledReminder[] = [
            { notifId: 'n-ghost', gatheringId: 'g1', channel: 'morning_after', tableId: TABLE_A },
        ];
        const plan = planChannelReminders(
            [row({ id: 'g1', gather_on: '2026-07-10' })],
            {},
            osOnly,
            NOW,
            TABLE_A,
        );
        expect(plan.toCancel).toEqual(['n-ghost']);
        // fresh schedules for both channels (ghost superseded, day_of brand-new)
        expect(plan.toSchedule).toHaveLength(2);
    });

    it('OS orphan for an undesired key (lost map + dead plan) → cancelled', () => {
        const osOnly: OsScheduledReminder[] = [
            { notifId: 'n-ghost', gatheringId: 'g1', channel: 'morning_after', tableId: TABLE_A },
        ];
        const plan = planChannelReminders(
            [row({ id: 'g1', gather_on: '2026-07-10', status: 'cancelled' })],
            {},
            osOnly,
            NOW,
            TABLE_A,
        );
        expect(plan.toCancel).toEqual(['n-ghost']);
        expect(plan.toSchedule).toEqual([]);
    });

    it("another table's OS orphan is untouched", () => {
        const osOnly: OsScheduledReminder[] = [
            { notifId: 'n-b', gatheringId: 'b1', channel: 'day_of', tableId: TABLE_B },
        ];
        const plan = planChannelReminders([], {}, osOnly, NOW, TABLE_A);
        expect(isNoopPlan(plan)).toBe(true);
    });
});

describe('planChannelReminders — cross-table isolation', () => {
    it("MANDATORY: reconciling table A leaves table B's records completely untouched", () => {
        const a = rec('a1', 'morning_after', 'n-a', '2026-07-10', { table_id: TABLE_A });
        const b1 = rec('b1', 'day_of', 'n-b1', '2026-07-11', { table_id: TABLE_B });
        const b2 = rec('b2', 'morning_after', 'n-b2', '2026-07-12', { table_id: TABLE_B });
        const plan = planChannelReminders([], mapOf(a, b1, b2), osOf(a, b1, b2), NOW, TABLE_A);
        expect(plan.toCancel).toEqual(['n-a']);
        expect(plan.toDrop).toEqual(['a1:morning_after']);
        expect(plan.toCancel).not.toContain('n-b1');
        expect(plan.toCancel).not.toContain('n-b2');
    });

    it('migrates a legacy ("" table_id) record defensively — cancel + drop on the touching pass', () => {
        const legacy = rec('legacy', 'day_of', 'n-legacy', '2026-07-10', { table_id: '' });
        const plan = planChannelReminders([], mapOf(legacy), [], NOW, TABLE_A);
        expect(plan.toCancel).toEqual(['n-legacy']);
        expect(plan.toDrop).toEqual(['legacy:day_of']);
    });
});

describe('readReminderMap (AsyncStorage-backed)', () => {
    beforeEach(async () => {
        await AsyncStorage.clear();
    });

    it('returns {} when nothing is stored', async () => {
        expect(await readReminderMap()).toEqual({});
    });

    it('round-trips a well-formed per-channel map', async () => {
        const map = mapOf(rec('g1', 'morning_after', 'n1', '2026-07-10'));
        await AsyncStorage.setItem(GATHER_REMINDERS_KEY, JSON.stringify(map));
        expect(await readReminderMap()).toEqual(map);
    });

    it('drops malformed entries defensively', async () => {
        const good = rec('g1', 'day_of', 'n1', '2026-07-10');
        await AsyncStorage.setItem(
            GATHER_REMINDERS_KEY,
            JSON.stringify({
                [reminderKey('g1', 'day_of')]: good,
                bad1: { notifId: 42, gathering_id: 'x', channel: 'day_of', gather_on: 'd', table_id: 't' },
                bad2: { notifId: 'n2' },
                bad3: null,
                badChannel: { notifId: 'n3', gathering_id: 'x', channel: 'weekly', gather_on: 'd', table_id: 't' },
            }),
        );
        expect(await readReminderMap()).toEqual({ [reminderKey('g1', 'day_of')]: good });
    });

    it('returns {} on non-JSON garbage', async () => {
        await AsyncStorage.setItem(GATHER_REMINDERS_KEY, 'not json');
        expect(await readReminderMap()).toEqual({});
    });
});

describe('reconcileGatherReminders — impure pass', () => {
    beforeEach(async () => {
        await AsyncStorage.clear();
        mockCancel.mockClear();
        mockSchedule.mockClear();
    });

    it('permission not granted: cancels EVERY tracked notif before clearing the map', async () => {
        mockPerm.mockResolvedValue('denied');
        const map = mapOf(
            rec('a1', 'day_of', 'n-a1', '2026-07-10', { table_id: TABLE_A }),
            rec('b1', 'morning_after', 'n-b1', '2026-07-11', { table_id: TABLE_B }),
        );
        await AsyncStorage.setItem(GATHER_REMINDERS_KEY, JSON.stringify(map));

        await reconcileGatherReminders([], 'the usuals', TABLE_A);

        // Both notifs cancelled (cancel works regardless of authorization)…
        expect(mockCancel).toHaveBeenCalledWith('n-a1');
        expect(mockCancel).toHaveBeenCalledWith('n-b1');
        // …and the whole map is cleared (permission is device-global).
        expect(await readReminderMap()).toEqual({});
    });

    it('drains the legacy v1 map once: cancels its notifs and removes the key', async () => {
        mockPerm.mockResolvedValue('granted');
        await AsyncStorage.setItem(
            GATHER_REMINDERS_LEGACY_KEY,
            JSON.stringify({ g1: { notifId: 'n-v1', gather_on: '2026-07-10', table_id: TABLE_A } }),
        );
        await reconcileGatherReminders([], 'the usuals', TABLE_A);
        expect(mockCancel).toHaveBeenCalledWith('n-v1');
        expect(await AsyncStorage.getItem(GATHER_REMINDERS_LEGACY_KEY)).toBeNull();
    });

    it('schedules with the stable data identity + /gathering deep link', async () => {
        mockPerm.mockResolvedValue('granted');
        jest.requireMock('expo-notifications').getAllScheduledNotificationsAsync.mockResolvedValue([]);
        // Far-future gather so both fire moments are ahead regardless of wall clock.
        await reconcileGatherReminders(
            [row({ id: 'g1', gather_on: addDaysYmd(localTodayYmd(), 7) })],
            'the usuals',
            TABLE_A,
        );
        expect(mockSchedule).toHaveBeenCalledTimes(2);
        const payloads = mockSchedule.mock.calls.map(([arg]) => arg.content);
        for (const content of payloads) {
            expect(content.data.gatheringId).toBe('g1');
            expect(content.data.tableId).toBe(TABLE_A);
            expect(content.data.url).toBe('/gathering/g1');
            expect(['day_of', 'morning_after']).toContain(content.data.channel);
        }
        const bodies = payloads.map((c) => c.body).sort();
        expect(bodies).toEqual([
            'last night — Kono · add your take',
            'tonight — Kono with the usuals',
        ]);
        // Records persisted per channel.
        const stored = await readReminderMap();
        expect(Object.keys(stored).sort()).toEqual(['g1:day_of', 'g1:morning_after']);
    });

    it('SERIALIZES overlapping passes (finding 12): the second pass reads the first pass’s writes', async () => {
        mockPerm.mockResolvedValue('granted');
        jest.requireMock('expo-notifications').getAllScheduledNotificationsAsync.mockResolvedValue([]);
        const futureDay = addDaysYmd(localTodayYmd(), 7);

        // Fire two passes back-to-back WITHOUT awaiting the first: pass 2 (empty
        // rows) must observe pass 1's records and cancel them — which can only
        // happen if the queue ran them strictly in order.
        const p1 = reconcileGatherReminders([row({ id: 'g1', gather_on: futureDay })], 't', TABLE_A);
        const p2 = reconcileGatherReminders([], 't', TABLE_A);
        await Promise.all([p1, p2]);

        expect(mockSchedule).toHaveBeenCalledTimes(2); // pass 1 scheduled both channels
        expect(mockCancel).toHaveBeenCalledTimes(2);   // pass 2 cancelled both
        expect(await readReminderMap()).toEqual({});
    });
});
