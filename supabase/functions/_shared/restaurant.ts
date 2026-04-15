/**
 * Shared restaurant upsert logic.
 * Used by both the entry and table-night edge functions.
 */

// Food establishment types from Google Places
const FOOD_TYPES = ['restaurant', 'cafe', 'bar', 'bakery', 'meal_takeaway', 'food', 'meal_delivery'];

export interface RestaurantInput {
    external_id: string;
    name: string;
    location?: {
        address?: string;
        locality?: string;
        country?: string;
    };
    types?: string[];
    latitude?: number;
    longitude?: number;
}

/**
 * Upserts a restaurant to the restaurants table and returns its UUID.
 * If the types indicate a non-food place, returns null (caller should handle).
 */
export async function upsertRestaurant(
    supabase: any,
    input: RestaurantInput,
): Promise<string> {
    const { data, error } = await supabase
        .from('restaurants')
        .upsert(
            {
                external_id: input.external_id,
                name: input.name,
                address: input.location?.address,
                city: input.location?.locality,
                country: input.location?.country,
                lat: input.latitude,
                lng: input.longitude,
            },
            { onConflict: 'external_id' },
        )
        .select('id')
        .single();

    if (error) throw error;
    return data.id;
}
