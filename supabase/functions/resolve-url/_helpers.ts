/**
 * resolve-url pure helpers — extracted for unit testing.
 *
 * These functions contain no I/O and no Deno.serve() — safe to import
 * in test files without triggering the HTTP server.
 *
 * TICKET-063 fix-pass-1.
 */

// ── Source detection (TICKET-079) ─────────────────────────────────────────────

/**
 * The source_type values resolve-url can emit for a URL/image share.
 * Mirrors the SourceType union in index.ts (kept in sync — this is the testable copy).
 */
export type SourceType =
  | "tiktok"
  | "google_maps"
  | "web"
  | "instagram"
  | "reddit"
  | "substack"
  | "screenshot"
  | "vision"
  | "video";

export function buildPlacesSearchBody(
  query: string,
  locality?: { city?: string | null; area?: string | null },
): Record<string, unknown> {
  return {
    query,
    limit: 3,
    ...(locality?.city ? { city: locality.city } : {}),
    ...(locality?.area ? { area: locality.area } : {}),
  };
}

export interface InlineDestinationResult {
  destination_kind: "wishlist" | "table" | "list" | "new_list";
  outcome: "pending" | "fulfilled" | "rejected";
  result: Record<string, unknown> | null;
}

/** Hydrate the synchronous v2 response after exhausted finalization routed its
 * non-table destinations to the minted ghost. */
export function exhaustedInlineRoute(
  destinations: InlineDestinationResult[],
): { ghost: boolean; wishlistId: string | null } {
  const fulfilled = destinations.filter((destination) =>
    destination.destination_kind !== "table" &&
    destination.outcome === "fulfilled"
  );
  const wishlist = fulfilled.find((destination) =>
    destination.destination_kind === "wishlist"
  );
  const wishlistId = wishlist?.result?.["wishlist_id"];
  return {
    ghost: fulfilled.length > 0,
    wishlistId: typeof wishlistId === "string" ? wishlistId : null,
  };
}

/**
 * Detect the source_type from a URL host.
 *
 * TICKET-079: reddit + substack are labeled distinctly (so copy can say
 * "from reddit" / "from substack" and pick the right noun) but are extracted via
 * the SAME generic web-title → Places path as 'web' (see isWebExtractionSource).
 *
 * Unrecognized hosts → 'web'.
 */
export function detectSourceTypeFromHost(host: string): SourceType {
  const h = host.toLowerCase();
  if (
    h === "tiktok.com" || h === "www.tiktok.com" || h === "vm.tiktok.com" ||
    h === "m.tiktok.com"
  ) {
    return "tiktok";
  }
  if (h === "maps.app.goo.gl" || h === "maps.google.com" || h === "goo.gl") {
    return "google_maps";
  }
  if (h === "instagram.com" || h === "www.instagram.com") {
    return "instagram";
  }
  if (
    h === "reddit.com" || h === "www.reddit.com" || h === "redd.it" ||
    h.endsWith(".reddit.com")
  ) {
    return "reddit";
  }
  if (h === "substack.com" || h.endsWith(".substack.com")) {
    return "substack";
  }
  return "web";
}

/**
 * TICKET-079: reddit/substack are labeled distinctly but extracted exactly like a
 * generic web page (unfurl <title> → text extraction → Places). Anywhere the
 * pipeline forks on "is this the web path?", use this instead of `=== 'web'`.
 *
 * This guarantees reddit/substack never mislabel as video and never 500 — they
 * degrade to manual search like any noisy-title web page if extraction is poor.
 */
export function isWebExtractionSource(s: SourceType): boolean {
  return s === "web" || s === "reddit" || s === "substack";
}

/**
 * Returns true when an external_id value represents an unresolved ghost
 * candidate (null, empty string, or the legacy 'ghost_pending' sentinel).
 * The minted ghost external_id ('ghost_<user>_<nonce>') is NOT a sentinel
 * and returns false.
 */
export function isGhostExternalId(id: string | null | undefined): boolean {
  return !id || id === "ghost_pending" || id === "";
}

export interface V2SaveSpotIdentityInput {
  client_nonce: string;
  restaurant_id?: string | null;
  external_id?: string | null;
  resolution_id?: string | null;
}

export interface V2RestaurantExternalIdentity {
  id: string;
  external_id: string | null;
}

export interface V2CompletenessItemIdentity {
  item_nonce: string;
  restaurant_id: string | null;
  external_id: string | null;
  resolution_id: string | null | undefined;
}

function v2ProviderExternalId(
  externalId: string | null | undefined,
): string | null {
  if (!externalId || isGhostExternalId(externalId)) return null;
  if (externalId.startsWith("ghost_") || externalId.startsWith("merged_")) {
    return null;
  }
  return externalId;
}

export function v2RestaurantIdsNeedingExternalId(
  spots: readonly V2SaveSpotIdentityInput[],
): string[] {
  const restaurantIds = new Set<string>();
  for (const spot of spots) {
    if (
      spot.restaurant_id && v2ProviderExternalId(spot.external_id) === null
    ) {
      restaurantIds.add(spot.restaurant_id);
    }
  }
  return [...restaurantIds];
}

