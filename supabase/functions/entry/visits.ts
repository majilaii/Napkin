import { corsHeaders } from '../_shared/cors.ts';
import { errorResponse } from '../_shared/errors.ts';
import { isUuid } from '../_shared/uuid.ts';
import { resolveRestaurantLookupId } from '../_shared/canonicalRestaurant.ts';
import { upsertRestaurant, type RestaurantInput } from '../_shared/restaurant.ts';

export const VISIT_MAX_PHOTOS = 10;
export const VISIT_MAX_CONTENT = 10000;
const actions = new Set(['record_visit', 'save_visit', 'undo_visit']);
const patchKeys = new Set(['rating', 'content', 'visited_at', 'photo_urls']);
const object = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v);

class VisitInputError extends Error {}

/** Allow only the metadata used by the shared restaurant writer. Never forward
 * client-controlled ownership, verification, image URLs, or arbitrary columns. */
export function visitRestaurantInput(value: unknown): RestaurantInput {
    if (!object(value)) throw new VisitInputError('restaurant is required');
    const text = (v: unknown, max = 500): string | undefined =>
        typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined;
    const externalId = text(value.external_id);
    const name = text(value.name);
    if (!externalId || !name) throw new VisitInputError('restaurant.external_id and restaurant.name are required');
    const location = object(value.location) ? value.location : {};
    const finite = (v: unknown, min: number, max: number): number | undefined =>
        typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined;
    const types = value.types ?? value.categories;
    return {
        external_id: externalId,
        name,
        location: {
            address: text(location.address ?? value.formattedAddress),
            locality: text(location.locality ?? value.city),
            country: text(location.country ?? value.country),
        },
        types: Array.isArray(types) ? types.filter((v): v is string => typeof v === 'string' && v.length <= 100).slice(0, 30) : undefined,
        latitude: finite(value.latitude, -90, 90),
        longitude: finite(value.longitude, -180, 180),
        googleRating: finite(value.googleRating ?? value.rating, 0, 5),
        googleRatingCount: finite(value.googleRatingCount ?? value.userRatingCount, 0, 100000000),
        priceLevel: finite(value.priceLevel, 0, 4),
        cuisine: text(value.cuisine),
        phone: text(value.phone),
        website: text(value.website, 2048),
        googleMapsUri: text(value.googleMapsUri ?? value.google_maps_uri, 2048),
    };
}

export function validateVisitPatch(value: unknown, now = new Date()): Record<string, unknown> {
    if (!object(value) || Object.keys(value).some((key) => !patchKeys.has(key))) {
        throw new VisitInputError('patch may only contain rating, content, visited_at and photo_urls');
    }
    const patch = { ...value };
    if ('rating' in patch && patch.rating !== null &&
        (typeof patch.rating !== 'number' || !Number.isFinite(patch.rating) ||
            patch.rating < 0.5 || patch.rating > 5 || !Number.isInteger(patch.rating * 2))) {
        throw new VisitInputError('rating must be a half-star value from 0.5 to 5, or null');
    }
    if ('content' in patch) {
        if (patch.content !== null && (typeof patch.content !== 'string' || patch.content.length > VISIT_MAX_CONTENT)) {
            throw new VisitInputError(`content must be at most ${VISIT_MAX_CONTENT} characters, or null`);
        }
        if (typeof patch.content === 'string') patch.content = patch.content.trim() || null;
    }
    if ('visited_at' in patch && patch.visited_at !== null) {
        const date = patch.visited_at;
        if (typeof date !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(date) ||
            !Number.isFinite(Date.parse(date))) throw new VisitInputError('visited_at must be an ISO date or null');
        // Check the written calendar date as well: Date.parse normalizes Feb 30.
        const day = date.slice(0, 10);
        if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day ||
            new Date(date).toISOString().slice(0, 10) > now.toISOString().slice(0, 10)) {
            throw new VisitInputError('visited_at must be a valid date that is not in the future');
        }
    }
    if ('photo_urls' in patch) {
        const photos = patch.photo_urls;
        if (!Array.isArray(photos) || photos.length > VISIT_MAX_PHOTOS || photos.some((url) => {
            if (typeof url !== 'string' || url.length > 2048 || url.trim() !== url) return true;
            try { return !['http:', 'https:'].includes(new URL(url).protocol); } catch { return true; }
        }) || new Set(photos).size !== photos.length) {
            throw new VisitInputError(`photo_urls must contain at most ${VISIT_MAX_PHOTOS} distinct URLs`);
        }
    }
    return patch;
}

