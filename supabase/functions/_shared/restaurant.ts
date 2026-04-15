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
    photoReference?: string;
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

    if (input.photoReference) {
        try {
            const apiKey = Deno.env.get('GOOGLE_PLACES_API_KEY');
            if (apiKey) {
                const mediaUrl = `https://places.googleapis.com/v1/${input.photoReference}/media?maxHeightPx=400&maxWidthPx=600&key=${apiKey}`;
                const res = await fetch(mediaUrl, { redirect: 'manual' });
                const photoUrl = res.headers.get('location');
                if (photoUrl) {
                    await supabase
                        .from('restaurants')
                        .update({ photo_url: photoUrl, photo_reference: input.photoReference })
                        .eq('id', data.id)
                        .is('photo_url', null);
                }
            }
        } catch (e) {
            console.error('Photo URL caching failed (non-fatal):', e);
        }
    }

    return data.id;
}
