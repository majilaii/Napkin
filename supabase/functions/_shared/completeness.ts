/**
 * Shared, import-safe primitives for the TICKET-195 completeness paid paths.
 *
 * The field masks are deliberately frozen here so Details field creep cannot
 * silently upgrade the Google SKU. The attestation projection is the only
 * Google payload shape persisted by the completeness worker.
 */

import { escapeAttr } from "./htmlEscape.ts";

// Legacy internal ledger key: the widened Details mask is Enterprise-tier,
// but renaming this key would orphan existing budget configuration rows.
export const DETAILS_PRO_SKU = "places_details_pro" as const;
export const TEXT_SEARCH_SKU = "places_text_search" as const;
export const PHOTO_SKU = "places_photo" as const;

export const FROZEN_ATTESTATION_FIELD_MASK =
  "displayName,location,addressComponents,formattedAddress,photos.name,photos.authorAttributions,rating,userRatingCount,priceLevel,types,primaryType,websiteUri,googleMapsUri,nationalPhoneNumber,regularOpeningHours";

// SKU check recorded 2026-09-02 against Google's Text Search (New) field table:
// addressComponents and location both trigger Text Search Pro. Adding location
// therefore does not raise the request's SKU tier or add a second paid call.
export const FROZEN_DEFERRED_TEXT_SEARCH_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location,places.types,places.primaryType";

export const PLACE_DETAILS_ENDPOINT =
  "https://places.googleapis.com/v1/places/";
export const PLACE_TEXT_SEARCH_ENDPOINT =
  "https://places.googleapis.com/v1/places:searchText";

export interface PlaceAttestationProjection {
  place_id: string;
  display_name: string;
  formatted_address: string | null;
  address_components: unknown[];
  city: string | null;
  country: string | null;
  lat: number;
  lng: number;
  google_rating: number | null;
  google_rating_count: number | null;
  price_level: number | null;
  types: string[] | null;
  primary_type: string | null;
  website: string | null;
  phone: string | null;
  google_maps_uri: string | null;
  opening_hours: PlaceHours | null;
  photo_reference: string | null;
  photo_attribution_html: string | null;
}

/** Persisted Places opening-hours shape. Point-in-time openNow is omitted. */
export interface PlaceHours {
  weekdayDescriptions: string[];
}

export interface GoogleTextCandidate {
  externalId: string;
  name: string | null;
  city: string | null;
  formattedAddress: string | null;
  raw: unknown;
}

export interface RestaurantCompletenessFacts {
  verification: string | null;
  merged_into: string | null;
  lat: number | null;
  lng: number | null;
  photo_url: string | null;
  photo_source: string | null;
  places_photo_attribution_html: string | null;
}

export type RestaurantHeroFacts = Pick<
  RestaurantCompletenessFacts,
  "photo_url" | "photo_source" | "places_photo_attribution_html"
>;

/** Hero completeness is independent from coordinates and verification. */
export function hasCompleteRestaurantHero(
  state: RestaurantHeroFacts,
): boolean {
  if (state.photo_source === "none") return state.photo_url === null;
  const hasUrl = typeof state.photo_url === "string" &&
    state.photo_url.trim() !== "";
  if (state.photo_source === "places") {
    return hasUrl &&
      typeof state.places_photo_attribution_html === "string" &&
      state.places_photo_attribution_html.trim() !== "";
  }
  return (state.photo_source === "user" || state.photo_source === "table") &&
    hasUrl;
}

/** The single COMPLETE predicate shared by legacy, v2, and worker paths. */
export function hasCompleteRestaurantFacts(
  state: RestaurantCompletenessFacts,
): boolean {
  const lat = state.lat;
  const lng = state.lng;
  if (
    state.verification !== "verified" || state.merged_into !== null ||
    typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
    typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180
  ) {
    return false;
  }
  return hasCompleteRestaurantHero(state);
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function displayNameText(value: unknown): string | null {
  const record = asRecord(value);
  return nonEmptyString(record?.text);
}

/** Map the Places v1 PRICE_LEVEL_* enum to the restaurants smallint scale. */
export function mapGooglePriceLevel(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const priceLevelMap: Record<string, number> = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };
  return priceLevelMap[value] ?? null;
}

/** Render a Places primaryType as the restaurant hero cuisine label. */
export function humanizeCuisine(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  const stripped = raw.replace(/_restaurant$/i, "");
  if (!stripped) return null;
  return stripped
    .split("_")
    .map((part) =>
      part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : ""
    )
    .join(" ");
}

/**
 * Normalize Places hours for durable caching. `openNow` is point-in-time and
 * deliberately omitted; the client derives today's hours from the descriptions.
 */
export function mapRegularOpeningHours(raw: unknown): PlaceHours | null {
  const record = asRecord(raw);
  if (!record) return null;
  const descriptions = Array.isArray(record.weekdayDescriptions)
    ? record.weekdayDescriptions.filter((description): description is string =>
      typeof description === "string" && description.trim() !== ""
    )
    : [];
  return descriptions.length > 0 ? { weekdayDescriptions: descriptions } : null;
}

