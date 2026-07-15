/**
 * Shared restaurant upsert logic.
 * Used by both the entry and table-night edge functions.
 *
 * TICKET-187: also home of the deferred hero-photo acquisition job
 * (acquireAndMirrorHeroPhotos) that resolve-url's save_spots schedules via
 * EdgeRuntime.waitUntil AFTER responding — the save critical path carries
 * zero Google calls. NOTE: editing this file redeploys the ENTIRE edge fleet
 * (prod-deploy.yml); keep changes additive / behavior-preserving.
 */

import { escapeAttr } from './htmlEscape.ts';

// TICKET-057: when adding a second hero-photo writer, extract _setRestaurantHero({ url, source,
// photoReference, attributionHtml }) from this file so all writers share one UPDATE statement and
// the CHECK constraint invariant (photo_source = 'places' ↔ places_photo_attribution_html IS NOT
// NULL) is enforced at the call-site rather than only in the DB. Currently only _storeHeroPhoto
// writes restaurants.photo_url, so the centralized helper is premature — but the next writer
// (likely entry-promotion or Table-photo) should trigger the extraction.

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
    // TICKET-057: synthesized attribution HTML from Places authorAttributions.
    // Must be passed alongside photoReference so _storeHeroPhoto can persist
    // places_photo_attribution_html and photo_source = 'places' atomically.
    photoAttributionHtml?: string | null;
    // Places metadata (optional — present when seeded from places-search)
    googleRating?: number;
    googleRatingCount?: number;
    priceLevel?: number;
    cuisine?: string;
    // TICKET-081: restaurant-page metadata. Each is sparse-write — only set the
    // column when defined/non-null so a follow-up sparse upsert (e.g. an entry
    // create carrying only external_id + name) can't wipe values an earlier
    // Places lookup populated. Mirrors the city/country discipline below.
    phone?: string;
    website?: string;
    googleMapsUri?: string;    // → google_maps_uri column
    // TICKET-081 fix-pass (Codex HIGH): no openNow (point-in-time, stale when cached).
    // Only weekdayDescriptions is persisted; normalized to non-empty trimmed strings
    // before write so a ['']/whitespace/garbage payload can't overwrite good hours.
    hours?: { weekdayDescriptions: string[] } | null;
    // TICKET-060 H4/R3: ghost quarantine.
    // 'verified' (default) = canonical Places-matched or confirmed restaurant.
    // 'unverified' = model-created ghost, owned per-save by createdBy.
    verification?: 'verified' | 'unverified';
    createdBy?: string;    // user_id for unverified ghosts
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
    // Google place types → restaurant-page tag chips. Sparse-write: only when
    // the payload actually carries types, so a metadata-less upsert (entry
    // create with name+external_id only) can't wipe an earlier write.
    if (Array.isArray(input.types) && input.types.length > 0) {
        upsertRow.place_types = input.types;
    }
    // TICKET-081: metadata columns — same sparse-write discipline as city/country
    // above. A sparse upsert that omits these leaves the existing values intact.
    const phone = input.phone?.trim();
    const website = input.website?.trim();
    const googleMapsUri = input.googleMapsUri?.trim();
    if (phone) upsertRow.phone = phone;
    if (website) upsertRow.website = website;
    if (googleMapsUri) upsertRow.google_maps_uri = googleMapsUri;
    // hours: NORMALIZE before write (TICKET-081 fix-pass, Codex MEDIUM). The naive
    // `weekdayDescriptions.length > 0` guard let a ['']/whitespace/non-string array
    // through, overwriting good hours with garbage. Filter to non-empty trimmed
    // strings and only write when ≥1 usable string survives — matching the trim
    // rigor already applied to phone/website above. openNow is never stored.
    const usableDescriptions = Array.isArray(input.hours?.weekdayDescriptions)
        ? input.hours!.weekdayDescriptions.filter(
            (d): d is string => typeof d === 'string' && d.trim() !== '',
        ).map(d => d.trim())
        : [];
    if (usableDescriptions.length > 0) {
        upsertRow.hours = { weekdayDescriptions: usableDescriptions };
    }
    // TICKET-081 fix-pass (Codex MEDIUM): stamp places_synced_at whenever this upsert
    // carried ANY Places-sourced field (ratings/cuisine OR phone/website/maps/hours).
    // This is the durable sentinel the lazy backfill gates on — once stamped, the page
    // stops re-fetching Place Details for 30 days even when a place legitimately has no
    // phone/hours. Without this, a metadata-only backfill (no ratings) would never set
    // the sentinel and would re-hit Google forever.
    const wroteAnyPlacesField =
        Object.keys(placesMetadata).length > 0
        || !!phone
        || !!website
        || !!googleMapsUri
        || usableDescriptions.length > 0;
    if (wroteAnyPlacesField) {
        upsertRow.places_synced_at = new Date().toISOString();
    }
    // TICKET-060 H4/R3: preserve verification + created_by for ghost management.
    if (input.verification !== undefined) upsertRow.verification = input.verification;
    if (input.createdBy !== undefined) upsertRow.created_by = input.createdBy;

    const { data, error } = await supabase
        .from('restaurants')
        .upsert(upsertRow, { onConflict: 'external_id' })
        .select('id, photo_url')
        .single();

    if (error) throw error;

    // Download and store hero photo if we have a reference and the row has no photo yet
    if (input.photoReference && !data.photo_url) {
        await _storeHeroPhoto(supabase, data.id, input.photoReference, input.photoAttributionHtml ?? null);
    }

    return data.id;
}