export function buildV2CompletenessItemIdentities(
  spots: readonly V2SaveSpotIdentityInput[],
  restaurantRows: readonly V2RestaurantExternalIdentity[],
): V2CompletenessItemIdentity[] {
  const externalIdByRestaurantId = new Map<string, string>();
  for (const row of restaurantRows) {
    const externalId = v2ProviderExternalId(row.external_id);
    if (externalId) externalIdByRestaurantId.set(row.id, externalId);
  }

  return spots.map((spot) => {
    const suppliedExternalId = v2ProviderExternalId(spot.external_id);
    return {
      item_nonce: spot.client_nonce,
      restaurant_id: spot.restaurant_id ?? null,
      external_id: suppliedExternalId ??
        (spot.restaurant_id
          ? externalIdByRestaurantId.get(spot.restaurant_id) ?? null
          : null),
      resolution_id: spot.resolution_id,
    };
  });
}

/**
 * Builds the stable ghost external_id for a (user, nonce) pair.
 * Pattern mirrors the SQL in fn_save_import_spot:
 *   'ghost_' || p_user_id::text || '_' || p_client_nonce::text
 *
 * NOTE: The SQL expression in migration 20260610000300_fix_save_import_spot.sql is
 * AUTHORITATIVE. This TypeScript mirror must stay in sync with that SQL. If the SQL
 * pattern changes, update this function to match.
 */
export function buildGhostExternalId(
  userId: string,
  clientNonce: string,
): string {
  return `ghost_${userId}_${clientNonce}`;
}

/**
 * Returns the set of table_ids the user is NOT authorized to write to.
 * The memberRows must be queried with member_id = user_id (TICKET-034 doctrine).
 */
export function filterUnauthorizedTableIds(
  tableIds: string[],
  memberRows: { table_id: string }[],
): Set<string> {
  const authorized = new Set(memberRows.map((r) => r.table_id));
  const unauthorized = new Set<string>();
  for (const tid of tableIds) {
    if (!authorized.has(tid)) unauthorized.add(tid);
  }
  return unauthorized;
}

/**
 * TICKET-077: is this spot pinnable for a LIVE handoff?
 *
 * A handoff pin may only target a restaurant_id that is in the share's CURRENT
 * live spot set (read server-side via loadLiveSpots). The client cannot smuggle a
 * restaurant_id the owner has since removed, or one belonging to a different
 * share. Live spots always carry a verified restaurant_id, so a null/unknown id
 * is non-live → not pinnable → NOT_IN_SHARE.
 *
 * `liveRestaurantIds === null` means there is NO handoff gate (a normal import);
 * every spot is pinnable. This helper is only consulted on the handoff path.
 */
export function isSpotPinnable(
  restaurantId: string | null | undefined,
  liveRestaurantIds: Set<string> | null,
): boolean {
  if (liveRestaurantIds === null) return true; // no handoff gate
  if (!restaurantId) return false; // live spots always carry a real id
  return liveRestaurantIds.has(restaurantId);
}

/**
 * ROUND-3 FIX (Codex review): map external_id → restaurant_id for VERIFIED
 * rows only. Unverified rows must NOT be mapped: handing the client a
 * restaurant_id makes it drop external_id, which skips the save-time verified
 * upsert and strands the row unverified forever. Unmapped candidates flow the
 * external_id save path, whose ON CONFLICT (external_id) upsert promotes the
 * same row to verified with full Places metadata.
 */
export function mapVerifiedRestaurantIds(
  rows: Array<
    { id: string; external_id: string | null; verification?: string | null }
  >,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.external_id && row.verification === "verified") {
      map.set(row.external_id, row.id);
    }
  }
  return map;
}

// ── TICKET-195: import-only Places venue-type backstop ───────────────────────

/**
 * Google Places types accepted at the import candidate resolve seam.
 *
 * This allowlist deliberately lives in resolve-url (not places-search): search-tab
 * results and ghost upserts must keep their existing broad Places behaviour. A
 * candidate is accepted when the TOP text-search result intersects this list.
 */
export const IMPORT_PLACE_TYPE_ALLOWLIST = [
  "restaurant",
  "bar",
  "cafe",
  "bakery",
  "farmers_market",
  "market",
  "food_court",
  "meal_takeaway",
  "meal_delivery",
  "night_club",
  "food",
] as const;

const IMPORT_PLACE_TYPE_SET = new Set<string>(IMPORT_PLACE_TYPE_ALLOWLIST);

export interface ImportPlaceTypeCandidate {
  categories?: unknown;
}

export interface ImportPlaceSearchResult<T> {
  candidates: T[];
  /** True only when a top result existed but failed the venue-type allowlist. */
  typeRejected: boolean;
  /** Exact rejected identity, retained only for guarded verified-record reuse. */
  rejectedCandidate?: T;
}

/** True when a Places result carries at least one allowed food/drink type. */
export function hasAllowedImportPlaceType(categories: unknown): boolean {
  if (!Array.isArray(categories)) return false;
  return categories.some(
    (category) =>
      typeof category === "string" &&
      IMPORT_PLACE_TYPE_SET.has(category.trim().toLowerCase()),
  );
}

/**
 * Run an import-only Places text search and enforce the top-result type gate.
 *
 * The search dependency is injected so Deno tests never call the network. If the
 * top result is not a food/drink venue, the WHOLE candidate search is rejected —
 * we intentionally do not promote a lower-ranked result. An empty search is an
 * ordinary no-match (ghost-capable), not a type rejection.
 */
