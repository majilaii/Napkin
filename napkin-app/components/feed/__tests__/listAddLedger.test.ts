/**
 * TICKET-115 — table-list-add ledger line copy grammar (pure).
 * Single-add names the restaurant; batched adds collapse to "{n} spots"; verb
 * is lowercase past-tense; actor is "You" for self, name otherwise, "Someone" as
 * the null-profile fallback.
 */
import {
    ledgerActorLabel,
    ledgerTargetFragment,
    ledgerListName,
} from '../listAddLedger';
import type { ListAddActivityItem } from '@/hooks/tables/useTableActivity';

const SELF = 'user-self';
const CLARA = 'user-clara';

function item(over: Partial<ListAddActivityItem>): ListAddActivityItem {
    return {
        type: 'list_add',
        id: 'la-1',
        sort_date: '2026-07-06T10:00:00Z',
        table_id: 't-1',
        list_id: 'l-1',
        list_title: 'Amsterdam',
        list_emoji: null,
        added_by: CLARA,
        added_by_profile: { user_id: CLARA, display_name: 'Clara', avatar_url: null },
        add_count: 1,
        sample_restaurant_names: ['St. John'],
        created_at: '2026-07-06T10:00:00Z',
        ...over,
    };
}

describe('ledgerActorLabel', () => {
    it('is "You" when the adder is the current user', () => {
        expect(ledgerActorLabel(item({ added_by: SELF }), SELF)).toBe('You');
    });
    it('is the display name when the adder is someone else', () => {
        expect(ledgerActorLabel(item({ added_by: CLARA }), SELF)).toBe('Clara');
    });
    it('falls back to "Someone" when the profile is missing (e.g. account deleted)', () => {
        expect(
            ledgerActorLabel(item({ added_by: null, added_by_profile: null }), SELF),
        ).toBe('Someone');
    });
});

describe('ledgerTargetFragment', () => {
    it('names the single restaurant for a 1-spot add', () => {
        expect(ledgerTargetFragment(item({ add_count: 1, sample_restaurant_names: ['St. John'] })))
            .toBe('St. John');
    });
    it('collapses to "{n} spots" for a coalesced batch', () => {
        expect(ledgerTargetFragment(item({ add_count: 3, sample_restaurant_names: ['A', 'B', 'C'] })))
            .toBe('3 spots');
    });
    it('falls back to "a spot" when the sample name is unknown', () => {
        expect(ledgerTargetFragment(item({ add_count: 1, sample_restaurant_names: [] })))
            .toBe('a spot');
    });
    it('uses add_count over sample length when they disagree (name sample truncated)', () => {
        expect(ledgerTargetFragment(item({ add_count: 5, sample_restaurant_names: ['A', 'B'] })))
            .toBe('5 spots');
    });
});

describe('ledgerListName', () => {
    it('returns the list title', () => {
        expect(ledgerListName(item({ list_title: 'Amsterdam' }))).toBe('Amsterdam');
    });
    it('falls back to "a list" when the title is null', () => {
        expect(ledgerListName(item({ list_title: null }))).toBe('a list');
    });
});
