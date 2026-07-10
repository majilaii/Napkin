/**
 * gatherReminders diff tests (TICKET-128 Part B).
 *
 * Exercises the PURE reconcile decision (planReminders) + the small pure helpers.
 * The pure diff is native-free by design (mirrors localNotify.test.ts) so the full
 * schedule/cancel/reschedule matrix is testable without a build. AsyncStorage-backed
 * map round-trip is covered against jest-expo's storage mock.
 *
 * The one impure path we DO cover is reconcileGatherReminders' permission-not-granted
 * branch: expo-notifications + getPermissionState are mocked so we can assert it
 * cancels every tracked notif before clearing the map (no double-schedule on re-grant).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getPermissionState } from '@/lib/localNotify';
import {
    planReminders,
    isNoopPlan,
    reminderBody,
    localTodayYmd,
    readReminderMap,
    reconcileGatherReminders,
    GATHER_REMINDERS_KEY,
    type ReminderMap,
    type StoredReminder,
} from './gatherReminders';
import type { UpcomingGathering } from '@/hooks/gatherings/useUpcomingGatherings';

jest.mock('@/lib/localNotify', () => ({
    getPermissionState: jest.fn(),
}));
jest.mock(
    'expo-notifications',
    () => ({
        scheduleNotificationAsync: jest.fn(async () => 'notif-generated'),
        cancelScheduledNotificationAsync: jest.fn(async () => undefined),
        SchedulableTriggerInputTypes: { DATE: 'date', CALENDAR: 'calendar' },
    }),
    { virtual: true },
);

const mockPerm = getPermissionState as jest.MockedFunction<typeof getPermissionState>;
// requireMock (not a static import) so tsc never tries to resolve expo-notifications
// here — the module is virtual-mocked and only present at runtime under jest.
const mockCancel = jest.requireMock('expo-notifications').cancelScheduledNotificationAsync as jest.Mock;

const TODAY = '2026-07-07';
const TABLE_A = 'table-a';
const TABLE_B = 'table-b';

function row(over: Partial<UpcomingGathering> & { id: string }): UpcomingGathering {
    return {
        id: over.id,
        gather_on: over.gather_on ?? '2026-07-10',
        status: over.status ?? 'proposed',
        restaurant: over.restaurant ?? { id: 'r1', name: 'Kono' },
        in_count: over.in_count ?? 2,
        supper_id: over.supper_id ?? null,
        viewer_response: 'viewer_response' in over ? (over.viewer_response ?? null) : 'in',
    };
}

/** Build a StoredReminder — defaults to TABLE_A ownership. */
function rem(notifId: string, gather_on: string, table_id: string = TABLE_A): StoredReminder {
    return { notifId, gather_on, table_id };
}

describe('planReminders — schedule decisions', () => {
    it('schedules a brand-new in gathering not yet in the map', () => {
        const plan = planReminders([row({ id: 'g1', gather_on: '2026-07-10' })], {}, TODAY, TABLE_A);
        expect(plan.toSchedule).toEqual([{ id: 'g1', gather_on: '2026-07-10' }]);
        expect(plan.toCancel).toEqual([]);
        expect(plan.toDrop).toEqual([]);
        expect(plan.unchanged).toEqual([]);
    });

    it('schedules for a dispatched gathering the viewer is in on', () => {
        const plan = planReminders(
            [row({ id: 'g1', status: 'dispatched', viewer_response: 'in' })],
            {},
            TODAY,
            TABLE_A,
        );
        expect(plan.toSchedule).toHaveLength(1);
    });

    it('leaves an already-scheduled same-day gathering unchanged', () => {
        const existing: ReminderMap = { g1: rem('n1', '2026-07-10') };
        const plan = planReminders([row({ id: 'g1', gather_on: '2026-07-10' })], existing, TODAY, TABLE_A);
        expect(plan.toSchedule).toEqual([]);
        expect(plan.toCancel).toEqual([]);
        expect(plan.unchanged).toEqual(['g1']);
        expect(isNoopPlan(plan)).toBe(true);
    });

    it('schedules today itself (gather_on === today is still eligible)', () => {
        const plan = planReminders([row({ id: 'g1', gather_on: TODAY })], {}, TODAY, TABLE_A);
        expect(plan.toSchedule).toEqual([{ id: 'g1', gather_on: TODAY }]);
    });
});

describe('planReminders — reschedule (TICKET-127 re-date)', () => {
    it('cancels the old notif and schedules the new day when gather_on moved', () => {
        const existing: ReminderMap = { g1: rem('n-old', '2026-07-10') };
        const plan = planReminders([row({ id: 'g1', gather_on: '2026-07-12' })], existing, TODAY, TABLE_A);
        expect(plan.toCancel).toEqual(['n-old']);
        expect(plan.toSchedule).toEqual([{ id: 'g1', gather_on: '2026-07-12' }]);
        expect(plan.toDrop).toEqual([]); // rescheduled, not dropped
        expect(plan.unchanged).toEqual([]);
    });
});