export async function resolveImportPlaceSearch<
  T extends ImportPlaceTypeCandidate,
>(
  search: () => T[] | Promise<T[]>,
): Promise<ImportPlaceSearchResult<T>> {
  const candidates = await search();
  const top = candidates[0];
  if (!top) return { candidates, typeRejected: false };
  if (!hasAllowedImportPlaceType(top.categories)) {
    return { candidates: [], typeRejected: true, rejectedCandidate: top };
  }
  return { candidates, typeRejected: false };
}

/**
 * Should the resolver fall back to a name-only ghost candidate?
 *
 * The invariant, learned the hard way on 2026-09-04: a venue-type rejection must
 * NEVER change this answer. The allowlist above exists to stop a bad MATCH — it
 * is not a licence to drop the spot. When it was also a drop, a posada/inn (no
 * `lodging` in the allowlist) produced an empty 200 with no ghost and no
 * provenance row, and the import silently disappeared.
 *
 * The ghost is always built from the extracted name/city, never from the
 * rejected Places result, so emitting one cannot bind the spot to a wrong venue.
 */
export function shouldEmitGhostCandidate(input: {
  /** How many candidates actually resolved to a Place. */
  resolvedCount: number;
  /** The model's extracted name — a ghost is meaningless without it. */
  extractedName: string | null | undefined;
  /**
   * Present ONLY to prove it is not consulted. Kept in the signature so a
   * future edit that reintroduces the drop has to delete an asserted argument
   * rather than quietly re-add `&& typeRejectedCount === 0`.
   */
  typeRejectedCount?: number;
}): boolean {
  return input.resolvedCount === 0 &&
    typeof input.extractedName === "string" &&
    input.extractedName.trim().length > 0;
}

/** Keep trusted extracted copy when Places rejects only the venue type. */
export function keepTypeRejectedAsGhost(
  confidence: string | null | undefined,
): boolean {
  return confidence === "high" || confidence === "exact";
}

/**
 * Compatibility guard for save_spots.
 *
 * New large-import clients understand the top-level `type_rejected` result flag
 * and omit the row before save. Older clients drop unknown top-level fields but
 * preserve `place` verbatim, so resolve_spots also carries
 * `place.type_rejected=true`. The server recognizes both forms and refuses the
 * row before any restaurant upsert / wishlist RPC.
 */
export function isTypeRejectedSaveSpot(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const spot = value as Record<string, unknown>;
  if (spot["type_rejected"] === true) return true;
  const place = spot["place"];
  return !!place &&
    typeof place === "object" &&
    !Array.isArray(place) &&
    (place as Record<string, unknown>)["type_rejected"] === true;
}

// ── TICKET-152: resolve_spots + pin_wishlist decision helpers ─────────────────
// These are the *decision* helpers only (pure, testable). The network-touching
// resolve core (staged → resolveCandidateToPlace in parallel → similarity gate)
// stays a shared function in index.ts — it cannot live here (no I/O in _helpers).

/** One item of a resolve_spots request, after validation + normalization. */
export interface ResolveSpotItem {
  name: string;
  address: string | null;
  client_nonce: string;
}

export type ImportResolutionDecision =
  | "matched"
  | "no_result"
  | "name_reject"
  | "locality_reject"
  | "ambiguous"
  | "transient"
  | "unattempted_budget";

const NON_MATCH_RESOLUTION_DECISIONS = new Set<ImportResolutionDecision>([
  "no_result",
  "name_reject",
  "locality_reject",
  "ambiguous",
  "transient",
  "unattempted_budget",
]);

/**
 * Convert one server-produced candidate into the immutable provenance shape.
 * A real external id is always authoritative `matched` evidence. Without one,
 * preserve the resolver's explicit reject/defer reason instead of collapsing
 * every outcome to `no_result`.
 */
export function resolutionDecisionForCandidate(value: unknown): {
  decision: ImportResolutionDecision;
  matchedExternalId: string | null;
} {
  const row = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const restaurant =
    row["restaurant"] && typeof row["restaurant"] === "object" &&
      !Array.isArray(row["restaurant"])
      ? row["restaurant"] as Record<string, unknown>
      : {};
  const externalId = [
    row["external_id"],
    row["google_place_id"],
    restaurant["external_id"],
    restaurant["id"],
  ].find((entry) => typeof entry === "string" && entry.trim() !== "");
  if (typeof externalId === "string") {
    return { decision: "matched", matchedExternalId: externalId.trim() };
  }

  const explicit = row["resolution_decision"];
  return {
    decision: typeof explicit === "string" &&
        NON_MATCH_RESOLUTION_DECISIONS.has(explicit as ImportResolutionDecision)
      ? explicit as ImportResolutionDecision
      : "no_result",
    matchedExternalId: null,
  };
}

/**
 * Recover a server-recorded Place id that a failed Details branch attempted.
 * It is a retry hint only: it deliberately does not occupy matched_external_id,
 * and internal ghost/tombstone identifiers are never eligible provider ids.
 */
