import { resolveTilePhoto } from '../restaurantPhoto';

describe('resolveTilePhoto', () => {
    // ── Legacy path (no new inputs) — byte-for-byte with pre-157 behaviour ──────
    // EditTop4Sheet passes NEITHER photo_source NOR places_hero_enabled. It reads
    // only `.kind` and `.url`, so the added `isPlaces: false` is inert. These
    // assertions lock the legacy contract: an un-gated primary_photo_url is always
    // returned, unconditionally, and never washed.
    describe('legacy path (places_hero_enabled === undefined)', () => {
        it('returns primary_photo_url unconditionally, never washed', () => {
            expect(
                resolveTilePhoto({ primary_photo_url: 'https://cdn/hero.jpg', restaurant_name: 'Kono' }),
            ).toEqual({ kind: 'url', url: 'https://cdn/hero.jpg', isPlaces: false });
        });

        it('returns primary_photo_url even when photo_source happens to be present but no flag', () => {
            // Without the flag, photo_source is irrelevant — legacy path is unconditional.
            expect(
                resolveTilePhoto({ primary_photo_url: 'https://cdn/hero.jpg', photo_source: 'places' }),
            ).toEqual({ kind: 'url', url: 'https://cdn/hero.jpg', isPlaces: false });
        });

        it('falls to ghost when there is no photo at all', () => {
            expect(resolveTilePhoto({ restaurant_name: 'Foo Bar' })).toEqual({
                kind: 'ghost',
                initial: 'F',
            });
        });

        it('ghost initial defaults to "?" when name is missing/blank', () => {
            expect(resolveTilePhoto({})).toEqual({ kind: 'ghost', initial: '?' });
            expect(resolveTilePhoto({ restaurant_name: '   ' })).toEqual({ kind: 'ghost', initial: '?' });
        });
    });

    // ── custom_photo_url tier — chosen-memory precedence is absolute ────────────
    describe('custom_photo_url (chosen-memory) precedence', () => {
        it('wins over a Places-gated primary photo and is never washed', () => {
            expect(
                resolveTilePhoto({
                    custom_photo_url: 'https://cdn/memory.jpg',
                    primary_photo_url: 'https://cdn/places.jpg',
                    photo_source: 'places',
                    places_hero_enabled: true,
                }),
            ).toEqual({ kind: 'url', url: 'https://cdn/memory.jpg', isPlaces: false });
        });

        it('wins on the legacy path too', () => {
            expect(
                resolveTilePhoto({
                    custom_photo_url: 'https://cdn/memory.jpg',
                    primary_photo_url: 'https://cdn/other.jpg',
                }),
            ).toEqual({ kind: 'url', url: 'https://cdn/memory.jpg', isPlaces: false });
        });
    });

    // ── Gated path (render surfaces always pass a boolean flag) ─────────────────
    describe('gated path (places_hero_enabled is a boolean)', () => {
        it('flag on + photo_source "places" → photo, isPlaces true (washed)', () => {
            expect(
                resolveTilePhoto({
                    primary_photo_url: 'https://cdn/places.jpg',
                    photo_source: 'places',
                    places_hero_enabled: true,
                    restaurant_name: 'Kono',
                }),
            ).toEqual({ kind: 'url', url: 'https://cdn/places.jpg', isPlaces: true });
        });

        it('flag off → typographic even when photo_source is "places"', () => {
            expect(
                resolveTilePhoto({
                    primary_photo_url: 'https://cdn/places.jpg',
                    photo_source: 'places',
                    places_hero_enabled: false,
                    restaurant_name: 'Kono',
                }),
            ).toEqual({ kind: 'ghost', initial: 'K' });
        });

        it('flag on + photo_source undefined (stale pre-redeploy cache) → typographic', () => {
            expect(
                resolveTilePhoto({
                    primary_photo_url: 'https://cdn/places.jpg',
                    places_hero_enabled: true,
                    restaurant_name: 'Kono',
                }),
            ).toEqual({ kind: 'ghost', initial: 'K' });
        });

        it('flag on + non-Places photo_source (e.g. "user") → typographic (never leak un-attributed)', () => {
            expect(
                resolveTilePhoto({
                    primary_photo_url: 'https://cdn/user.jpg',
                    photo_source: 'user',
                    places_hero_enabled: true,
                    restaurant_name: 'Kono',
                }),
            ).toEqual({ kind: 'ghost', initial: 'K' });
        });

        it('flag on + photo_source "none" sentinel → typographic', () => {
            expect(
                resolveTilePhoto({
                    primary_photo_url: null,
                    photo_source: 'none',
                    places_hero_enabled: true,
                    restaurant_name: 'Kono',
                }),
            ).toEqual({ kind: 'ghost', initial: 'K' });
        });
    });
});
