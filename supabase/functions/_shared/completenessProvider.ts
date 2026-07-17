/**
 * Shared paid-path facade for restaurant completeness.
 *
 * Used by the worker, resolve-url, places-search, lazy lookup, and backfill so
 * every outbound Google call crosses the same cache/claim/budget boundary.
 */

import {
  addressComponent,
  DETAILS_PRO_SKU,
  FROZEN_ATTESTATION_FIELD_MASK,
  FROZEN_DEFERRED_TEXT_SEARCH_FIELD_MASK,
  type GoogleTextCandidate,
  hasCompleteRestaurantHero,
  humanizeCuisine,
  mapRegularOpeningHours,
  parsePlaceAttestation,
  parseTextSearchCandidates,
  PHOTO_SKU,
  PLACE_DETAILS_ENDPOINT,
  PLACE_TEXT_SEARCH_ENDPOINT,
  type PlaceAttestationProjection,
  sha1Hex,
  TEXT_SEARCH_SKU,
} from "./completeness.ts";

export type CompletenessPaidPathErrorCode =
  | "BUDGET_DEFERRED"
  | "CLAIM_PENDING"
  | "PROVIDER_FAILURE"
  | "INVALID_PROJECTION"
  | "LEASE_LOST"
  | "MEDIA_CAS_LOST";

export class CompletenessPaidPathError extends Error {
  constructor(
    public readonly code: CompletenessPaidPathErrorCode,
    message: string,
    public readonly providerStatus?: number,
  ) {
    super(message);
    this.name = "CompletenessPaidPathError";
  }
}

export interface CompletenessProviderOptions {
  googleApiKey?: string;
  spendFrozen?: boolean;
  fetchImpl?: typeof fetch;
}

export interface PersistedAttestedRestaurant {
  restaurant_id: string;
  projection: PlaceAttestationProjection;
  hero_url: string | null;
}

export interface SharedRestaurantState {
  id: string;
  external_id: string | null;
  verification: string | null;
  merged_into: string | null;
  completeness_version: number;
  lat: number | null;
  lng: number | null;
  photo_url: string | null;
  photo_reference: string | null;
  photo_source: string | null;
  places_photo_attribution_html: string | null;
  created_by: string | null;
}

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return value === null || value === undefined ? null : value as T;
}

function scalarBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const row = firstRow<Record<string, unknown>>(value);
  if (!row || typeof row !== "object") return false;
  return Object.values(row).some((entry) => entry === true);
}

function scalarString(value: unknown): string | null {
  if (typeof value === "string") return value;
  const row = firstRow<Record<string, unknown>>(value);
  if (!row || typeof row !== "object") return null;
  const candidate = Object.values(row).find((entry) =>
    typeof entry === "string"
  );
  return typeof candidate === "string" ? candidate : null;
}

function cleanError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function trimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function normalizeProjection(
  placeId: string,
  value: unknown,
): PlaceAttestationProjection | null {
  const record = asRecord(value);
  if (!record) return null;
  if (!("display_name" in record)) {
    return parsePlaceAttestation(placeId, record);
  }

  const lat = record.lat;
  const lng = record.lng;
  const name = record.display_name;
  if (
    typeof name !== "string" || name.trim() === "" ||
    typeof lat !== "number" || !Number.isFinite(lat) ||
    typeof lng !== "number" || !Number.isFinite(lng)
  ) return null;
  const reference = typeof record.photo_reference === "string" &&
      record.photo_reference.trim() !== ""
    ? record.photo_reference
    : null;
  const attribution = typeof record.photo_attribution_html === "string" &&
      record.photo_attribution_html.trim() !== ""
    ? record.photo_attribution_html
    : null;
  const components = Array.isArray(record.address_components)
    ? record.address_components
    : [];
  const rating = record.google_rating;
  const ratingCount = record.google_rating_count;
  const priceLevel = record.price_level;
  const types = Array.isArray(record.types)
    ? record.types.filter((type): type is string => typeof type === "string")
    : null;
  return {
    place_id: placeId,
    display_name: name.trim(),
    formatted_address: typeof record.formatted_address === "string"
      ? record.formatted_address
      : null,
    address_components: components,
    city: typeof record.city === "string"
      ? record.city
      : addressComponent(components, [
        "locality",
        "postal_town",
        "administrative_area_level_2",
      ]),
    country: typeof record.country === "string"
      ? record.country
      : addressComponent(components, ["country"]),
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
    price_level: typeof priceLevel === "number" &&
        Number.isInteger(priceLevel) && priceLevel >= 0 && priceLevel <= 4
      ? priceLevel
      : null,
    types,
    primary_type: trimmedString(record.primary_type),
    website: trimmedString(record.website),
    phone: trimmedString(record.phone),
    google_maps_uri: trimmedString(record.google_maps_uri),
    opening_hours: mapRegularOpeningHours(record.opening_hours),
    photo_reference: reference && attribution ? reference : null,
    photo_attribution_html: reference && attribution ? attribution : null,
  };
}