export function attemptedExternalIdFromResolutionEvidence(
  value: unknown,
): string | null {
  const evidence = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const candidateValue = evidence?.["candidate"];
  const candidate = candidateValue && typeof candidateValue === "object" &&
      !Array.isArray(candidateValue)
    ? candidateValue as Record<string, unknown>
    : null;
  const attempted = candidate?.["attempted_external_id"];
  if (typeof attempted !== "string" || attempted.trim() === "") return null;
  const normalized = attempted.trim();
  if (
    normalized === "ghost_pending" ||
    normalized.startsWith("ghost_") ||
    normalized.startsWith("merged_")
  ) return null;
  return normalized;
}

/** Only an explicit v2 stamp opts resolve_spots into queueable failure rows. */
export function isV2ResolveSpotsProtocol(value: unknown): boolean {
  return value === "v2";
}

/**
 * Map a non-success places-search response without treating every HTTP 429 as
 * the same condition. `BUDGET_DEFERRED` is the shared SKU/freeze gate and does
 * not consume a completeness attempt; the interactive request throttle (also
 * 429) and all provider/network failures are ordinary retryable transients.
 */
export function placesFailureDecision(
  status: number,
  payload: unknown,
): "transient" | "unattempted_budget" {
  const body = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  const error = body?.["error"];
  const errorRecord =
    error && typeof error === "object" && !Array.isArray(error)
      ? error as Record<string, unknown>
      : null;
  return status === 429 && errorRecord?.["code"] === "BUDGET_DEFERRED"
    ? "unattempted_budget"
    : "transient";
}

/** Fail-closed import bucket mapping without mislabeling DB failure as exhaustion. */
export function resolveSpotsRateGate(
  error: unknown,
  row: unknown,
): "allowed" | "transient" | "unattempted_budget" {
  if (error) return "transient";
  if (!row || typeof row !== "object" || Array.isArray(row)) return "transient";
  return (row as Record<string, unknown>)["allowed"] === true
    ? "allowed"
    : "unattempted_budget";
}

/** One bound non-match row per item lets v2 persist and queue typed failures. */
export function buildResolveSpotDecisionResult(
  item: ResolveSpotItem,
  candidateId: string,
  decision: Exclude<ImportResolutionDecision, "matched">,
) {
  return {
    client_nonce: item.client_nonce,
    candidate_id: candidateId,
    restaurant_id: null,
    external_id: null,
    restaurant_name: item.name,
    restaurant_city: null,
    place: {
      id: "",
      name: item.name,
      formattedAddress: item.address,
      city: null,
      external_id: null,
      location: { address: item.address ?? undefined },
    },
    confidence: "low" as const,
    ghost: true,
    resolution_decision: decision,
  };
}

/** One zero-spend row per item lets v2 persist and queue during a freeze. */
export function buildUnattemptedResolveSpotResult(
  item: ResolveSpotItem,
  candidateId: string,
) {
  return buildResolveSpotDecisionResult(
    item,
    candidateId,
    "unattempted_budget",
  );
}

export type ResolveSpotsValidation =
  | { ok: true; items: ResolveSpotItem[] }
  | { ok: false; message: string };

/**
 * Validate + normalize a resolve_spots request body (TICKET-152).
 *
 * resolve_spots is a paid-Places amplifier, so the arg gates are strict and MUST
 * run FIRST — before the rate check and any Places call (L3). A malformed request
 * then 400s deterministically (the empty-items smoke relies on this) and never
 * burns an import_spots token.
 *
 * Gates, in order:
 *   1. import_nonce is a non-empty string (the job's importNonce — shape gate).
 *   2. items is an array of length 1..20 (hard cap === save_spots' per-request cap).
 *   3. every item carries a non-empty string name AND client_nonce — client_nonce
 *      is the deterministic echo-join key the client maps result→item by.
 * address is coerced to string | null (the full address rides into the Places query).
 */
export function validateResolveSpotsArgs(
  importNonce: unknown,
  items: unknown,
): ResolveSpotsValidation {
  if (typeof importNonce !== "string" || importNonce.trim().length === 0) {
    return { ok: false, message: "import_nonce is required" };
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, message: "items[] must contain 1–20 entries" };
  }
  if (items.length > 20) {
    return { ok: false, message: "items[] exceeds the 20-item cap" };
  }
  const normalized: ResolveSpotItem[] = [];
  for (const raw of items) {
    const item = (raw && typeof raw === "object" && !Array.isArray(raw))
      ? raw as Record<string, unknown>
      : null;
    const name = item && typeof item["name"] === "string"
      ? item["name"].trim()
      : "";
    const clientNonce = item && typeof item["client_nonce"] === "string"
      ? item["client_nonce"].trim()
      : "";
    if (!name || !clientNonce) {
      return { ok: false, message: "each item requires name and client_nonce" };
    }
    const address = item && typeof item["address"] === "string" &&
        item["address"].trim().length > 0
      ? item["address"].trim()
      : null;
    normalized.push({ name, address, client_nonce: clientNonce });
  }
  return { ok: true, items: normalized };
}

/**
 * Effective `pin_wishlist` for save_spots (TICKET-152). Default TRUE — only an
 * explicit boolean `false` disables the personal-wishlist pin (list-only import).
 * Anything else (absent, non-boolean) → true, so every existing caller that omits
 * the field keeps today's wishlist-pinning behavior byte-for-byte.
 */
