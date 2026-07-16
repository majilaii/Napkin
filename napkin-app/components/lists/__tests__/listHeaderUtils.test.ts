import type { ListDetail, ListEntry, OwnerProfile } from '@/hooks/lists/useList';
import {
    deriveContextLine,
    deriveCover,
    deriveListPlacesCredits,
    deriveMetadataLine,
    deriveSavesClause,
    listCoverPhotoFailureKey,
    listRowPhotoFailureKey,
} from '../listHeaderUtils';
import { dedupePlacesCredits } from '@/components/ui/PlacesCredit';

function entry(
    photoUrl: string | null,
    photoSource: ListEntry['restaurant']['photo_source'] = 'user',
    attributionHtml: string | null = null,
    name = 'Place',
): Pick<ListEntry, 'restaurant'> {
    return {
        restaurant: {
            id: 'r',
            name,
            address: null,
            city: null,
            country: null,
            photo_url: photoUrl,
            photo_source: photoSource,
            places_photo_attribution_html: attributionHtml,
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
    it('takes a known non-Places restaurant hero without a credit', () => {
        expect(deriveCover([entry('a.jpg'), entry('b.jpg')])).toEqual({
            photoUrl: 'a.jpg',
        });
    });

    it('passes the parsed label with an attributed Places restaurant hero', () => {
        expect(deriveCover([
            entry('places.jpg', 'places', '<a href="https://maps.example/jane">Jane Doe</a>'),
        ])).toEqual({
            photoUrl: 'places.jpg',
        });
    });

    it('suppresses an uncredited Places hero and stale source-less payloads', () => {
        const stale = entry('stale.jpg');
        delete stale.restaurant.photo_source;
        expect(deriveCover([entry('places.jpg', 'places', null)])).toBeNull();
        expect(deriveCover([entry('places.jpg', 'places', '<a href="https://x.test"></a>')])).toBeNull();
        expect(deriveCover([stale])).toBeNull();
    });

    it('is null when the first entry has no photo or the list is empty', () => {
        expect(deriveCover([entry(null), entry('b.jpg')])).toBeNull();
        expect(deriveCover([])).toBeNull();
    });
});

describe('deriveListPlacesCredits', () => {
    it('aggregates every rendered Places row and dedupes normalized authors in order', () => {
        const summary = deriveListPlacesCredits([
            entry('one.jpg', 'places', '<a href="https://maps.test/jane">Jane Doe</a>', 'One'),
            entry('two.jpg', 'places', '  JANE   DOE  ', 'Two'),
            entry('three.jpg', 'places', 'Marco', 'Three'),
            entry('own.jpg', 'user', null, 'Own photo'),
        ]);

        expect(summary.photoCount).toBe(4);
        expect(dedupePlacesCredits(summary.credits).map((credit) => credit.label)).toEqual([
            'Jane Doe',
            'Marco',
        ]);
    });

    it('does not credit or count a suppressed un-attributed Places row', () => {
        expect(deriveListPlacesCredits([
            entry('missing.jpg', 'places', null),
            entry('own.jpg', 'table', null),
        ])).toEqual({ credits: [], photoCount: 0 });
    });

    it('tracks cover and row image failures as separate rendered instances', () => {
        const rows = [
            entry('one.jpg', 'places', 'Jane', 'One'),
            entry('two.jpg', 'places', 'Marco', 'Two'),
        ];
        const failedCover = listCoverPhotoFailureKey(rows)!;
        const failedSecondRow = listRowPhotoFailureKey(rows[1])!;

        const summary = deriveListPlacesCredits(rows, new Set([
            failedCover,
            failedSecondRow,
        ]));

        expect(summary.photoCount).toBe(1);
        expect(dedupePlacesCredits(summary.credits).map((credit) => credit.label))
            .toEqual(['Jane']);
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

    it('missing owner profile drops the byline but keeps profile-free lines (F5a)', () => {
        expect(deriveContextLine(list(), false, null)).toBeNull();
        expect(deriveContextLine(list({ table_id: 't1' }), false, null)).toEqual({
            kind: 'table',
            text: 'Shared with everyone at this Table',
        });
        expect(deriveContextLine(list({ privacy: 'private' }), true, null)).toEqual({
            kind: 'private',
            text: 'Only you can find this list',
        });
    });
});