/** Invoked only after entry/index.ts authenticates the caller. SQL functions are
 * service-role-only and repeat all ownership and atomic mutation checks. */
export async function handleVisitAction(
    // deno-lint-ignore no-explicit-any
    supabase: any,
    userId: string,
    body: unknown,
    restaurantWriter = upsertRestaurant,
): Promise<Response | null> {
    if (!object(body) || typeof body.action !== 'string' || !actions.has(body.action)) return null;
    try {
        let rpcName: string;
        let args: Record<string, unknown>;
        if (body.action === 'record_visit') {
            if (!isUuid(body.client_nonce)) throw new VisitInputError('client_nonce must be a UUID');
            if ((body.restaurant_id != null) === (body.restaurant != null)) {
                throw new VisitInputError('Exactly one of restaurant_id or restaurant is required');
            }
            let restaurantId: string | null;
            if (body.restaurant_id != null) {
                if (!isUuid(body.restaurant_id)) throw new VisitInputError('restaurant_id must be a UUID');
                restaurantId = body.restaurant_id;
            } else {
                const input = visitRestaurantInput(body.restaurant);
                // Look up first, so a retry cannot overwrite canonical facts or
                // recreate a merged alias from stale client metadata.
                restaurantId = await resolveRestaurantLookupId(supabase, input.external_id);
                if (!restaurantId) restaurantId = await restaurantWriter(supabase, input);
            }
            rpcName = 'fn_record_visit';
            args = { p_user_id: userId, p_restaurant_id: restaurantId, p_client_nonce: body.client_nonce };
        } else {
            if (!isUuid(body.entry_id)) throw new VisitInputError('entry_id must be a UUID');
            rpcName = body.action === 'save_visit' ? 'fn_save_visit' : 'fn_undo_visit';
            args = { p_user_id: userId, p_entry_id: body.entry_id };
            if (body.action === 'save_visit') args.p_patch = validateVisitPatch(body.patch);
        }
        const { data, error } = await supabase.rpc(rpcName, args);
        if (error) {
            const code = String(error.message ?? '').split(':')[0].trim().toUpperCase();
            if (code === 'NOT_OWNER') return errorResponse(code, 'This visit is no longer available to edit.', 403);
            if (code === 'VISIT_UNDO_REFUSED') return errorResponse(code, 'Only the latest visit without a date, review or sharing can be undone. Refresh and try again.', 409);
            if (code === 'VISIT_NOT_SOLO') return errorResponse(code, 'Open the meal to edit this shared gathering.', 409);
            if (code === 'VISIT_NONCE_MISMATCH') return errorResponse(code, 'This save attempt belongs to a different restaurant. Please retry.', 409);
            if (code === 'RESTAURANT_NOT_FOUND') return errorResponse(code, 'This restaurant is no longer available. Refresh and try again.', 404);
            if (['APPROVED_IMAGE_REQUIRED', 'IMAGE_OBJECT_NOT_BINDABLE'].includes(code)) {
                return errorResponse(code, 'A photo could not be saved. Remove it or try uploading it again.', 409);
            }
            if (error.code === '22023' || error.code === '22007' || error.code === '22008') {
                return errorResponse('INVALID_INPUT', 'Check the rating, date, note and photos, then try again.', 400);
            }
            throw error;
        }
        return new Response(JSON.stringify({ data: body.action === 'undo_visit' ? data : { entry: data } }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    } catch (error) {
        if (error instanceof VisitInputError) return errorResponse('INVALID_INPUT', error.message, 400);
        throw error; // Existing entry error boundary reports unexpected failures.
    }
}