export function normalizePinWishlist(raw: unknown): boolean {
  return raw === false ? false : true;
}

/**
 * The save path a pin_wishlist=false (list-only) spot takes (TICKET-152 M1):
 *   'existing' — a restaurant_id is already in hand (FIX#4 upsert / client-sent) → 'saved'.
 *   'verified' — a real external_id but no restaurant_id yet → upsert verified → 'saved'.
 *   'ghost'    — no external_id at all → mint a DETERMINISTIC unverified ghost row
 *                (buildGhostExternalId, keyed on (user, client_nonce)) so a list-only
 *                job never silently drops a spot and the lazy verify-on-open repair
 *                still fires → 'ghost'. A resume re-upserts the SAME row (ON CONFLICT
 *                external_id), so no dup.
 */
export function listOnlySaveKind(
  resolvedRestaurantId: string | null | undefined,
  safeExternalId: string | null | undefined,
): "existing" | "verified" | "ghost" {
  if (resolvedRestaurantId) return "existing";
  if (safeExternalId) return "verified";
  return "ghost";
}

/**
 * Kill-switch gate (TICKET-152): when env RESOLVE_SPOTS_GHOST_ONLY holds a truthy
 * value, resolve_spots emits one `unattempted_budget` result per item with ZERO
 * Places calls — enough server provenance for v2 to durably enqueue the chunk.
 * by the founder (there is no automatic spend meter). '0' / 'false' / 'off' / '' → off.
 */
export function isGhostOnlyMode(envValue: string | null | undefined): boolean {
  if (!envValue) return false;
  const v = envValue.trim().toLowerCase();
  return v !== "" && v !== "0" && v !== "false" && v !== "off";
}

// ── TICKET-187: save_spots photo-field quarantine ─────────────────────────────

import type { RestaurantInput } from "../_shared/restaurant.ts";

/**
 * Full place payload forwarded by the client for metadata-complete upserts
 * (fix-pass-2 item 3). TICKET-187: photoReference / photoAttributionHtml are
 * DELIBERATELY absent — the server never reads client photo fields. The hero
 * photo is acquired server-side, post-response, by the DB-derived external_id
 * (acquireAndMirrorHeroPhotos), so a client cannot pair a foreign photo with a
 * restaurant row.
 */
export interface SaveSpotPlacePayload {
  external_id?: string | null;
  name?: string | null;
  location?: { address?: string; locality?: string; country?: string };
  latitude?: number | null;
  longitude?: number | null;
  googleRating?: number | null;
  googleRatingCount?: number | null;
  priceLevel?: number | null;
  cuisine?: string | null;
  // TICKET-081: optional restaurant-page metadata forwarded from the client.
  // hours carries weekdayDescriptions only — no openNow (stale once cached; the page
  // derives "today" by matching the weekday name, not array position).
  phone?: string | null;
  website?: string | null;
  googleMapsUri?: string | null;
  google_maps_uri?: string | null;
  hours?: { weekdayDescriptions: string[] } | null;
}

export interface V2CompletenessClientFactsSpot {
  candidate_id: string;
  restaurant_name?: string | null;
  restaurant_city?: string | null;
  area?: string | null;
  place?: SaveSpotPlacePayload | null;
}

/** The one save_spots → deferred-worker advisory-facts mapping. Keeping area
 * here prevents neighborhood evidence from disappearing between resolution
 * and a later completeness retry. */
export function buildV2CompletenessClientFacts(
  spot: V2CompletenessClientFactsSpot,
  options: {
    attemptedExternalId?: string | null;
    resolutionDecision?: string | null;
    source?: unknown;
    note?: string | null;
  },
): Record<string, unknown> {
  return {
    candidate_id: spot.candidate_id,
    name: spot.restaurant_name ?? spot.place?.name ?? null,
    city: spot.restaurant_city ?? spot.place?.location?.locality ?? null,
    area: spot.area ?? null,
    address: spot.place?.location?.address ?? null,
    attempted_external_id: options.attemptedExternalId ?? null,
    resolution_decision: options.resolutionDecision ?? null,
    source: options.source ?? null,
    note: options.note ?? null,
  };
}

/**
 * Build the verified-restaurant upsert input for a save_spots spot (TICKET-187).
 *
 * The ONE mapping both handleSaveSpots upsert sites (FIX#4 + the list-only
 * 'verified' branch) use — extracted so the deno test can assert the invariant
 * that closed the review finding: NO photo field (photoReference /
 * photoAttributionHtml) ever reaches upsertRestaurant from a client payload,
 * even a forged one. Zero Google calls happen on the save critical path; the
 * deferred acquireAndMirrorHeroPhotos job owns ALL photo work.
 */
