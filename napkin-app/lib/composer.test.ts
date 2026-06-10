/**
 * Tests for lib/composer.ts
 *
 * Covers the frozen payload contract for buildEntryPayload,
 * buildRoundPayload, toggleTableId, and ratingDescriptor.
 *
 * testEnvironment: node — no React/RN deps allowed here.
 */

import {
    buildEntryPayload,
    buildRoundPayload,
    toggleTableId,
    ratingDescriptor,
    type SoloEntryState,
    type RoundEntryState,
} from './composer';

// ── Fixtures ──────────────────────────────────────────────────────────────

const BASE_DATE = new Date('2026-06-10T12:00:00.000Z');

const EMPTY_BREAKDOWN = { vibe: 0, flavor: 0, service: 0, value: 0 };

function makeState(overrides: Partial<SoloEntryState> = {}): SoloEntryState {
    return {
        rating: 4,
        notes: '',
        dish: '',
        selectedTableIds: [],
        visitedAt: BASE_DATE,
        photos: [],
        breakdown: EMPTY_BREAKDOWN,
        selectedCompanions: undefined,
        ...overrides,
    };
}

function makeRoundState(overrides: Partial<RoundEntryState> = {}): RoundEntryState {
    return {
        rating: 4,
        notes: '',
        dish: '',
        photos: [],
        breakdown: EMPTY_BREAKDOWN,
        selectedParticipantIds: [],
        ...overrides,
    };
}

// ── buildEntryPayload ─────────────────────────────────────────────────────

describe('buildEntryPayload', () => {
    it('0 tables → visibility:private, table_ids:[]', () => {
        const payload = buildEntryPayload(makeState({ selectedTableIds: [] }));
        expect(payload.visibility).toBe('private');
        expect(payload.table_ids).toEqual([]);
    });

    it('1 table → visibility:table, table_ids:[id]', () => {
        const payload = buildEntryPayload(makeState({ selectedTableIds: ['table-1'] }));
        expect(payload.visibility).toBe('table');
        expect(payload.table_ids).toEqual(['table-1']);
    });

    it('2+ tables → all ids preserved', () => {
        const ids = ['table-a', 'table-b', 'table-c'];
        const payload = buildEntryPayload(makeState({ selectedTableIds: ids }));
        expect(payload.visibility).toBe('table');
        expect(payload.table_ids).toEqual(ids);
    });

    it('rating rounds to half-steps', () => {
        expect(buildEntryPayload(makeState({ rating: 4.3 })).rating).toBe(4.5);
        expect(buildEntryPayload(makeState({ rating: 3.1 })).rating).toBe(3);
        expect(buildEntryPayload(makeState({ rating: 2.8 })).rating).toBe(3);
        expect(buildEntryPayload(makeState({ rating: 4.75 })).rating).toBe(5);
    });

    it('photo_urls omitted when no uploaded photos', () => {
        const payload = buildEntryPayload(makeState({
            photos: [{ publicUrl: null }, { publicUrl: null }],
        }));
        expect(payload.photo_urls).toBeUndefined();
    });

    it('photo_urls included when ≥1 uploaded', () => {
        const payload = buildEntryPayload(makeState({
            photos: [
                { publicUrl: 'https://cdn.example.com/photo1.jpg' },
                { publicUrl: null }, // still uploading
                { publicUrl: 'https://cdn.example.com/photo2.jpg' },
            ],
        }));
        expect(payload.photo_urls).toEqual([
            'https://cdn.example.com/photo1.jpg',
            'https://cdn.example.com/photo2.jpg',
        ]);
    });

    it('secondaryRatings are null when zero', () => {
        const payload = buildEntryPayload(makeState({ breakdown: EMPTY_BREAKDOWN }));
        expect(payload.vibe_rating).toBeNull();
        expect(payload.flavor_rating).toBeNull();
        expect(payload.service_rating).toBeNull();
        expect(payload.value_rating).toBeNull();
    });

    it('secondaryRatings carry values when non-zero', () => {
        const payload = buildEntryPayload(makeState({
            breakdown: { vibe: 4, flavor: 5, service: 3, value: 0 },
        }));
        expect(payload.vibe_rating).toBe(4);
        expect(payload.flavor_rating).toBe(5);
        expect(payload.service_rating).toBe(3);
        expect(payload.value_rating).toBeNull();
    });

    it('companion_ids omitted when no companions', () => {
        const payload = buildEntryPayload(makeState({ selectedCompanions: undefined }));
        expect(payload.companion_ids).toBeUndefined();

        const payload2 = buildEntryPayload(makeState({ selectedCompanions: [] }));
        expect(payload2.companion_ids).toBeUndefined();
    });

    it('companion_ids included when companions present', () => {
        const payload = buildEntryPayload(makeState({
            selectedCompanions: [
                { user_id: 'user-a' },
                { user_id: 'user-b' },
            ],
        }));
        expect(payload.companion_ids).toEqual(['user-a', 'user-b']);
    });

    it('content omitted when notes empty', () => {
        const payload = buildEntryPayload(makeState({ notes: '   ' }));
        expect(payload.content).toBeUndefined();
    });

    it('content included (trimmed) when notes non-empty', () => {
        const payload = buildEntryPayload(makeState({ notes: '  Great meal  ' }));
        expect(payload.content).toBe('Great meal');
    });

    it('visited_at is ISO string of visitedAt', () => {
        const payload = buildEntryPayload(makeState({ visitedAt: BASE_DATE }));
        expect(payload.visited_at).toBe(BASE_DATE.toISOString());
    });
});

