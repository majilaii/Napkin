import { classifyInteractiveCandidate } from "../_shared/candidateDedupe.ts";
import type { ExtractedCandidate } from "../_shared/visionExtract.ts";

/** Existing restaurants columns only; shared by both exact-id lookup paths. */
export const RESTAURANT_PLACE_SELECT =
  "id, external_id, name, city, address, country, lat, lng, verification, merged_into, place_types, cuisine, google_rating, google_rating_count, price_level, website, google_maps_uri";

export interface RestaurantPlaceRow {
  id: string;
  external_id: string | null;
  name: string;
  city: string | null;
  address: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  verification: string;
  merged_into: string | null;
  place_types: string[] | null;
  cuisine: string | null;
  google_rating: number | null;
  google_rating_count: number | null;
  price_level: number | null;
  website: string | null;
  google_maps_uri: string | null;
}

/** Preserve provider location and metadata when resolving an existing identity. */
export function buildPlacesPayloadFromDb(
  row: RestaurantPlaceRow,
  fallback: ExtractedCandidate,
) {
  return {
    id: row.external_id ?? "",
    name: row.name ?? fallback.name,
    formattedAddress: row.address ?? fallback.address,
    city: row.city ?? fallback.city,
    country: row.country,
    latitude: row.lat,
    longitude: row.lng,
    categories: row.place_types ?? [],
    cuisine: row.cuisine ?? fallback.cuisine,
    googleRating: row.google_rating,
    googleRatingCount: row.google_rating_count,
    priceLevel: row.price_level,
    // Photo references have separate acquisition/attestation rules.
    photoReference: null,
    website: row.website,
    link: row.google_maps_uri,
    external_id: row.external_id ?? "",
    location: {
      address: row.address ?? undefined,
      locality: row.city ?? undefined,
      country: row.country ?? undefined,
    },
  };
}

type ExactRestaurantLookup = (externalId: string) => Promise<{
  data: RestaurantPlaceRow | null;
  error?: unknown;
}>;

/**
 * A provider type rejection can reuse a previously verified identity, but can
 * never approve a new lodging/product/etc. result. Query only its exact id and
 * keep the interactive name/locality gates against the actual stored record.
 * The injected read makes failure/ghost behavior testable without network I/O.
 */
export async function reuseVerifiedRejectedPlace(
  extracted: ExtractedCandidate,
  rejected: { id?: string | null } | undefined,
  lookup: ExactRestaurantLookup,
): Promise<ReturnType<typeof buildPlacesPayloadFromDb> | null> {
  const externalId = rejected?.id;
  if (typeof externalId !== "string" || !externalId.trim()) return null;
  try {
    const { data: row, error } = await lookup(externalId);
    if (
      error || !row || row.external_id !== externalId ||
      row.verification !== "verified" || row.merged_into !== null ||
      !row.name?.trim() ||
      typeof row.lat !== "number" || !Number.isFinite(row.lat) ||
      Math.abs(row.lat) > 90 ||
      typeof row.lng !== "number" || !Number.isFinite(row.lng) ||
      Math.abs(row.lng) > 180
    ) return null;

    // Do not fill missing stored locality with model text before applying gates.
    const decision = classifyInteractiveCandidate(extracted, {
      name: row.name,
      city: row.city,
      formattedAddress: row.address,
    });
    return decision === "matched"
      ? buildPlacesPayloadFromDb(row, extracted)
      : null;
  } catch {
    // An unavailable DB must preserve the existing type-rejected ghost outcome.
    return null;
  }
}