export function buildVerifiedUpsertInput(
  externalId: string,
  spot: {
    restaurant_name?: string | null;
    restaurant_city?: string | null;
    place?: SaveSpotPlacePayload | null;
  },
): RestaurantInput {
  const p = spot.place;
  return {
    external_id: externalId,
    name: p?.name ?? spot.restaurant_name ?? "Unknown",
    location: {
      address: p?.location?.address ?? undefined,
      locality: p?.location?.locality ?? spot.restaurant_city ?? undefined,
      country: p?.location?.country ?? undefined,
    },
    latitude: p?.latitude ?? undefined,
    longitude: p?.longitude ?? undefined,
    googleRating: p?.googleRating ?? undefined,
    googleRatingCount: p?.googleRatingCount ?? undefined,
    priceLevel: p?.priceLevel ?? undefined,
    cuisine: p?.cuisine ?? undefined,
    // TICKET-081: forward metadata too when present (additive).
    phone: p?.phone ?? undefined,
    website: p?.website ?? undefined,
    googleMapsUri: p?.googleMapsUri ?? p?.google_maps_uri ?? undefined,
    hours: p?.hours ?? undefined,
    verification: "verified",
  };
}

/**
 * Collect the DEDUPLICATED successful restaurant_ids from a save_spots result
 * list — the exact input the deferred photo job receives (TICKET-187). Failed
 * spots and rows without a restaurant_id are excluded; ghost/list-only rows may
 * pass through (they carry an id) — the job's verification filter skips them
 * before any rate token. Works identically for the request-supplied-
 * restaurant_id branch: the id is still known from the result row.
 */
export function dedupeSuccessfulRestaurantIds(
  results: Array<{ status: string; restaurant_id?: string | null }>,
): string[] {
  const ids = new Set<string>();
  for (const r of results) {
    if (r.status !== "failed" && r.restaurant_id) ids.add(r.restaurant_id);
  }
  return [...ids];
}

// ── TICKET-195: save protocol classification + measurable legacy sunset ──

export interface SaveProtocolSpot {
  client_nonce?: string | null;
  resolution_id?: string | null;
}

export interface V2SaveProtocolBody {
  protocol_version?: unknown;
  protocol_generation?: unknown;
  destination_intent?: unknown;
  expected_destinations?: unknown;
}

export type ExpectedImportOwnerDecision = "allow" | "invalid" | "mismatch";

/**
 * Optional deployed-client-compatible owner fence. New durable-import clients
 * echo the manifest owner so an auth switch during an async resolve/save cannot
 * run the old manifest under the newly active JWT. Absence remains allowed for
 * installed clients; presence is strict and checked before paid or write work.
 */
export function expectedImportOwnerDecision(
  expectedOwnerId: unknown,
  authenticatedOwnerId: string,
): ExpectedImportOwnerDecision {
  if (expectedOwnerId === undefined) return "allow";
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof expectedOwnerId !== "string" || !uuid.test(expectedOwnerId)) {
    return "invalid";
  }
  return expectedOwnerId === authenticatedOwnerId ? "allow" : "mismatch";
}

/**
 * A single v2-only field opts the entire request into v2 validation. Keeping
 * this list explicit prevents a partially upgraded client from falling through
 * to the legacy response contract.
 */
export function isV2SaveProtocolRequest(
  body: V2SaveProtocolBody,
  spots: SaveProtocolSpot[] | undefined,
): boolean {
  return body.protocol_version === 2 ||
    Object.prototype.hasOwnProperty.call(body, "protocol_generation") ||
    Object.prototype.hasOwnProperty.call(body, "destination_intent") ||
    Object.prototype.hasOwnProperty.call(body, "expected_destinations") ||
    !!spots?.some((spot) =>
      Object.prototype.hasOwnProperty.call(spot, "resolution_id")
    );
}

/** Complete v2 shape validation shared by the live handler and unit tests. */
export function validateV2SaveProtocol(
  importNonce: unknown,
  spots: SaveProtocolSpot[] | undefined,
  body: V2SaveProtocolBody,
): string | null {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (body.protocol_version !== 2 || body.protocol_generation !== "v2") {
    return "protocol_version=2 and protocol_generation=v2 are required";
  }
  if (typeof importNonce !== "string" || !uuid.test(importNonce)) {
    return "import_nonce must be a UUID";
  }
  if (!Array.isArray(spots) || spots.length < 1 || spots.length > 20) {
    return "spots must contain 1..20 items";
  }
  if (
    spots.some((spot) =>
      !uuid.test(spot.client_nonce ?? "") ||
      typeof spot.resolution_id !== "string" || !uuid.test(spot.resolution_id)
    )
  ) {
    return "every v2 spot needs UUID client_nonce and resolution_id";
  }
  const expected = body.expected_destinations;
  if (
    !Number.isInteger(expected) || (expected as number) < 1 ||
    (expected as number) > 2000
  ) {
    return "expected_destinations must be an integer from 1..2000";
  }
  const destinations = body.destination_intent;
  if (
    !Array.isArray(destinations) || destinations.length < 1 ||
    destinations.length > 400
  ) {
    return "destination_intent must be a non-empty bounded array";
  }
  const itemNonces = new Set(spots.map((spot) => spot.client_nonce));
  for (const raw of destinations) {
    const destination = raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : null;
    if (
      !destination ||
      typeof destination.item_nonce !== "string" ||
      !uuid.test(destination.item_nonce) ||
      !itemNonces.has(destination.item_nonce) ||
      typeof destination.destination_nonce !== "string" ||
      !uuid.test(destination.destination_nonce) ||
      !["wishlist", "table", "list", "new_list"].includes(
        String(destination.destination_kind ?? ""),
      )
    ) {
      return "each destination must be bound to a submitted item with UUID nonces";
    }
  }
  return null;
}

