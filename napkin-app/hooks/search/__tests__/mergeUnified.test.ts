/**
 * Tests for hooks/search/useRestaurantSearch.ts::mergeUnified (TICKET-167).
 *
 * Pure ranking function — collapses the three tiers into one deterministic
 * flat list: name-match strength → tier boost → within-visited recency →
 * stable (incoming order preserved). No React / IO.
 */
import { mergeUnified } from '../mergeUnified';
import type { SearchResultRow, SearchResults } from '../useRestaurantSearch';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function row(
    tier: SearchResultRow['tier'],
    name: string,
    overrides: Partial<SearchResultRow> = {},
): SearchResultRow {
    return {
        id: tier === 'morePlaces' ? undefined : `id-${name}`,
        placeId: `place-${name}`,
        name,
        city: null,
        cuisine: null,
        address: null,
        photoUrl: null,
        photoReference: null,
        photoAttributionHtml: null,
        tier,
        ...overrides,
    };
}

function results(over: Partial<SearchResults> = {}): SearchResults {
    return { visited: [], onNapkin: [], morePlaces: [], ...over };
}

const names = (rows: SearchResultRow[]) => rows.map((r) => r.name);

// ── Name-match strength (primary key) ────────────────────────────────────────

describe('mergeUnified — name-match strength', () => {
    it('exact > prefix > substring, regardless of tier', () => {
        const merged = mergeUnified(
            results({
                morePlaces: [
                    row('morePlaces', 'Tenmaru'), // exact
                    row('morePlaces', 'Tenmaru Ramen'), // prefix
                    row('morePlaces', 'The Tenmaru Spot'), // substring
                    row('morePlaces', 'Unrelated'), // no match
                ],
            }),
            'tenmaru',
        );
        expect(names(merged)).toEqual([
            'Tenmaru',
            'Tenmaru Ramen',
            'The Tenmaru Spot',
            'Unrelated',
        ]);
    });

    it('is case- and diacritic-insensitive', () => {
        const merged = mergeUnified(
            results({
                morePlaces: [row('morePlaces', 'Café Crème'), row('morePlaces', 'Zzz')],
            }),
            'cafe creme',
        );
        expect(merged[0].name).toBe('Café Crème');
    });
});

// ── Tier boost (secondary key) ───────────────────────────────────────────────

describe('mergeUnified — tier boost', () => {
    it('at equal match strength, visited > onNapkin > ghost', () => {
        const merged = mergeUnified(
            results({
                morePlaces: [row('morePlaces', 'Kono')],
                onNapkin: [row('onNapkin', 'Kono')],
                visited: [row('visited', 'Kono')],
            }),
            'kono',
        );
        expect(names(merged)).toEqual(['Kono', 'Kono', 'Kono']);
        expect(merged.map((r) => r.tier)).toEqual(['visited', 'onNapkin', 'morePlaces']);
    });

    it('a persisted-but-unvisited exact match outranks a ghost exact match', () => {
        const merged = mergeUnified(
            results({
                morePlaces: [row('morePlaces', 'Kono')],
                onNapkin: [row('onNapkin', 'Kono')],
            }),
            'kono',
        );
        expect(merged[0].tier).toBe('onNapkin');
    });

    it('match strength beats tier — a ghost exact match outranks a visited substring', () => {
        const merged = mergeUnified(
            results({
                morePlaces: [row('morePlaces', 'Kono')], // exact
                visited: [row('visited', 'Kono Izakaya')], // prefix
            }),
            'kono',
        );
        expect(merged[0].tier).toBe('morePlaces');
    });
});

// ── Within-visited recency (tertiary key) ────────────────────────────────────

describe('mergeUnified — within visited, most_recent_activity_at desc', () => {
    it('sorts equally-matching visited rows newest first', () => {
        const merged = mergeUnified(
            results({
                visited: [
                    row('visited', 'Kono', { mostRecentActivityAt: '2026-01-01T00:00:00Z' }),
                    row('visited', 'Kono', { mostRecentActivityAt: '2026-07-01T00:00:00Z' }),
                    row('visited', 'Kono', { mostRecentActivityAt: null }),
                ],
            }),
            'kono',
        );
        expect(merged.map((r) => r.mostRecentActivityAt)).toEqual([
            '2026-07-01T00:00:00Z',
            '2026-01-01T00:00:00Z',
            null,
        ]);
    });
});

// ── Stability (final tiebreaker) ─────────────────────────────────────────────

describe('mergeUnified — stable', () => {
    it('preserves incoming Google order among equally-ranked ghosts', () => {
        const merged = mergeUnified(
            results({
                morePlaces: [
                    row('morePlaces', 'Sushi A'),
                    row('morePlaces', 'Sushi B'),
                    row('morePlaces', 'Sushi C'),
                ],
            }),
            'sushi',
        );
        expect(names(merged)).toEqual(['Sushi A', 'Sushi B', 'Sushi C']);
    });

    it('returns [] for empty tiers', () => {
        expect(mergeUnified(results(), 'anything')).toEqual([]);
    });
});

// ── Farther afield (TICKET-174) ──────────────────────────────────────────────

describe('mergeUnified — farther-afield rows trail everything', () => {
    it('a fallback exact match ranks below a local substring match', () => {
        const merged = mergeUnified(
            results({
                visited: [row('visited', 'De Kamer Club')], // substring, local
                morePlaces: [row('morePlaces', 'Kamer', { fartherAfield: true })], // exact, fallback
            }),
            'kamer',
        );
        expect(names(merged)).toEqual(['De Kamer Club', 'Kamer']);
    });

    it('fallback rows keep match-strength order among themselves', () => {
        const merged = mergeUnified(
            results({
                morePlaces: [
                    row('morePlaces', 'Kamer Thirteen', { fartherAfield: true }),
                    row('morePlaces', 'Kamer', { fartherAfield: true }),
                ],
            }),
            'kamer',
        );
        expect(names(merged)).toEqual(['Kamer', 'Kamer Thirteen']);
    });

    it('rows without the flag are unaffected', () => {
        const merged = mergeUnified(
            results({
                morePlaces: [row('morePlaces', 'Kamer'), row('morePlaces', 'Kamer Two')],
            }),
            'kamer',
        );
        expect(names(merged)).toEqual(['Kamer', 'Kamer Two']);
    });
});
