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
    // Places metadata (optional — present when seeded from places-search)
    googleRating?: number;
    googleRatingCount?: number;
    priceLevel?: number;
    cuisine?: string;
}

/**
 * Upserts a restaurant to the restaurants table and returns its UUID.
 * Persists Google Places metadata when provided.
 * When photoReference is present and photo_url is not yet set, downloads the
 * image bytes from Google, uploads to Supabase Storage (restaurant-photos bucket),
 * and stores the resulting public URL on the row. Photo failure is non-fatal.
 */
export async function upsertRestaurant(
    supabase: any,
    input: RestaurantInput,
): Promise<string> {
    const placesMetadata: Record<string, unknown> = {};
    if (input.googleRating !== undefined && input.googleRating !== null) {
        placesMetadata.google_rating = input.googleRating;
    }
    if (input.googleRatingCount !== undefined && input.googleRatingCount !== null) {
        placesMetadata.google_rating_count = input.googleRatingCount;
    }
    if (input.priceLevel !== undefined && input.priceLevel !== null) {
        placesMetadata.price_level = input.priceLevel;
    }
    if (input.cuisine !== undefined && input.cuisine !== null) {
        placesMetadata.cuisine = input.cuisine;
    }
    if (Object.keys(placesMetadata).length > 0) {
        placesMetadata.places_synced_at = new Date().toISOString();
    }

    // Build the upsert payload. We deliberately DROP undefined/null/empty
    // location fields so a follow-up call with a sparse payload (e.g. an
    // entry create that only carries `external_id` + `name`) cannot wipe a
    // city/country that an earlier Places lookup populated. Postgres' upsert
    // overwrites every column listed; omitting the key is the only way to
    // preserve the existing value on conflict.
    const upsertRow: Record<string, unknown> = {
        external_id: input.external_id,
        name: input.name,
        ...placesMetadata,
    };
    const addr = input.location?.address?.trim();
    const city = input.location?.locality?.trim();
    const country = input.location?.country?.trim();
    if (addr) upsertRow.address = addr;
    if (city) upsertRow.city = city;
    if (country) upsertRow.country = country;
    if (input.latitude !== undefined && input.latitude !== null) upsertRow.lat = input.latitude;
    if (input.longitude !== undefined && input.longitude !== null) upsertRow.lng = input.longitude;

    const { data, error } = await supabase
        .from('restaurants')
        .upsert(upsertRow, { onConflict: 'external_id' })
        .select('id, photo_url')
        .single();

    if (error) throw error;

    // Download and store hero photo if we have a reference and the row has no photo yet
    if (input.photoReference && !data.photo_url) {
        await _storeHeroPhoto(supabase, data.id, input.photoReference);
    }

    return data.id;
}

/**
 * Downloads the hero photo from Google Places media endpoint, uploads it to
 * the restaurant-photos Supabase Storage bucket, and updates the restaurant row.
 * All errors are swallowed — photo failure must never block restaurant creation.
 */
async function _storeHeroPhoto(
    supabase: any,
    restaurantId: string,
    photoReference: string,
): Promise<void> {
    try {
        const apiKey = Deno.env.get('GOOGLE_PLACES_API_KEY');
        if (!apiKey) return;

        // Fetch the actual image bytes (follow redirect to the media file)
        const mediaUrl = `https://places.googleapis.com/v1/${photoReference}/media?maxHeightPx=800&maxWidthPx=1200&key=${apiKey}`;
        const mediaRes = await fetch(mediaUrl);
        if (!mediaRes.ok) {
            console.error(`Photo fetch failed for ${restaurantId}: HTTP ${mediaRes.status}`);
            return;
        }

        const contentType = mediaRes.headers.get('content-type') ?? 'image/jpeg';
        const imageBytes = await mediaRes.arrayBuffer();
        if (imageBytes.byteLength === 0) {
            console.error(`Photo fetch returned empty body for ${restaurantId}`);
            return;
        }

        const storagePath = `${restaurantId}/hero.jpg`;

        const { error: uploadError } = await supabase.storage
            .from('restaurant-photos')
            .upload(storagePath, imageBytes, {
                contentType,
                upsert: true,
            });

        if (uploadError) {
            console.error(`Storage upload failed for ${restaurantId}:`, uploadError);
            return;
        }

        const { data: publicUrlData } = supabase.storage
            .from('restaurant-photos')
            .getPublicUrl(storagePath);

        if (!publicUrlData?.publicUrl) {
            console.error(`Could not derive public URL for ${restaurantId}`);
            return;
        }

        // Only write if photo_url is still null (race-safe: last caller wins but both are valid)
        await supabase
            .from('restaurants')
            .update({
                photo_url: publicUrlData.publicUrl,
                photo_reference: photoReference,
            })
            .eq('id', restaurantId)
            .is('photo_url', null);

    } catch (e) {
        console.error('Hero photo storage failed (non-fatal):', e);
    }
}