// ── buildRoundPayload (round-mode shape) ──────────────────────────────────

describe('buildRoundPayload', () => {
    it('uses notes (not content) and participant_ids', () => {
        const payload = buildRoundPayload(makeRoundState({
            notes: 'Fantastic night',
            selectedParticipantIds: ['user-x', 'user-y'],
        }));
        expect(payload.notes).toBe('Fantastic night');
        expect((payload as any).content).toBeUndefined();
        expect(payload.participant_ids).toEqual(['user-x', 'user-y']);
    });

    it('notes omitted when empty', () => {
        const payload = buildRoundPayload(makeRoundState({ notes: '' }));
        expect(payload.notes).toBeUndefined();
    });

    it('dish_description forwarded', () => {
        const payload = buildRoundPayload(makeRoundState({ dish: 'spicy rigatoni' }));
        expect(payload.dish_description).toBe('spicy rigatoni');
    });

    it('photo_urls only when uploaded', () => {
        const payload = buildRoundPayload(makeRoundState({
            photos: [{ publicUrl: 'https://cdn.example.com/img.jpg' }, { publicUrl: null }],
        }));
        expect(payload.photo_urls).toEqual(['https://cdn.example.com/img.jpg']);
    });

    it('secondaryRatings null when zero', () => {
        const payload = buildRoundPayload(makeRoundState());
        expect(payload.vibe_rating).toBeNull();
        expect(payload.flavor_rating).toBeNull();
    });
});

// ── toggleTableId ─────────────────────────────────────────────────────────

describe('toggleTableId', () => {
    it('adds id when absent', () => {
        expect(toggleTableId([], 'a')).toEqual(['a']);
        expect(toggleTableId(['b'], 'a')).toEqual(['b', 'a']);
    });

    it('removes id when present', () => {
        expect(toggleTableId(['a'], 'a')).toEqual([]);
        expect(toggleTableId(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
    });

    it('preserves order on add', () => {
        expect(toggleTableId(['a', 'c'], 'b')).toEqual(['a', 'c', 'b']);
    });

    it('no duplicate — add already-present id is a no-op toggle (removes)', () => {
        const result = toggleTableId(['a', 'a'], 'a');
        // Both are removed since filter removes all matching
        expect(result).toEqual([]);
    });
});

// ── ratingDescriptor ──────────────────────────────────────────────────────

describe('ratingDescriptor', () => {
    it('returns empty string for 0', () => {
        expect(ratingDescriptor(0)).toBe('');
    });

    it('returns empty string for negative', () => {
        expect(ratingDescriptor(-1)).toBe('');
    });

    it('maps canonical values', () => {
        expect(ratingDescriptor(5)).toBe('Outstanding');
        expect(ratingDescriptor(4.5)).toBe('Really good');
        expect(ratingDescriptor(4)).toBe('Good');
        expect(ratingDescriptor(3.5)).toBe('Pretty good');
        expect(ratingDescriptor(3)).toBe('Fair');
        expect(ratingDescriptor(2.5)).toBe('Decent');
        expect(ratingDescriptor(2)).toBe('Below average');
        expect(ratingDescriptor(1.5)).toBe('Not great');
        expect(ratingDescriptor(0.5)).toBe('Disliked');
    });

    it('maps non-canonical in-between value (e.g. 4.3) to lower bound', () => {
        // 4.3 >= 4.0 but < 4.5 → 'Good'
        expect(ratingDescriptor(4.3)).toBe('Good');
    });
});