export interface InlineCompletenessItem {
  id?: string;
  item_nonce?: string;
}

/**
 * Prepare the exact per-request inline claims after a v2 enqueue.
 *
 * The SQL response is scoped to submitted nonces, but this filter is retained
 * at the function boundary for rolling-deploy compatibility with an older RPC
 * that returned every item in the job. Each item gets a distinct claimant so
 * two items resolving to the same Place id cannot both re-enter the provider
 * single-flight under one shared claim owner.
 */
export function buildInlineCompletenessClaims<T extends InlineCompletenessItem>(
  enqueuedItems: readonly T[],
  submittedItemNonces: ReadonlySet<string>,
  nextClaimant: () => string = () => crypto.randomUUID(),
): Array<{ item: T; workerId: string }> {
  return enqueuedItems
    .filter((item) =>
      typeof item.id === "string" && item.id.length > 0 &&
      typeof item.item_nonce === "string" &&
      submittedItemNonces.has(item.item_nonce)
    )
    .map((item) => ({ item, workerId: nextClaimant() }));
}

export interface LegacySaveSunsetDecision {
  minimumBuild: number | null;
  observedBuild: number | null;
  belowFloor: boolean;
  reject: boolean;
}

/**
 * LEGACY_SAVE_MIN_BUILD is measurable even before enforcement. Deploys start in
 * warn mode; LEGACY_SAVE_ENFORCEMENT=reject is the later, explicit sunset lever.
 * Missing/invalid client metadata is conservatively build 0 once a floor exists.
 */
export function evaluateLegacySaveSunset(
  minimumBuildRaw: string | null | undefined,
  enforcementRaw: string | null | undefined,
  clientBuildRaw: unknown,
): LegacySaveSunsetDecision {
  const parsedMinimum = Number(minimumBuildRaw);
  const minimumBuild = Number.isSafeInteger(parsedMinimum) && parsedMinimum > 0
    ? parsedMinimum
    : null;
  const parsedObserved = typeof clientBuildRaw === "number"
    ? clientBuildRaw
    : typeof clientBuildRaw === "string" && clientBuildRaw.trim() !== ""
    ? Number(clientBuildRaw)
    : NaN;
  const observedBuild =
    Number.isSafeInteger(parsedObserved) && parsedObserved >= 0
      ? parsedObserved
      : null;
  const belowFloor = minimumBuild !== null &&
    (observedBuild ?? 0) < minimumBuild;
  return {
    minimumBuild,
    observedBuild,
    belowFloor,
    reject: belowFloor && enforcementRaw?.trim().toLowerCase() === "reject",
  };
}

// ── TICKET-209: caption authority + labeled video-text fusion ────────────────

import { HASHTAG_RE, MENTION_RE } from "../_shared/captionToNote.ts";
import { detectListMarker } from "../_shared/listicle.ts";
import { LISTICLE_CANDIDATE_CAP } from "../_shared/visionExtract.ts";

/** The caption section's own budget inside the fused window. */
export const CAPTION_SECTION_CAP = 3000;
/** Total fused-text window handed to the extractor (unchanged from TICKET-082). */
export const VIDEO_FUSION_CAP = 8000;

const VIDEO_TEXT_HEADER = "\n\n[video text]\n";

/**
 * Trailing hashtag/mention block, e.g. "…Casa Julián\n\n#sansebastian @topjaw".
 * Composed from captionToNote's canonical token patterns — never a second copy.
 * (Their `g` flag is dropped here: this regex is used with .replace on a fresh
 * instance, so no lastIndex state is shared.)
 */
const TRAILING_TAG_BLOCK_RE = new RegExp(
  `(?:\\s|${HASHTAG_RE.source}|${MENTION_RE.source})+$`,
);

/**
 * Drop the trailing hashtag/mention spam so the caption BUDGET is spent on
 * content. An enumerated listicle puts its venue names AFTER the preamble, so a
 * naive tail cut would remove the ground truth this whole ticket depends on.
 *
 * A caption that is ONLY tags keeps its raw text: hashtags/handles carry the
 * city signal Places needs ("#londonfood"), and dropping them entirely would
 * lose a channel today's bare join preserves.
 */
export function stripTrailingTagBlock(caption: string): string {
  const trimmed = caption.trim();
  const stripped = trimmed.replace(TRAILING_TAG_BLOCK_RE, "").trim();
  return stripped || trimmed;
}

export interface VideoFusion {
  fullText: string;
  /** True iff a NON-EMPTY [video text] section is actually painted. */
  hasVideoText: boolean;
}

/**
 * Fuse caption + on-device video text into ONE labeled document.
 *
 * ```
 * [caption]
 * <caption>
 *
 * [video text]
 * <extracted_text>
 * ```
 *
 * Budgeted PER SECTION, never join-then-slice: a huge caption used to evict the
 * entire OCR channel — the very channel the caption-authority rule needs to
 * split undelimited names. The [video text] header is emitted only when that
 * section is non-empty, so the prompt never references a section that isn't
 * painted and `hasVideoText` always agrees with what the model actually sees.
 *
 * Caption-free video still gets a channel label. Photo fusion keeps its
 * existing pre-labelled document and cache contract.
 */
