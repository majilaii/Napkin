/**
 * supperTableUtils unit tests — TICKET-082 Supper "at the table" accordion.
 *
 * Tests buildSupperTableModel imported from the REAL module:
 *  - excludes the centerpiece author from rows (they're the hero above)
 *  - keeps the centerpiece author in headCount AND the group average
 *  - pairs each roster member with their take (pending = no take)
 *  - group average = mean of ALL submitted ratings (1-decimal handled by caller)
 *  - null average when nobody has rated
 */
import { buildSupperTableModel } from '../supperTableUtils';
import type { SupperDetail, SupperRosterMember, SupperTake } from '@/hooks/suppers';

const HOST = 'aaaaaaaa-0000-4000-8000-000000000001';
const CLARA = 'aaaaaaaa-0000-4000-8000-000000000002';
const THOMAS = 'aaaaaaaa-0000-4000-8000-000000000003';

function member(user_id: string, display_name: string): SupperRosterMember {
    return { user_id, display_name, avatar_url: null, created_at: '2026-06-16T00:00:00Z' };
}

function take(user_id: string, rating: number | null, overrides: Partial<SupperTake> = {}): SupperTake {
    return {
        entry_id: `entry-${user_id}`,
        user_id,
        restaurant_id: 'rrrrrrrr-0000-4000-8000-000000000001',
        supper_id: 'ssssssss-0000-4000-8000-000000000001',
        rating,
        content: null,
        dish_description: null,
        visited_at: '2026-06-16T00:00:00Z',
        created_at: '2026-06-16T00:00:00Z',
        vibe_rating: null,
        flavor_rating: null,
        service_rating: null,
        value_rating: null,
        liked: null,
        photo_url: null,
        photos: [],
        display_name: null,
        avatar_url: null,
        ...overrides,
    };
}

function detail(over: Partial<SupperDetail> = {}): SupperDetail {
    return {
        supper: {
            id: 'ssssssss-0000-4000-8000-000000000001',
            restaurant_id: 'rrrrrrrr-0000-4000-8000-000000000001',
            host_user_id: HOST,
            created_at: '2026-06-16T00:00:00Z',
        },
        roster: [member(HOST, 'Jacky'), member(CLARA, 'Clara'), member(THOMAS, 'Thomas')],
        takes: [],
        ...over,
    };
}

describe('buildSupperTableModel', () => {
    it('excludes the centerpiece author from rows but keeps them in headCount', () => {
        const model = buildSupperTableModel(detail(), HOST);
        // 3 in roster, host is the centerpiece → 2 rows (Clara, Thomas)
        expect(model.rows.map((r) => r.member.user_id)).toEqual([CLARA, THOMAS]);
        expect(model.headCount).toBe(3);
    });

    it('pairs a roster member with their take; pending members have no take', () => {
        const model = buildSupperTableModel(
            detail({ takes: [take(CLARA, 4)] }),
            HOST,
        );
        const clara = model.rows.find((r) => r.member.user_id === CLARA);
        const thomas = model.rows.find((r) => r.member.user_id === THOMAS);
        expect(clara?.take?.rating).toBe(4);
        expect(thomas?.take).toBeUndefined(); // pending ghost
    });

    it('group average includes the centerpiece author and every submitted take', () => {
        // Host=5, Clara=4, Thomas=3 → (5+4+3)/3 = 4
        const model = buildSupperTableModel(
            detail({ takes: [take(HOST, 5), take(CLARA, 4), take(THOMAS, 3)] }),
            HOST,
        );
        expect(model.groupAverage).toBe(4);
    });

    it('ignores un-rated takes in the average', () => {
        // Host=5, Clara=null (logged words only), Thomas=2 → (5+2)/2 = 3.5
        const model = buildSupperTableModel(
            detail({ takes: [take(HOST, 5), take(CLARA, null), take(THOMAS, 2)] }),
            HOST,
        );
        expect(model.groupAverage).toBe(3.5);
    });

    it('returns null average when nobody has rated', () => {
        const model = buildSupperTableModel(detail({ takes: [] }), HOST);
        expect(model.groupAverage).toBeNull();
    });

    it('a non-host centerpiece author is the one excluded', () => {
        // Viewing Clara's take → Clara is the hero, rows = host + Thomas
        const model = buildSupperTableModel(detail(), CLARA);
        expect(model.rows.map((r) => r.member.user_id)).toEqual([HOST, THOMAS]);
        expect(model.headCount).toBe(3);
    });
});
