export type QuickTake = {
    prompt_key: string;
    position: number;
    restaurant_id: string;
    name: string;
    city: string | null;
    cuisine: string | null;
    /** Guaranteed Places/public-safe. User and Table photos never enter hydration. */
    photo_url: string | null;
    note: string | null;
};

type TakeRow = {
    prompt_key: string;
    position: number;
    restaurant_id: string;
    note: string | null;
};

type RestaurantRow = {
    id: string;
    name: string;
    city: string | null;
    cuisine: string | null;
    photo_url: string | null;
    photo_source: string | null;
};

/**
 * A deliberately narrow public projection. Ratings, entries, entry photos,
 * saves, and Table data are not accepted as inputs and therefore cannot leak
 * into the output. Non-Places restaurant images are suppressed.
 */
export function hydrateProfileTakes(
    takes: TakeRow[],
    restaurants: RestaurantRow[],
): QuickTake[] {
    const byId = new Map(restaurants.map((restaurant) => [restaurant.id, restaurant]));
    return [...takes]
        .sort((a, b) => a.position - b.position)
        .map((take): QuickTake | null => {
            const restaurant = byId.get(take.restaurant_id);
            if (!restaurant) return null;
            return {
                prompt_key: take.prompt_key,
                position: take.position,
                restaurant_id: take.restaurant_id,
                name: restaurant.name,
                city: restaurant.city ?? null,
                cuisine: restaurant.cuisine ?? null,
                photo_url: restaurant.photo_source === 'places'
                    ? (restaurant.photo_url ?? null)
                    : null,
                note: take.note ?? null,
            };
        })
        .filter((take): take is QuickTake => take !== null);
}
