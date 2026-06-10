/**
 * restaurantSignal unit tests — TICKET-065.
 *
 * Covers pickDefaultTier and populatedTiers pure helpers.
 * testEnvironment: node — no React/RN deps.
 */

import { pickDefaultTier, populatedTiers, type SignalTier, type PopulatedFlags } from './restaurantSignal';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const NONE: PopulatedFlags = { you: false, table: false, napkin: false, google: false };
const YOU_ONLY: PopulatedFlags = { you: true, table: false, napkin: false, google: false };
const TABLE_ONLY: PopulatedFlags = { you: false, table: true, napkin: false, google: false };
const NAPKIN_ONLY: PopulatedFlags = { you: false, table: false, napkin: true, google: false };
const GOOGLE_ONLY: PopulatedFlags = { you: false, table: false, napkin: false, google: true };
const ALL: PopulatedFlags = { you: true, table: true, napkin: true, google: true };
const YOU_AND_NAPKIN: PopulatedFlags = { you: true, table: false, napkin: true, google: false };
const TABLE_AND_GOOGLE: PopulatedFlags = { you: false, table: true, napkin: false, google: true };

// ── pickDefaultTier ──────────────────────────────────────────────────────────

describe('pickDefaultTier', () => {
    test('you wins when all three interactive tiers are populated (personal-first)', () => {
        expect(pickDefaultTier(ALL)).toBe<SignalTier>('you');
    });

    test('you wins when napkin + you are populated (you > napkin, personal-first)', () => {
        expect(pickDefaultTier(YOU_AND_NAPKIN)).toBe<SignalTier>('you');
    });

    test('napkin wins when only napkin is populated', () => {
        expect(pickDefaultTier(NAPKIN_ONLY)).toBe<SignalTier>('napkin');
    });

    test('you wins when only you is populated', () => {
        expect(pickDefaultTier(YOU_ONLY)).toBe<SignalTier>('you');
    });

    test('your_table wins when only table is populated', () => {
        expect(pickDefaultTier(TABLE_ONLY)).toBe<SignalTier>('your_table');
    });

    test('napkin fallback when nothing is populated (callers must collapse)', () => {
        expect(pickDefaultTier(NONE)).toBe<SignalTier>('napkin');
    });

    test('napkin fallback when only google is populated (google is inert)', () => {
        expect(pickDefaultTier(GOOGLE_ONLY)).toBe<SignalTier>('napkin');
    });

    test('you wins over your_table when you + table populated (napkin absent)', () => {
        expect(pickDefaultTier({ you: true, table: true, napkin: false, google: false })).toBe<SignalTier>('you');
    });

    test('your_table wins when only table + google populated', () => {
        expect(pickDefaultTier(TABLE_AND_GOOGLE)).toBe<SignalTier>('your_table');
    });
});

// ── populatedTiers ───────────────────────────────────────────────────────────

describe('populatedTiers', () => {
    test('returns empty array when nothing is populated', () => {
        expect(populatedTiers(NONE)).toEqual([]);
    });

    test('returns ["google"] when only google is populated (collapse case)', () => {
        expect(populatedTiers(GOOGLE_ONLY)).toEqual(['google']);
    });

    test('returns ["you"] when only you is populated (collapse case)', () => {
        expect(populatedTiers(YOU_ONLY)).toEqual(['you']);
    });

    test('returns ["your_table"] when only table is populated (collapse case)', () => {
        expect(populatedTiers(TABLE_ONLY)).toEqual(['your_table']);
    });

    test('returns 4 entries when all populated (full strip)', () => {
        const result = populatedTiers(ALL);
        expect(result).toHaveLength(4);
        expect(result).toContain('you');
        expect(result).toContain('your_table');
        expect(result).toContain('napkin');
        expect(result).toContain('google');
    });

    test('order is always you → your_table → napkin → google', () => {
        expect(populatedTiers(ALL)).toEqual(['you', 'your_table', 'napkin', 'google']);
    });

    test('length < 2 means strip should collapse (ghost with only Google)', () => {
        expect(populatedTiers(GOOGLE_ONLY).length).toBeLessThan(2);
    });

    test('length >= 2 means full strip (you + google)', () => {
        expect(populatedTiers({ ...GOOGLE_ONLY, you: true }).length).toBeGreaterThanOrEqual(2);
    });

    test('table + google returns 2 entries', () => {
        expect(populatedTiers(TABLE_AND_GOOGLE)).toEqual(['your_table', 'google']);
    });

    test('you + napkin returns 2 entries (no collapse)', () => {
        expect(populatedTiers(YOU_AND_NAPKIN)).toEqual(['you', 'napkin']);
    });
});