export function buildVideoFusion(
  caption: string | null | undefined,
  extractedText: string | null | undefined,
  preservePhotoFusion = false,
): VideoFusion {
  // typeof guards, not `?? ""`: the caption arrives straight off an untrusted
  // JSON body, and a non-string used to be harmlessly dropped by filter(Boolean).
  const videoText = typeof extractedText === "string"
    ? extractedText.trim()
    : "";
  const rawCaption = typeof caption === "string" ? caption.trim() : "";
  const captionText = rawCaption
    ? stripTrailingTagBlock(rawCaption).slice(0, CAPTION_SECTION_CAP)
    : "";

  if (!captionText) {
    if (preservePhotoFusion) {
      const fullText = videoText.slice(0, VIDEO_FUSION_CAP);
      return { fullText, hasVideoText: fullText.length > 0 };
    }
    const header = "[video text]\n";
    const fullText = videoText
      ? header + preserveVideoTextEnding(videoText, VIDEO_FUSION_CAP - header.length)
      : "";
    return { fullText, hasVideoText: fullText.length > 0 };
  }

  const captionBlock = `[caption]\n${captionText}`;
  const remaining = VIDEO_FUSION_CAP - captionBlock.length -
    VIDEO_TEXT_HEADER.length;
  if (!videoText || remaining <= 0) {
    return { fullText: captionBlock, hasVideoText: false };
  }
  return {
    fullText: `${captionBlock}${VIDEO_TEXT_HEADER}${
      preservePhotoFusion
        ? videoText.slice(0, remaining)
        : preserveVideoTextEnding(videoText, remaining)
    }`,
    hasVideoText: true,
  };
}

/** Old clients send an unbounded mixed blob; never silently cut off its ending. */
export function preserveVideoTextEnding(text: string, cap: number): string {
  if (text.length <= cap) return text;
  const marker = "\n[... omitted text ...]\n";
  const head = Math.floor((cap - marker.length) / 2);
  return text.slice(0, head) + marker + text.slice(-(cap - marker.length - head));
}

/** Decode jitter must not invalidate otherwise identical extraction evidence. */
export function canonicalVideoCacheText(text: string): string {
  return text.replace(/^\[frame \d+(?:\.\d+)?s(; ending)?\]$/gm, "[frame$1]");
}

/**
 * Captions that legitimately feature MORE venues than their headline count —
 * "6 spots and 2 to avoid" must keep the warned tail the product deliberately
 * surfaces. Any of these markers disables the caption cap entirely.
 */
const CAP_EXEMPTION_RE =
  /\bbonus\b|\bplus\b|\+|honou?rable\s+mention|to\s+avoid|\bskip\b|and\s+\d+\s+(?:to\s+avoid|not)/i;

/**
 * The creator's OWN declared spot count, derived EXCLUSIVELY from the `caption`
 * body field. Returns null when no legitimate ceiling exists.
 *
 * TICKET-204 distinction: a photo slide count is a transport artifact and must
 * NEVER become a numeric ceiling. A caption count is different in kind — the
 * creator states how many venues the post features — so it IS a legitimate
 * ceiling. It is still refused when:
 *  - the count came from anywhere but the caption body field (OCR text that
 *    happens to read "TOP 10" is scene noise, and old clients send no caption);
 *  - photo context is present (photo mode overrides the caller cap inside
 *    visionExtract, so a caption cap would apply at dedupe only — incoherent);
 *  - the count is outside [2, 12] (1 is a teaser, >12 exceeds the shared cap);
 *  - the caption carries a bonus/exclusion marker.
 */
export function deriveCaptionCap(
  caption: string | null | undefined,
  hasPhotoContext: boolean,
): number | null {
  if (hasPhotoContext) return null;
  const text = typeof caption === "string" ? caption.trim() : "";
  if (!text) return null;
  if (CAP_EXEMPTION_RE.test(text)) return null;
  // Runs on the UNTRUNCATED caption body field — never the fused/budgeted text.
  const countRaw = detectListMarker(text).countRaw;
  if (countRaw === null || !Number.isInteger(countRaw)) return null;
  if (countRaw < 2 || countRaw > LISTICLE_CANDIDATE_CAP) return null;
  return Math.min(LISTICLE_CANDIDATE_CAP, countRaw);
}

/**
 * TICKET-209 A.1 — does this body belong to the video-text route?
 *
 * `extracted_text` alone routed before; a caption-only body (all Instagram
 * imports and every ASR-less TikTok, post-209) must route here too. But
 * `caption` is a first-class MODIFIER on three live routes that sit AFTER this
 * gate — the Instagram nudge, the vision/screenshot branch, and the URL
 * pipeline — so the caption arm requires that neither `url` nor `image_path`
 * was sent. The url/image predicates mirror the fall-through checks below the
 * gate EXACTLY, so no body that reaches those routes today is hijacked.
 */
export function routesToVideoText(
  body: Record<string, unknown> | null | undefined,
): boolean {
  const extractedText = typeof body?.extracted_text === "string"
    ? body.extracted_text.trim()
    : "";
  if (extractedText) return true;
  const caption = typeof body?.caption === "string" ? body.caption.trim() : "";
  if (!caption) return false;
  const hasUrl = typeof body?.url === "string" && !!body.url;
  const hasImage = typeof body?.image_path === "string";
  return !hasUrl && !hasImage;
}