describe('planReminders — cancel decisions', () => {
    it('cancels + drops a gathering that vanished from the rows (cancelled/gone)', () => {
        const existing: ReminderMap = { g1: rem('n1', '2026-07-10') };
        const plan = planReminders([], existing, TODAY, TABLE_A);
        expect(plan.toCancel).toEqual(['n1']);
        expect(plan.toDrop).toEqual(['g1']);
        expect(plan.toSchedule).toEqual([]);
    });

    it('cancels when the viewer is no longer in (out / counter / null)', () => {
        const existing: ReminderMap = { g1: rem('n1', '2026-07-10') };
        for (const resp of ['out', 'counter', null] as const) {
            const plan = planReminders(
                [row({ id: 'g1', gather_on: '2026-07-10', viewer_response: resp })],
                existing,
                TODAY,
                TABLE_A,
            );
            expect(plan.toCancel).toEqual(['n1']);
            expect(plan.toDrop).toEqual(['g1']);
            expect(plan.toSchedule).toEqual([]);
        }
    });

    it('cancels a past gathering still lingering in the map', () => {
        const existing: ReminderMap = { g1: rem('n1', '2026-07-01') };
        // A past-dated row (shouldn't normally arrive, but be defensive) → not eligible.
        const plan = planReminders(
            [row({ id: 'g1', gather_on: '2026-07-01', viewer_response: 'in' })],
            existing,
            TODAY,
            TABLE_A,
        );
        expect(plan.toCancel).toEqual(['n1']);
        expect(plan.toDrop).toEqual(['g1']);
    });

    it('does not schedule an in-but-past row that was never in the map', () => {
        const plan = planReminders([row({ id: 'g1', gather_on: '2026-07-01' })], {}, TODAY, TABLE_A);
        expect(isNoopPlan(plan)).toBe(true);
    });
});

describe('planReminders — table scoping (P0: cross-table isolation)', () => {
    it('MANDATORY: reconciling table A leaves table B entries completely untouched', () => {
        const existing: ReminderMap = {
            a1: rem('n-a1', '2026-07-10', TABLE_A), // A, gone from A's rows → drop
            b1: rem('n-b1', '2026-07-11', TABLE_B), // B — must survive A's pass
            b2: rem('n-b2', '2026-07-12', TABLE_B), // B — must survive A's pass
        };
        // A's reconcile sees only A's rows, and a1 is no longer among them.
        const plan = planReminders([], existing, TODAY, TABLE_A);
        expect(plan.toCancel).toEqual(['n-a1']);
        expect(plan.toDrop).toEqual(['a1']);
        // B's notifs are never cancelled and its ids are never dropped.
        expect(plan.toCancel).not.toContain('n-b1');
        expect(plan.toCancel).not.toContain('n-b2');
        expect(plan.toDrop).not.toContain('b1');
        expect(plan.toDrop).not.toContain('b2');
    });

    it('does not drop another table B entry even when A has no rows at all', () => {
        const existing: ReminderMap = { b1: rem('n-b1', '2026-07-11', TABLE_B) };
        const plan = planReminders([], existing, TODAY, TABLE_A);
        expect(isNoopPlan(plan)).toBe(true);
        expect(plan.toDrop).toEqual([]);
        expect(plan.toCancel).toEqual([]);
    });

    it('reschedules only THIS table row; a same-id assumption never crosses tables', () => {
        const existing: ReminderMap = {
            a1: rem('n-a1', '2026-07-10', TABLE_A),
            b1: rem('n-b1', '2026-07-11', TABLE_B),
        };
        const plan = planReminders(
            [row({ id: 'a1', gather_on: '2026-07-15' })],
            existing,
            TODAY,
            TABLE_A,
        );
        expect(plan.toCancel).toEqual(['n-a1']);
        expect(plan.toSchedule).toEqual([{ id: 'a1', gather_on: '2026-07-15' }]);
        expect(plan.toDrop).toEqual([]);
    });

    it('migrates a legacy ("" table_id) entry defensively — drop + cancel on the touching pass', () => {
        const existing: ReminderMap = { legacy: rem('n-legacy', '2026-07-10', '') };
        const plan = planReminders([], existing, TODAY, TABLE_A);
        expect(plan.toCancel).toEqual(['n-legacy']);
        expect(plan.toDrop).toEqual(['legacy']);
    });
});