/**
 * Downloads the hero photo from Google Places media endpoint, uploads it to
 * the restaurant-photos Supabase Storage bucket, and updates the restaurant row.
 * All errors are swallowed — photo failure must never block restaurant creation.
 *
 * TICKET-057: photoAttributionHtml must be provided alongside photoReference.
 * Empty/missing attribution short-circuits the mirror path entirely (AC 12):
 * no Google media fetch, no Storage write — a sentinel UPDATE stamps
 * photo_source = 'none' so the lazy-backfill trigger in app/restaurant/[id].tsx
 * does not re-fire Place Details on every subsequent page visit.
 *
 * TICKET-187 state doctrine (terminal vs transient):
 *   - no usable photo / empty attribution → photo_source='none' (TERMINAL, never retried);
 *   - transient HTTP/network/upload failure → photo_source stays NULL (RETRYABLE —
 *     healed by the restaurant-page lazy backfill or the backfill script sweep).
 * Behavior-preserving for all existing synchronous callers (entry, table-night,
 * places-search persist=true): still synchronous, still CAS on photo_url IS NULL.
 */
async function _storeHeroPhoto(
    supabase: any,
    restaurantId: string,
    photoReference: string,
    photoAttributionHtml: string | null,
): Promise<void> {
    try {
        // AC 12: empty attribution → sentinel, no mirror. Fires before any fetch.
        if (!photoAttributionHtml || photoAttributionHtml.trim() === '') {
            console.log(`No attribution for ${restaurantId} — stamping photo_source='none', skipping mirror.`);
            await supabase
                .from('restaurants')
                .update({ photo_source: 'none' })
                .eq('id', restaurantId)
                .is('photo_url', null);
            return;
        }

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

        // TICKET-187: reference-derived key, NOT a shared hero.jpg. The old shared
        // key let a race between two writers with DIFFERENT references overwrite the
        // object after the other won the metadata CAS — bytes attributed to the wrong
        // author. With `<id>/<sha1(reference)>.jpg`: same-reference concurrent writers
        // produce byte-identical objects; different-reference writers produce DISTINCT
        // objects and only the CAS winner's URL is ever referenced — the loser is a
        // harmless orphan, never mis-attributed. photo_reference/attribution always
        // match the persisted photo_url.
        const storagePath = `${restaurantId}/${await sha1Hex(photoReference)}.jpg`;

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

        // TICKET-057: write photo_url, photo_reference, attribution, and photo_source
        // atomically in a single UPDATE. The CHECK constraint on the DB enforces that
        // places_photo_attribution_html IS NOT NULL requires photo_source = 'places'.
        // TICKET-187: exact-URL CAS — the URL written is the public URL of THIS
        // writer's reference-derived object, guarded on photo_url IS NULL. Exactly
        // one writer wins; a loser's distinct object is orphaned, never referenced.
        await supabase
            .from('restaurants')
            .update({
                photo_url: publicUrlData.publicUrl,
                photo_reference: photoReference,
                places_photo_attribution_html: photoAttributionHtml,
                photo_source: 'places',
            })
            .eq('id', restaurantId)
            .is('photo_url', null);

    } catch (e) {
        console.error('Hero photo storage failed (non-fatal):', e);
    }
}

// ── TICKET-187: deferred hero-photo acquisition ───────────────────────────────

/** Lowercase hex SHA-1 — derives the reference-unique Storage key. */
async function sha1Hex(s: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Synthesize the attribution anchor from a photos-only Place Details body.
 * Mirrors places-search's sanitizePlace contract exactly (TICKET-057 AC 13):
 * first photo's first authorAttribution only, type-guarded (a version-skewed
 * non-string field degrades to null → the 'none' sentinel, never a throw),
 * escape-on-write so the client parser only ever sees HTML we produced.
 */
export function buildPhotoAttributionHtml(body: unknown): string | null {
    // deno-lint-ignore no-explicit-any
    const att = (body as any)?.photos?.[0]?.authorAttributions?.[0];
    const displayName = typeof att?.displayName === 'string' && att.displayName.trim() !== ''
        ? att.displayName
        : null;
    if (!displayName) return null;
    const uri = typeof att?.uri === 'string' && att.uri.trim() !== '' ? att.uri : null;
    return uri
        ? `<a href="${escapeAttr(uri)}">${escapeAttr(displayName)}</a>`
        : escapeAttr(displayName);
}

