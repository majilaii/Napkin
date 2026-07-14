import type { ListDetail, ListEntry, OwnerProfile } from '@/hooks/lists/useList';
import {
    deriveContextLine,
    deriveCover,
    deriveMetadataLine,
    deriveSavesClause,
} from '../listHeaderUtils';

function entry(photoUrl: string | null): Pick<ListEntry, 'restaurant'> {
    return {
        restaurant: {
            id: 'r',
            name: 'Place',
            address: null,
            city: null,
            country: null,
            photo_url: photoUrl,
            cuisine: null,
            google_rating: null,
            price_level: null,
            external_id: null,
        },
    };
}

function list(overrides: Partial<Pick<ListDetail, 'table_id' | 'privacy'>> = {}) {
    return { table_id: null, privacy: 'public' as const, ...overrides };
}

function owner(overrides: Partial<OwnerProfile> = {}): OwnerProfile {
    return {
        display_name: 'Mara',
        username: 'mara',
        avatar_url: null,
        account_privacy: 'public',
        ...overrides,
    };
}

describe('deriveCover (A4)', () => {
    it('takes the first entry restaurant photo', () => {
        expect(deriveCover([entry('a.jpg'), entry('b.jpg')])).toBe('a.jpg');
    });

    it('is null when the first entry has no photo or the list is empty', () => {
        expect(deriveCover([entry(null), entry('b.jpg')])).toBeNull();
        expect(deriveCover([])).toBeNull();
    });
});

describe('deriveSavesClause (A14)', () => {
    it('appends only for public personal lists with saves', () => {
        expect(deriveSavesClause(125, 'public', null)).toBe('saved 125 times');
        expect(deriveSavesClause(1, 'public', null)).toBe('saved 1 time');
    });

    it('suppresses on zero, private, or Table lists', () => {
        expect(deriveSavesClause(0, 'public', null)).toBeNull();
        expect(deriveSavesClause(9, 'private', null)).toBeNull();
        expect(deriveSavesClause(9, 'public', 'table-1')).toBeNull();
    });
});

describe('deriveMetadataLine', () => {
    it('composes places with the optional saves clause', () => {
        expect(deriveMetadataLine(19, 125, 'public', null)).toBe('19 places · saved 125 times');
        expect(deriveMetadataLine(1, 0, 'public', null)).toBe('1 place');
        expect(deriveMetadataLine(4, 3, 'private', null)).toBe('4 places');
    });
});

describe('deriveContextLine (A13)', () => {
    it('table list → shared-with-Table', () => {
        expect(deriveContextLine(list({ table_id: 't1' }), false, owner())).toEqual({
            kind: 'table',
            text: 'Shared with everyone at this Table',
        });
    });

    it('own private personal → only-you', () => {
        expect(deriveContextLine(list({ privacy: 'private' }), true, owner())).toEqual({
            kind: 'private',
            text: 'Only you can find this list',
        });
    });

    it('own public personal → no context line', () => {
        expect(deriveContextLine(list({ privacy: 'public' }), true, owner())).toBeNull();
    });

    it("other's public → tappable byline when the owner account is public", () => {
        expect(deriveContextLine(list(), false, owner({ display_name: 'Ivy', username: 'ivy' }))).toEqual({
            kind: 'byline',
            text: 'a list by Ivy',
            profileHandle: 'ivy',
        });
    });

    it("other's public → untappable byline when the owner account is private", () => {
        expect(
            deriveContextLine(list(), false, owner({ display_name: 'Ivy', account_privacy: 'private' })),
        ).toEqual({ kind: 'byline', text: 'a list by Ivy', profileHandle: null });
    });
});