describe('planReminders — mixed batch', () => {
    it('handles new + reschedule + unchanged + drop in one pass', () => {
        const existing: ReminderMap = {
            keep: rem('n-keep', '2026-07-08'),
            move: rem('n-move', '2026-07-09'),
            gone: rem('n-gone', '2026-07-11'),
        };
        const rows = [
            row({ id: 'keep', gather_on: '2026-07-08' }), // unchanged
            row({ id: 'move', gather_on: '2026-07-15' }), // rescheduled
            row({ id: 'fresh', gather_on: '2026-07-20' }), // new
            // 'gone' absent → dropped
        ];
        const plan = planReminders(rows, existing, TODAY, TABLE_A);
        expect(plan.unchanged).toEqual(['keep']);
        expect(plan.toSchedule).toEqual([
            { id: 'move', gather_on: '2026-07-15' },
            { id: 'fresh', gather_on: '2026-07-20' },
        ]);
        expect(plan.toCancel).toEqual(expect.arrayContaining(['n-move', 'n-gone']));
        expect(plan.toCancel).toHaveLength(2);
        expect(plan.toDrop).toEqual(['gone']);
    });
});

describe('helpers', () => {
    it('reminderBody is lowercase with an em-dash', () => {
        expect(reminderBody('Kono', 'the usuals')).toBe('tonight — Kono with the usuals');
    });

    it('localTodayYmd formats a Date as zero-padded YYYY-MM-DD', () => {
        expect(localTodayYmd(new Date(2026, 0, 5))).toBe('2026-01-05');
        expect(localTodayYmd(new Date(2026, 11, 31))).toBe('2026-12-31');
    });

    it('isNoopPlan is false when anything is scheduled/cancelled/dropped', () => {
        expect(isNoopPlan({ toSchedule: [{ id: 'a', gather_on: TODAY }], toCancel: [], toDrop: [], unchanged: [] })).toBe(false);
        expect(isNoopPlan({ toSchedule: [], toCancel: ['n'], toDrop: [], unchanged: [] })).toBe(false);
        expect(isNoopPlan({ toSchedule: [], toCancel: [], toDrop: ['g'], unchanged: [] })).toBe(false);
        expect(isNoopPlan({ toSchedule: [], toCancel: [], toDrop: [], unchanged: ['g'] })).toBe(true);
    });
});

describe('readReminderMap (AsyncStorage-backed)', () => {
    beforeEach(async () => {
        await AsyncStorage.clear();
    });

    it('returns {} when nothing is stored', async () => {
        expect(await readReminderMap()).toEqual({});
    });

    it('round-trips a well-formed map (with table_id)', async () => {
        const map: ReminderMap = { g1: rem('n1', '2026-07-10', TABLE_A) };
        await AsyncStorage.setItem(GATHER_REMINDERS_KEY, JSON.stringify(map));
        expect(await readReminderMap()).toEqual(map);
    });

    it('migrates a legacy entry with no table_id to the "" sentinel', async () => {
        await AsyncStorage.setItem(
            GATHER_REMINDERS_KEY,
            JSON.stringify({ g1: { notifId: 'n1', gather_on: '2026-07-10' } }),
        );
        expect(await readReminderMap()).toEqual({
            g1: { notifId: 'n1', gather_on: '2026-07-10', table_id: '' },
        });
    });

    it('drops malformed entries defensively', async () => {
        await AsyncStorage.setItem(
            GATHER_REMINDERS_KEY,
            JSON.stringify({
                good: { notifId: 'n1', gather_on: '2026-07-10', table_id: TABLE_A },
                bad1: { notifId: 42, gather_on: '2026-07-10' },
                bad2: { notifId: 'n2' },
                bad3: null,
            }),
        );
        expect(await readReminderMap()).toEqual({
            good: { notifId: 'n1', gather_on: '2026-07-10', table_id: TABLE_A },
        });
    });

    it('returns {} on non-JSON garbage', async () => {
        await AsyncStorage.setItem(GATHER_REMINDERS_KEY, 'not json');
        expect(await readReminderMap()).toEqual({});
    });
});

describe('reconcileGatherReminders — permission not granted (P2)', () => {
    beforeEach(async () => {
        await AsyncStorage.clear();
        mockCancel.mockClear();
    });

    it('cancels EVERY tracked notif before clearing the map (no double-schedule on re-grant)', async () => {
        mockPerm.mockResolvedValue('denied');
        const map: ReminderMap = {
            a1: rem('n-a1', '2026-07-10', TABLE_A),
            b1: rem('n-b1', '2026-07-11', TABLE_B),
        };
        await AsyncStorage.setItem(GATHER_REMINDERS_KEY, JSON.stringify(map));

        await reconcileGatherReminders([], 'the usuals', TABLE_A);

        // Both notifs cancelled (cancel works regardless of authorization)…
        expect(mockCancel).toHaveBeenCalledTimes(2);
        expect(mockCancel).toHaveBeenCalledWith('n-a1');
        expect(mockCancel).toHaveBeenCalledWith('n-b1');
        // …and the whole map is cleared (permission is device-global).
        expect(await readReminderMap()).toEqual({});
    });

    it('is a pure no-op when the map is already empty', async () => {
        mockPerm.mockResolvedValue('undetermined');
        await reconcileGatherReminders([], 'the usuals', TABLE_A);
        expect(mockCancel).not.toHaveBeenCalled();
    });
});