/**
 * TICKET-187: acquire + mirror hero photos for a batch of restaurant rows —
 * the deferred job resolve-url's handleSaveSpots schedules via
 * EdgeRuntime.waitUntil AFTER the save response is built. Never runs on a save
 * critical path; never throws.
 *
 * Receives ONLY deduplicated restaurant_ids + the requester's user id — NEVER
 * client-paired external ids or client photo fields (the Place-B-photo →
 * Restaurant-A forgery is structurally impossible: everything is re-derived
 * from the restaurants table).
 *
 * Per id, in order:
 *   1. Load external_id, photo_url, photo_source, verification FROM restaurants.
 *   2. Skip BEFORE any rate token: already mirrored (photo_url set), terminal
 *      (photo_source set), no external_id, or not verification='verified'
 *      (ghost rows carry synthetic ghost_* external ids — a guaranteed-404
 *      Details call that would burn budget and starve real photo work; repeat
 *      imports of mirrored rows stay free).
 *   3. photo_fetch rate bucket — check_and_increment_rate_limit, FAIL-CLOSED
 *      (TICKET-091): an RPC error or exhausted budget stops the job. The save
 *      already succeeded; the photo lands later via the backfill sweep.
 *   4. Photos-only Place Details by the DB-derived external_id
 *      (photos.name,photos.authorAttributions field mask ONLY — Essentials tier).
 *   5. Terminal decision: Details OK but no photo or empty attribution →
 *      photo_source='none' (terminal). Transient HTTP/network failure (incl. a
 *      404 stale place id — healed by the backfill's --refresh-stale) → leave
 *      NULL (retryable).
 *   6. _storeHeroPhoto — reference-derived key + exact-URL CAS.
 */
export async function acquireAndMirrorHeroPhotos(
    // deno-lint-ignore no-explicit-any
    supabase: any,
    restaurantIds: string[],
    userId: string,
): Promise<void> {
    try {
        const ids = [...new Set(restaurantIds.filter((id) => !!id))];
        if (ids.length === 0) return;

        // No API key → no Google call is possible; leave rows NULL (retryable by
        // the backfill sweep) WITHOUT consuming any rate tokens.
        const apiKey = Deno.env.get('GOOGLE_PLACES_API_KEY');
        if (!apiKey) return;

        const { data: rows, error } = await supabase
            .from('restaurants')
            .select('id, external_id, photo_url, photo_source, verification')
            .in('id', ids);
        if (error || !Array.isArray(rows)) return;

        const rawMax = Number(Deno.env.get('PHOTO_FETCH_MAX_PER_DAY') ?? '200');
        const photoFetchMax = Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : 200;

        for (const row of rows) {
            // ── Pre-token filters: repeat imports must be FREE ────────────────
            if (row.photo_url) continue;                      // already mirrored
            if (row.photo_source) continue;                   // terminal ('none'/'places'/…)
            if (!row.external_id) continue;                   // no Places handle
            if (row.verification !== 'verified') continue;    // ghost quarantine

            // ── photo_fetch bucket — fail-closed (TICKET-091 doctrine) ────────
            let allowed = false;
            try {
                const { data: rlRows, error: rlErr } = await supabase.rpc(
                    'check_and_increment_rate_limit',
                    {
                        p_user_id: userId,
                        p_bucket_key: 'photo_fetch',
                        p_max: photoFetchMax,
                        p_window_seconds: 86400,
                    },
                );
                allowed = !rlErr && !!rlRows?.[0]?.allowed;
            } catch {
                allowed = false;
            }
            // Budget exhausted or DB blip → stop the WHOLE job (every later row
            // would be denied too). Rows stay NULL — the backfill sweep heals them.
            if (!allowed) return;

            // ── Photos-only Details by the DB-derived external_id ─────────────
            let details: Response;
            try {
                details = await fetch(
                    `https://places.googleapis.com/v1/places/${encodeURIComponent(row.external_id)}`,
                    {
                        headers: {
                            'X-Goog-Api-Key': apiKey,
                            'X-Goog-FieldMask': 'photos.name,photos.authorAttributions',
                        },
                    },
                );
            } catch {
                continue; // network failure → transient (NULL, retryable)
            }
            if (!details.ok) {
                // Includes 404 (stale place id): deliberately NOT terminal — the
                // backfill's --refresh-stale re-finds the place; stamping 'none'
                // here would hide the row from that sweep forever.
                continue;
            }
            // deno-lint-ignore no-explicit-any
            let body: any;
            try {
                body = await details.json();
            } catch {
                continue; // malformed body → transient
            }

            const photoName: string | null = body?.photos?.[0]?.name ?? null;
            const attributionHtml = buildPhotoAttributionHtml(body);
            if (!photoName || !attributionHtml) {
                // Genuinely photo-less (or unattributable) place → TERMINAL. Without
                // this, the row re-fires Details forever (the pre-TICKET-187 gap).
                await supabase
                    .from('restaurants')
                    .update({ photo_source: 'none' })
                    .eq('id', row.id)
                    .is('photo_url', null);
                continue;
            }

            await _storeHeroPhoto(supabase, row.id, photoName, attributionHtml);
        }
    } catch (e) {
        // The deferred job must never throw into the isolate.
        console.error('acquireAndMirrorHeroPhotos failed (non-fatal):', e);
    }
}