/** Sanitize the first Google author attribution and keep reference+credit paired. */
export function sanitizedPhotoPair(
  value: unknown,
): { reference: string; attributionHtml: string } | null {
  const photo = Array.isArray(value) ? asRecord(value[0]) : null;
  const reference = nonEmptyString(photo?.name);
  const authorAttributions = photo?.authorAttributions;
  const author = Array.isArray(authorAttributions)
    ? asRecord(authorAttributions[0])
    : null;
  const authorName = nonEmptyString(author?.displayName);
  if (!reference || !authorName) return null;

  const uri = nonEmptyString(author?.uri);
  return {
    reference,
    attributionHtml: uri
      ? `<a href="${escapeAttr(uri)}">${escapeAttr(authorName)}</a>`
      : escapeAttr(authorName),
  };
}

/** Long-text address component for one of Google's component types. */
export function addressComponent(
  components: unknown,
  wantedTypes: string[],
): string | null {
  if (!Array.isArray(components)) return null;
  for (const raw of components) {
    const component = asRecord(raw);
    const types = Array.isArray(component?.types)
      ? component!.types.filter((type): type is string =>
        typeof type === "string"
      )
      : [];
    if (wantedTypes.some((type) => types.includes(type))) {
      const longText = nonEmptyString(component?.longText);
      if (longText) return longText;
    }
  }
  return null;
}

/** Parse + validate the exact Place Details projection persisted by the cache. */
export function parsePlaceAttestation(
  placeId: string,
  payload: unknown,
): PlaceAttestationProjection | null {
  const body = asRecord(payload);
  const location = asRecord(body?.location);
  const lat = location?.latitude;
  const lng = location?.longitude;
  const displayName = displayNameText(body?.displayName);
  if (
    !displayName ||
    typeof lat !== "number" || !Number.isFinite(lat) ||
    typeof lng !== "number" || !Number.isFinite(lng)
  ) {
    return null;
  }

  const components = Array.isArray(body?.addressComponents)
    ? body!.addressComponents as unknown[]
    : [];
  const types = Array.isArray(body?.types)
    ? body.types.filter((type): type is string => typeof type === "string")
    : null;
  const rating = body?.rating;
  const ratingCount = body?.userRatingCount;
  const photo = sanitizedPhotoPair(body?.photos);
  return {
    place_id: placeId,
    display_name: displayName,
    formatted_address: nonEmptyString(body?.formattedAddress),
    address_components: components,
    city: addressComponent(components, [
      "locality",
      "postal_town",
      "administrative_area_level_2",
    ]),
    country: addressComponent(components, ["country"]),
    lat,
    lng,
    google_rating: typeof rating === "number" && Number.isFinite(rating)
      ? rating
      : null,
    google_rating_count: typeof ratingCount === "number" &&
        Number.isInteger(ratingCount) && ratingCount >= 0 &&
        ratingCount <= 2_147_483_647
      ? ratingCount
      : null,
    price_level: mapGooglePriceLevel(body?.priceLevel),
    types,
    primary_type: nonEmptyString(body?.primaryType),
    website: nonEmptyString(body?.websiteUri),
    phone: nonEmptyString(body?.nationalPhoneNumber),
    google_maps_uri: nonEmptyString(body?.googleMapsUri),
    opening_hours: mapRegularOpeningHours(body?.regularOpeningHours),
    // Missing credit suppresses the reference atomically. The worker then
    // stamps photo_source='none' without downloading uncredited media.
    photo_reference: photo?.reference ?? null,
    photo_attribution_html: photo?.attributionHtml ?? null,
  };
}

export function parseTextSearchCandidates(
  payload: unknown,
): GoogleTextCandidate[] {
  const body = asRecord(payload);
  if (!Array.isArray(body?.places)) return [];

  const candidates: GoogleTextCandidate[] = [];
  for (const raw of body!.places as unknown[]) {
    const place = asRecord(raw);
    const externalId = nonEmptyString(place?.id);
    if (!place || !externalId) continue;
    const components = place.addressComponents;
    candidates.push({
      externalId,
      name: displayNameText(place.displayName),
      city: addressComponent(components, [
        "locality",
        "postal_town",
        "administrative_area_level_2",
      ]),
      formattedAddress: nonEmptyString(place.formattedAddress),
      raw,
    });
  }
  return candidates;
}

export async function sha1Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-work comparison after the public length check. Empty secrets fail closed. */
export function timingSafeSecretEqual(
  received: string | null,
  expected: string | undefined,
): boolean {
  if (!received || !expected) return false;
  const left = new TextEncoder().encode(received);
  const right = new TextEncoder().encode(expected);
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index] ^ right[index];
  }
  return mismatch === 0;
}
