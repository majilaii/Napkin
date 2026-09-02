import {
    buildFriendsSpread,
    buildRestaurantMeta,
    chooseTableNotesGroup,
    deriveFriendsCohort,
    deriveNumberTiers,
} from './restaurantPageV3';
import type {
    PublicReviewCard,
    RestaurantPageData,
    RestaurantPageRestaurant,
    TableNoteRow,
} from '@/hooks/restaurants/useRestaurantPage';

const review = (
    userId: string,
    rating: number,
    isFollowee: boolean,
): PublicReviewCard => ({
    entry_id: `entry-${userId}-${rating}`,
    user_id: userId,
    display_name: userId,
    username: null,
    avatar_url: null,
    rating,
    note_excerpt: `${userId} note`,
    photo_url: null,
    created_at: '2026-08-20T12:00:00.000Z',
    public_reaction_count: 0,
    public_reply_count: 0,
    calibration: null,
    is_followee: isFollowee,
});

const restaurant = (overrides: Partial<RestaurantPageRestaurant> = {}): RestaurantPageRestaurant => ({
    id: 'restaurant',
    name: 'Kiln',
    address: '58 Brewer St, Soho',
    city: 'London',
    country: 'UK',
    cuisine: 'Thai grill',
    price_level: 2,
    photo_url: null,
    google_rating: 4.6,
    google_rating_count: 2100,
    external_id: 'place',
    photo_source: null,
    places_photo_attribution_html: null,
    phone: null,
    website: null,
    google_maps_uri: null,
    hours: null,
    places_synced_at: null,
    reserve_url: null,
    reserve_url_checked_at: null,
    ...overrides,
});

describe('restaurant page v3 derivations', () => {
    it('derives FRIENDS from followee public reviews only, deduped and viewer-excluded', () => {
        const cohort = deriveFriendsCohort([
            review('friend', 4.5, true),
            review('friend', 3, true),
            review('stranger', 5, false),
            review('viewer', 4, true),
        ], 'viewer');

        expect(cohort.map((member) => [member.user_id, member.rating])).toEqual([
            ['friend', 4.5],
        ]);
    });

    it('builds half-star bins, clamps ratings, and hides spread below three friends', () => {
        const cohort = deriveFriendsCohort([
            review('a', 0.2, true),
            review('b', 4.24, true),
            review('c', 5.4, true),
        ], null);
        const spread = buildFriendsSpread(cohort);

        expect(spread.visible).toBe(true);
        expect(spread.bins).toHaveLength(10);
        expect(spread.bins[0]).toBe(1);
        expect(spread.bins[7]).toBe(1);
        expect(spread.bins[9]).toBe(1);
        expect(buildFriendsSpread(cohort.slice(0, 2)).visible).toBe(false);
    });

    it('composes the masthead without address parsing or dangling separators', () => {
        expect(buildRestaurantMeta(restaurant())).toBe('thai grill · london · ££');
        expect(buildRestaurantMeta(restaurant({
            city: null,
            price_level: null,
            hours: { weekdayDescriptions: ['Tuesday: 12:00\u2009PM – 10:00\u202fPM'] },
        }), new Date('2026-09-01T12:00:00.000Z'))).toBe('thai grill');
        expect(buildRestaurantMeta(restaurant({
            city: null,
            price_level: null,
            hours: { weekdayDescriptions: ['Tuesday: 12:00\u2009PM – 10:00\u202fPM'] },
        }), new Date('2026-09-01T12:00:00.000Z'), true)).toBe('thai grill · open until 22:00');
    });

    it('keeps YOU, FRIENDS, and GOOGLE as separate 0.5–5 tiers', () => {
        const page = {
            personal: { average: 4.25, visit_count: 7 },
            self_log: [],
            public_reviews: [review('friend-a', 4, true), review('friend-b', 5, true)],
        } as unknown as RestaurantPageData;
        const tiers = deriveNumberTiers(page, restaurant(), 'viewer');

        expect(tiers.you).toEqual({ value: 4.25, meta: '7 visits' });
        expect(tiers.friends).toEqual({ value: 4.5, meta: '2 been' });
        expect(tiers.google).toEqual({ value: 4.6, meta: '2.1k ratings' });
        expect(Math.max(
            tiers.you.value!,
            tiers.friends.value!,
            tiers.google.value!,
        )).toBeLessThanOrEqual(5);
    });
});

const tableNote = (
    entryId: string,
    tableId: string,
    date: string,
    tableName = tableId,
): TableNoteRow => ({
    entry_id: entryId,
    table_id: tableId,
    table_name: tableName,
    author: { user_id: `author-${entryId}`, display_name: entryId, avatar_url: null },
    rating: 4,
    note: `note ${entryId}`,
    visited_at: date,
});

describe('restaurant page v3 Table group', () => {
    const rows = [
        tableNote('a1', 'a', '2026-08-04T00:00:00.000Z', 'Table A'),
        tableNote('a2', 'a', '2026-08-03T00:00:00.000Z', 'Table A'),
        tableNote('a3', 'a', '2026-08-02T00:00:00.000Z', 'Table A'),
        tableNote('b1', 'b', '2026-08-01T00:00:00.000Z', 'Table B'),
    ];

    it('chooses the newest group, counts its own rows, and renders at most two', () => {
        const group = chooseTableNotesGroup(rows);
        expect(group?.table_id).toBe('a');
        expect(group?.rows).toHaveLength(3);
        expect(group?.visibleRows.map((row) => row.entry_id)).toEqual(['a1', 'a2']);
    });

    it('honours a matching page tableId over recency', () => {
        const group = chooseTableNotesGroup(rows, 'b');
        expect(group?.table_id).toBe('b');
        expect(group?.rows).toHaveLength(1);
    });

    it('keeps a multi-Table entry once per chosen share-edge group', () => {
        const shared = [
            tableNote('same', 'a', '2026-08-04T00:00:00.000Z'),
            tableNote('same', 'b', '2026-08-04T00:00:00.000Z'),
        ];
        expect(chooseTableNotesGroup(shared, 'a')?.rows).toHaveLength(1);
        expect(chooseTableNotesGroup(shared, 'b')?.rows).toHaveLength(1);
    });
});
