/**
 * listsShelfUtils unit tests (TICKET-185) — the profile Lists shelf normalizers.
 * Pins the meta grammar (places count vs. Table name) and the two source shapes.
 */
import { myListsToShelf, publicListsToShelf } from '../listsShelfUtils';
import type { MyList } from '@/hooks/lists/useMyLists';
import type { ProfileListSummary } from '@/hooks/users/useUserProfile';

function myList(over: Partial<MyList> & { id: string }): MyList {
    return {
        owner_id: 'u1',
        title: 'Best tacos',
        description: null,
        ranked: false,
        privacy: 'public',
        emoji: null,
        table_id: null,
        table_name: null,
        entry_count: 3,
        verified_count: 3,
        cover_photo_url: null,
        created_at: 'c',
        updated_at: 'u',
        ...over,
    };
}

function publicList(over: Partial<ProfileListSummary> & { id: string }): ProfileListSummary {
    return {
        title: 'Faves',
        entry_count: 4,
        ranked: false,
        privacy: 'public',
        updated_at: 'u',
        cover_photo_url: null,
        ...over,
    };
}

describe('myListsToShelf', () => {
    it('maps title, cover, emoji, and a places meta', () => {
        const [item] = myListsToShelf([
            myList({
                id: 'a',
                title: 'Tokyo',
                emoji: '🍣',
                cover_photo_url: 'https://x/p.jpg',
                cover_photo_source: 'user',
                entry_count: 5,
            }),
        ]);
        expect(item).toEqual({
            id: 'a',
            title: 'Tokyo',
            coverPhotoUrl: 'https://x/p.jpg',
            coverPhotoSource: 'user',
            coverAttributionHtml: null,
            coverRestaurantName: null,
            emoji: '🍣',
            meta: '5 places',
        });
    });

    it('uses singular "place" for a one-entry list', () => {
        expect(myListsToShelf([myList({ id: 'a', entry_count: 1 })])[0].meta).toBe('1 place');
    });

    it('shows the Table name as meta for a shared Table list', () => {
        const [item] = myListsToShelf([
            myList({ id: 'a', table_id: 't1', table_name: 'The Crew', entry_count: 9 }),
        ]);
        expect(item.meta).toBe('The Crew');
    });

    it('falls back to a places count when a Table name is unresolved', () => {
        const [item] = myListsToShelf([
            myList({ id: 'a', table_id: 't1', table_name: null, entry_count: 2 }),
        ]);
        expect(item.meta).toBe('2 places');
    });

    it('keeps an attributed Places cover and suppresses missing/invalid or stale credit metadata', () => {
        const valid = myListsToShelf([myList({
            id: 'valid',
            cover_photo_url: 'https://x/places.jpg',
            cover_photo_source: 'places',
            cover_attribution_html: '<a href="https://maps.example/jane">Jane Doe</a>',
        })])[0];
        const missing = myListsToShelf([myList({
            id: 'missing',
            cover_photo_url: 'https://x/missing.jpg',
            cover_photo_source: 'places',
            cover_attribution_html: null,
        })])[0];
        const stale = myListsToShelf([myList({
            id: 'stale',
            cover_photo_url: 'https://x/stale.jpg',
        })])[0];

        expect(valid.coverPhotoUrl).toBe('https://x/places.jpg');
        expect(valid.coverAttributionHtml).toContain('Jane Doe');
        expect(missing.coverPhotoUrl).toBeNull();
        expect(stale.coverPhotoUrl).toBeNull();
    });
});

describe('publicListsToShelf', () => {
    it('maps with no emoji and a places meta', () => {
        const [item] = publicListsToShelf([
            publicList({
                id: 'p',
                title: 'Roma',
                cover_photo_url: 'https://c/1.jpg',
                cover_photo_source: 'table',
                entry_count: 7,
            }),
        ]);
        expect(item).toEqual({
            id: 'p',
            title: 'Roma',
            coverPhotoUrl: 'https://c/1.jpg',
            coverPhotoSource: 'table',
            coverAttributionHtml: null,
            coverRestaurantName: null,
            emoji: null,
            meta: '7 places',
        });
    });
});
