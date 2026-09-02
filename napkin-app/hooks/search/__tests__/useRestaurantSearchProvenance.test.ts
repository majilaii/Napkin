import { mergeSearchResults } from '../mergeSearchResults';
import type {
    PersistedSearchResult,
    PlacesResult,
} from '../searchCache';

const persisted: PersistedSearchResult = {
    visitedByMyTables: [
        {
            id: 'visited-1',
            name: 'Cafe Jane',
            city: 'London',
            cuisine: 'Cafe',
            address: '1 Test Street',
            photo_url: 'https://images.test/visited.jpg',
            photo_source: 'places',
            places_photo_attribution_html: '<a href="https://maps.test/jane">Jane Doe</a>',
            external_id: 'google-visited',
            table_name: 'Sunday Lunch',
            most_recent_activity_at: '2026-07-15T12:00:00Z',
        },
    ],
    onNapkin: [
        {
            id: 'napkin-1',
            name: 'Own Photo',
            city: 'London',
            cuisine: null,
            address: null,
            photo_url: 'https://images.test/user.jpg',
            photo_source: 'user',
            places_photo_attribution_html: null,
            external_id: null,
        },
    ],
};

const ghost: PlacesResult = {
    id: 'google-ghost',
    name: 'Ghost Place',
    city: 'London',
    cuisine: null,
    photoReference: 'places/reference',
    photoAttributionHtml: 'Ghost Author',
    formattedAddress: '2 Test Street',
    latitude: 51.5,
    longitude: -0.1,
    fartherAfield: true,
};

describe('useRestaurantSearch provenance adapter', () => {
    it('carries persisted source and attribution while keeping Places ghosts text-only', () => {
        const result = mergeSearchResults([ghost], persisted);

        expect(result.visited[0]).toMatchObject({
            photoUrl: 'https://images.test/visited.jpg',
            photoSource: 'places',
            photoAttributionHtml: '<a href="https://maps.test/jane">Jane Doe</a>',
        });
        expect(result.onNapkin[0]).toMatchObject({
            photoUrl: 'https://images.test/user.jpg',
            photoSource: 'user',
            photoAttributionHtml: null,
        });
        expect(result.morePlaces[0]).toMatchObject({
            photoUrl: null,
            photoSource: null,
            photoReference: 'places/reference',
            photoAttributionHtml: 'Ghost Author',
            fartherAfield: true,
        });
    });

    it('enriches persisted coordinates/price from the matching Place without replacing its labelled rating', () => {
        const labelled = { tier: 'friends' as const, value: 3.3, scale: 5 as const };
        const matching: PlacesResult = {
            ...ghost,
            id: 'google-visited',
            latitude: 48.86,
            longitude: 2.35,
            googleRating: 4.9,
            priceLevel: 3,
        };
        const enrichedPersisted: PersistedSearchResult = {
            ...persisted,
            visitedByMyTables: [{
                ...persisted.visitedByMyTables[0],
                lat: null,
                lng: null,
                google_rating: 4.4,
                is_pinned: true,
                friends_been_count: 2,
                rating: labelled,
            }],
        };

        const result = mergeSearchResults([matching], enrichedPersisted);
        expect(result.visited[0]).toMatchObject({
            lat: 48.86,
            lng: 2.35,
            googleRating: 4.9,
            priceLevel: 3,
            isPinned: true,
            friendsBeenCount: 2,
            rating: labelled,
        });
        expect(result.morePlaces).toEqual([]);
    });
});