/**
 * Reusable facade. `attest` distinguishes pending/budget/provider failures via
 * CompletenessPaidPathError.code so legacy callers can preserve their exact
 * provider-failure response while v2 callers defer.
 */
export class CompletenessProvider {
  protected readonly fetchImpl: typeof fetch;
  protected readonly googleApiKey: string;
  protected readonly spendFrozen: boolean;

  constructor(
    protected readonly supabase: SupabaseLike,
    options: CompletenessProviderOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.googleApiKey = options.googleApiKey ?? "";
    this.spendFrozen = options.spendFrozen ?? false;
  }

  protected async rpc<T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const { data, error } = await this.supabase.rpc(name, args);
    if (error) throw error;
    return data as T;
  }

  protected async charge(ownerId: string, sku: string): Promise<boolean> {
    if (this.spendFrozen) return false;
    let value: unknown;
    try {
      value = await this.rpc<unknown>("fn_charge_sku_budget", {
        p_user_id: ownerId,
        p_sku: sku,
      });
    } catch {
      return false; // budget infrastructure is fail-closed
    }
    return scalarBoolean(value);
  }

  async searchText(
    ownerId: string,
    query: {
      name: string;
      city: string;
      area?: string | null;
      address?: string | null;
    },
    _claimant?: string,
  ): Promise<GoogleTextCandidate[]> {
    if (!this.googleApiKey) {
      throw new CompletenessPaidPathError(
        "PROVIDER_FAILURE",
        "Google Places key unavailable",
      );
    }
    if (!await this.charge(ownerId, TEXT_SEARCH_SKU)) {
      throw new CompletenessPaidPathError(
        "BUDGET_DEFERRED",
        "places_text_search budget unavailable",
      );
    }

    let response: Response;
    try {
      response = await this.fetchImpl(PLACE_TEXT_SEARCH_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": this.googleApiKey,
          "X-Goog-FieldMask": FROZEN_DEFERRED_TEXT_SEARCH_FIELD_MASK,
        },
        body: JSON.stringify({
          textQuery: [query.name, query.address, query.area, query.city]
            .filter(Boolean)
            .join(", "),
          maxResultCount: 5,
        }),
      });
    } catch (error) {
      throw new CompletenessPaidPathError(
        "PROVIDER_FAILURE",
        `Text Search network failure: ${cleanError(error)}`,
      );
    }
    if (!response.ok) {
      throw new CompletenessPaidPathError(
        "PROVIDER_FAILURE",
        `Text Search HTTP ${response.status}`,
        response.status,
      );
    }
    try {
      return parseTextSearchCandidates(await response.json());
    } catch (error) {
      throw new CompletenessPaidPathError(
        "PROVIDER_FAILURE",
        `Text Search parse failure: ${cleanError(error)}`,
      );
    }
  }

  async attest(
    ownerId: string,
    placeId: string,
    claimant: string,
    leaseSeconds = 180,
  ): Promise<PlaceAttestationProjection> {
    const claimValue = await this.rpc<unknown>("fn_claim_place_attestation", {
      p_place_id: placeId,
      p_claimant: claimant,
      p_lease_seconds: leaseSeconds,
    });
    const claim = firstRow<{ outcome?: string; projection?: unknown }>(
      claimValue,
    );
    if (claim?.outcome === "hit") {
      const projection = normalizeProjection(placeId, claim.projection);
      if (!projection) {
        throw new CompletenessPaidPathError(
          "INVALID_PROJECTION",
          "cached attestation is invalid",
        );
      }
      return projection;
    }
    if (claim?.outcome !== "claimed") {
      throw new CompletenessPaidPathError(
        "CLAIM_PENDING",
        "attestation single-flight lease is live",
      );
    }
    if (!this.googleApiKey) {
      throw new CompletenessPaidPathError(
        "PROVIDER_FAILURE",
        "Google Places key unavailable",
      );
    }
    if (!await this.charge(ownerId, DETAILS_PRO_SKU)) {
      throw new CompletenessPaidPathError(
        "BUDGET_DEFERRED",
        "places_details_pro budget unavailable",
      );
    }

    let response: Response;
    try {
      response = await this.fetchImpl(
        `${PLACE_DETAILS_ENDPOINT}${encodeURIComponent(placeId)}`,
        {
          headers: {
            "X-Goog-Api-Key": this.googleApiKey,
            "X-Goog-FieldMask": FROZEN_ATTESTATION_FIELD_MASK,
          },
        },
      );
    } catch (error) {
      throw new CompletenessPaidPathError(
        "PROVIDER_FAILURE",
        `Place Details network failure: ${cleanError(error)}`,
      );
    }
    if (!response.ok) {
      throw new CompletenessPaidPathError(
        "PROVIDER_FAILURE",
        `Place Details HTTP ${response.status}`,
        response.status,
      );
    }

    let projection: PlaceAttestationProjection | null = null;
    try {
      projection = parsePlaceAttestation(placeId, await response.json());
    } catch (error) {
      throw new CompletenessPaidPathError(
        "PROVIDER_FAILURE",
        `Place Details parse failure: ${cleanError(error)}`,
      );
    }
    if (!projection) {
      throw new CompletenessPaidPathError(
        "INVALID_PROJECTION",
        "Place Details omitted finite coordinates/name",
      );
    }

    const committed = await this.rpc<unknown>("fn_commit_place_attestation", {
      p_place_id: placeId,
      p_claimant: claimant,
      p_projection: projection,
    });
    if (!scalarBoolean(committed)) {
      throw new CompletenessPaidPathError(
        "LEASE_LOST",
        "attestation lease was reclaimed",
      );
    }
    return projection;
  }

  protected async resolveCanonical(restaurantId: string): Promise<string> {
    const value = await this.rpc<unknown>("fn_resolve_canonical", {
      p_id: restaurantId,
    });
    return scalarString(value) ?? restaurantId;
  }

  protected async restaurantState(
    restaurantId: string,
  ): Promise<SharedRestaurantState | null> {
    const { data, error } = await this.supabase
      .from("restaurants")
      .select(
        "id,external_id,verification,merged_into,completeness_version,lat,lng,photo_url,photo_reference,photo_source,places_photo_attribution_html,created_by",
      )
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) throw error;
    return data as SharedRestaurantState | null;
  }

  /**
   * Apply an attested projection only if the exact live row version we read
   * is still current.  This is deliberately a one-shot CAS: retrying against
   * a newer version here could overwrite a concurrent manual repair.
   */
  private async updateAttestedRestaurant(
    state: SharedRestaurantState,
    row: Record<string, unknown>,
  ): Promise<string> {
    const { data, error } = await this.supabase
      .from("restaurants")
      .update(row)
      .eq("id", state.id)
      .is("merged_into", null)
      .eq("completeness_version", state.completeness_version)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data?.id) {
      throw new Error("attested restaurant update lost completeness CAS");
    }
    return data.id;
  }

  /** Install THIS reference's exact URL; zero-row CAS is observable and never acked. */
  private async installExactHeroUrl(
    restaurantId: string,
    reference: string,
    attribution: string,
    committedUrl: string,
  ): Promise<{ installed: boolean; canonicalId: string }> {
    let candidateId = restaurantId;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const canonicalId = await this.resolveCanonical(candidateId);
      const { data, error } = await this.supabase
        .from("restaurants")
        .update({
          photo_url: committedUrl,
          photo_reference: reference,
          places_photo_attribution_html: attribution,
          photo_source: "places",
        })
        .eq("id", canonicalId)
        .is("merged_into", null)
        .is("photo_url", null)
        .select("id,photo_url")
        .maybeSingle();
      if (error) throw error;
      if (data?.id && data.photo_url === committedUrl) {
        return { installed: true, canonicalId: data.id };
      }

      const currentId = await this.resolveCanonical(canonicalId);
      const current = await this.restaurantState(currentId);
      if (current?.photo_url === committedUrl) {
        return { installed: true, canonicalId: current.id };
      }
      if (current?.photo_url) {
        // Another exact-URL writer won. This claim must NOT be marked
        // committed because its own URL is not installed.
        return { installed: false, canonicalId: current.id };
      }
      candidateId = currentId;
    }
    return { installed: false, canonicalId: candidateId };
  }

  async acquireMedia(
    ownerId: string,
    restaurantId: string,
    projection: PlaceAttestationProjection,
    claimant: string,
    leaseSeconds = 180,
  ): Promise<string | null> {
    const reference = projection.photo_reference;
    const attribution = projection.photo_attribution_html;
    if (!reference || !attribution) return null;

    const claimValue = await this.rpc<unknown>("fn_claim_media", {
      p_canonical_restaurant_id: restaurantId,
      p_photo_reference: reference,
      p_claimant: claimant,
      p_lease_seconds: leaseSeconds,
    });
    const claim = firstRow<{ outcome?: string; committed_url?: string | null }>(
      claimValue,
    );
    if (claim?.outcome === "satisfied") {
      return typeof claim.committed_url === "string"
        ? claim.committed_url
        : null;
    }
    if (claim?.outcome === "done") {
      const existingUrl = typeof claim.committed_url === "string"
        ? claim.committed_url
        : null;
      if (existingUrl) {
        // A committed claim transferred during a merge may need its
        // immutable alias-prefixed URL installed on the new canonical row.
        await this.installExactHeroUrl(
          restaurantId,
          reference,
          attribution,
          existingUrl,
        );
      }
      return existingUrl;
    }
    if (claim?.outcome !== "claimed") {
      throw new CompletenessPaidPathError(
        "CLAIM_PENDING",
        "media single-flight lease is live",
      );
    }
    if (!this.googleApiKey) {
      throw new CompletenessPaidPathError(
        "PROVIDER_FAILURE",
        "Google Places key unavailable",
      );
    }
    if (!await this.charge(ownerId, PHOTO_SKU)) {
      throw new CompletenessPaidPathError(
        "BUDGET_DEFERRED",
        "places_photo budget unavailable",
      );
    }

    const mediaUrl = `https://places.googleapis.com/v1/${reference}/media` +
      `?maxHeightPx=800&maxWidthPx=1200&key=${
        encodeURIComponent(this.googleApiKey)
      }`;
    let response: Response;
    try {
      response = await this.fetchImpl(mediaUrl);
    } catch (error) {
      throw new CompletenessPaidPathError(
        "PROVIDER_FAILURE",
        `Place Photo network failure: ${cleanError(error)}`,
      );
    }
    if (!response.ok) {
      throw new CompletenessPaidPathError(
        "PROVIDER_FAILURE",
        `Place Photo HTTP ${response.status}`,
        response.status,
      );
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0) {
      throw new CompletenessPaidPathError(
        "PROVIDER_FAILURE",
        "Place Photo returned an empty body",
      );
    }

    const objectOwnerId = await this.resolveCanonical(restaurantId);
    const storagePath = `${objectOwnerId}/${await sha1Hex(reference)}.jpg`;
    const { error: uploadError } = await this.supabase.storage
      .from("restaurant-photos")
      .upload(storagePath, bytes, {
        contentType: response.headers.get("content-type") ?? "image/jpeg",
        upsert: true,
      });
    if (uploadError) {
      throw new CompletenessPaidPathError(
        "PROVIDER_FAILURE",
        `hero upload failed: ${cleanError(uploadError)}`,
      );
    }
    const { data: publicData } = this.supabase.storage
      .from("restaurant-photos")
      .getPublicUrl(storagePath);
    const committedUrl = publicData?.publicUrl;
    if (typeof committedUrl !== "string" || committedUrl === "") {
      throw new CompletenessPaidPathError(
        "PROVIDER_FAILURE",
        "hero public URL unavailable",
      );
    }

    // Re-resolve AFTER upload. A merge may have moved the claim while the
    // paid fetch ran. Path relaxation intentionally keeps storagePath.
    const installed = await this.installExactHeroUrl(
      objectOwnerId,
      reference,
      attribution,
      committedUrl,
    );
    if (!installed.installed) {
      const winner = await this.restaurantState(installed.canonicalId);
      if (winner?.photo_url && winner.photo_source) {
        // A user/table/other exact writer legitimately won. Leave this
        // media claim uncommitted so it cannot assert the wrong URL;
        // the restaurant itself is nevertheless hero-complete.
        return winner.photo_url;
      }
      throw new CompletenessPaidPathError(
        "MEDIA_CAS_LOST",
        "exact hero URL was not installed; media claim left uncommitted",
      );
    }

    const committed = await this.rpc<unknown>("fn_commit_media", {
      p_canonical_restaurant_id: installed.canonicalId,
      p_photo_reference: reference,
      p_claimant: claimant,
      p_committed_url: committedUrl,
    });
    if (!scalarBoolean(committed)) {
      throw new CompletenessPaidPathError(
        "LEASE_LOST",
        "media lease was reclaimed",
      );
    }
    return committedUrl;
  }

  /**
   * Persist the attested projection while preserving existing metadata for
   * every nullable field Google omitted. With persistHero=true the same shared
   * media claim is used before any paid download.
   */
  async persistAttestedRestaurant(
    ownerId: string,
    optionalRestaurantId: string | null,
    projection: PlaceAttestationProjection,
    claimant: string,
    persistHero: boolean,
    allowVerifiedReidentity = false,
  ): Promise<PersistedAttestedRestaurant> {
    let targetId: string | null = optionalRestaurantId;
    if (targetId) {
      const state = await this.restaurantState(
        await this.resolveCanonical(targetId),
      );
      if (!state) throw new Error("restaurant not found");
      if (
        state.verification === "verified" &&
        state.external_id !== projection.place_id &&
        !allowVerifiedReidentity
      ) {
        throw new Error(
          "verified restaurant identity does not match attestation",
        );
      }
      if (state.verification !== "verified" && state.created_by !== ownerId) {
        throw new Error("unverified restaurant is not owned by caller");
      }
      const value = await this.rpc<unknown>("fn_canonicalize_ghost", {
        p_ghost_id: state.id,
        p_canonical_external_id: projection.place_id,
        p_expected_version: state.completeness_version,
        p_context: "shared-attestation",
      });
      targetId = scalarString(value);
      if (!targetId) throw new Error("canonicalization returned no id");
    }

    const city = addressComponent(projection.address_components, [
      "locality",
      "postal_town",
      "administrative_area_level_2",
    ]);
    const country = addressComponent(projection.address_components, [
      "country",
    ]);
    const row: Record<string, unknown> = {
      external_id: projection.place_id,
      name: projection.display_name,
      lat: projection.lat,
      lng: projection.lng,
      verification: "verified",
    };
    if (projection.formatted_address) {
      row.address = projection.formatted_address;
    }
    if (city) row.city = city;
    if (country) row.country = country;
    if (projection.google_rating !== null) {
      row.google_rating = projection.google_rating;
    }
    if (projection.google_rating_count !== null) {
      row.google_rating_count = projection.google_rating_count;
    }
    if (projection.price_level !== null) {
      row.price_level = projection.price_level;
    }
    if (projection.types !== null) row.place_types = projection.types;
    const cuisine = humanizeCuisine(projection.primary_type);
    if (cuisine !== null) row.cuisine = cuisine;
    if (projection.website !== null) row.website = projection.website;
    if (projection.phone !== null) row.phone = projection.phone;
    if (projection.google_maps_uri !== null) {
      row.google_maps_uri = projection.google_maps_uri;
    }
    if (projection.opening_hours !== null) {
      row.hours = projection.opening_hours;
    }
    // The Details call itself is a successful sync even when optional
    // metadata is absent; this prevents repeatedly paying to confirm absence.
    row.places_synced_at = new Date().toISOString();

    if (targetId) {
      // Canonicalization and projection persistence are separate writes.
      // Re-read the version after canonicalization, then CAS the projection
      // so an intervening manual repair always wins.
      const canonicalId = await this.resolveCanonical(targetId);
      const current = await this.restaurantState(canonicalId);
      if (!current || current.merged_into !== null) {
        throw new Error("attested restaurant canonical target moved");
      }
      targetId = await this.updateAttestedRestaurant(current, row);
    } else {
      // Never use UPSERT for this projection: ON CONFLICT UPDATE has no
      // expected-version predicate and could overwrite a concurrent repair.
      // An existing external identity follows the same one-shot CAS path;
      // a concurrent insert loses safely and is retried by the caller.
      const { data: existing, error: existingError } = await this.supabase
        .from("restaurants")
        .select(
          "id,external_id,verification,merged_into,completeness_version,lat,lng,photo_url,photo_reference,photo_source,places_photo_attribution_html,created_by",
        )
        .eq("external_id", projection.place_id)
        .is("merged_into", null)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing?.id) {
        targetId = await this.updateAttestedRestaurant(
          existing as SharedRestaurantState,
          row,
        );
      } else {
        const { data, error } = await this.supabase
          .from("restaurants")
          .insert(row)
          .select("id")
          .single();
        if (error) throw error;
        targetId = data.id;
      }
    }

    let heroUrl: string | null = null;
    if (!projection.photo_reference) {
      const { error } = await this.supabase
        .from("restaurants")
        .update({ photo_source: "none" })
        .eq("id", targetId)
        .is("merged_into", null)
        .is("photo_url", null)
        .is("photo_source", null);
      if (error) throw error;
    } else if (persistHero) {
      // Coordinates and hero completion are independent. Re-read after the
      // coordinate CAS so lazy repair/backfill never claims or pays for media
      // when a user, Table, explicit `none`, or exact-reference Places hero
      // already completed the current canonical row. A new Places reference
      // keeps AC2's fresh-claim semantics. The SQL claim repeats this decision
      // under the row lock to serialize a hero that races this read.
      const heroCanonicalId = await this.resolveCanonical(targetId);
      const heroState = await this.restaurantState(heroCanonicalId);
      if (!heroState || heroState.merged_into !== null) {
        throw new Error("attested restaurant hero target moved");
      }
      targetId = heroState.id;
      if (
        hasCompleteRestaurantHero(heroState) &&
        (heroState.photo_source !== "places" ||
          heroState.photo_reference === projection.photo_reference)
      ) {
        heroUrl = heroState.photo_url;
      } else {
        heroUrl = await this.acquireMedia(
          ownerId,
          targetId,
          projection,
          claimant,
        );
      }
    }

    return { restaurant_id: targetId, projection, hero_url: heroUrl };
  }
}
