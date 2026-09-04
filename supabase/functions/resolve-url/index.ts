/**
 * resolve-url edge function — TICKET-053 + TICKET-060 + TICKET-063
 *
 * TICKET-063 pipeline (synchronous URL path):
 *   cache read → text-tier extract → vision-tier (conditional) → merge/dedupe/rank/cap-6
 *   → cache WRITE → per-candidate Places resolution (parallel ≤6) → wishlist dedupe → respond
 *
 * TICKET-063 save_spots action (ARCH-REVIEW-2 #1 — lives here, NOT in table-shares):
 *   POST { action: 'save_spots', candidates: [...], import_nonce, table_id? }
 *   Loops ticked spots (≤6), calls fn_save_import_spot per spot, returns per-spot status.
 *
 * Vision trigger (ARCH-REVIEW-2 #6):
 *   Run thumbnail vision when text-tier yields ZERO exact|high candidates,
 *   OR when a listicle marker is detected and text-tier count < min(list_count, 6).
 *   Hero path (single confident text candidate) never pays for vision.
 *
 * 8s budget (ARCH-REVIEW-2 #6):
 *   oEmbed ≤2.5s · text-LLM ≤2.5s · thumbnail fetch ≤1.5s · resize ≤0.5s
 *   · vision ≤2.5s · Places ≤2.5s (parallel Promise.all ≤6).
 *   After candidates exist, budget exhaustion → degrade gracefully (never hard-fail).
 *
 * Merge/dedupe/rank (ARCH-REVIEW-2 #7):
 *   pre-Places fuzzy key = normalize(name)+city (containment fold)
 *   post-Places canonical key = google_place_id ?? restaurant_id
 *   rank = (confidence desc, source-agreement desc, list-ordinal asc)
 *   text-tier wins on field conflict; vision fills nulls.
 *
 * candidate_id (ARCH-REVIEW-2 #10):
 *   sha256(content_hash + ':' + normalized_name + ':' + index).slice(0,16)
 *
 * ARCH-REVIEW-2 #11: resize failure → vision tier SKIPPED (raw bytes never sent).
 *
 * Backward compat: candidates[] shape + ordering preserved; candidates[0] = best.
 *   city_inferred + candidate_id are additive; old client ignores them.
 *
 * Previous paths unchanged:
 *   action=extract (async screenshot, internal-only)
 *   image_path (inline vision, handleVisionExtract)
 *   TikTok/Maps/web/IG/screenshot source types
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders } from "../_shared/cors.ts";
import { reportError } from "../_shared/report.ts";
import { emitImportDone } from "../_shared/notify.ts";
import { validateUrl } from "../_shared/urlValidation.ts";
import type { WishlistSourceTikTok } from "../_shared/wishlistSource.ts";
// TICKET-156: the single content-key authority — SAME normalizer the rail read
// (restaurant-history) and the backfill import, so capture/read/backfill agree.
import { contentKey } from "../_shared/videoUrlKey.ts";
import { captionToNote } from "../_shared/captionToNote.ts";
import {
  type ExtractedCandidate,
  extractFromText,
  extractFromTextMulti,
  extractFromVision,
  extractFromVisionMulti,
  type ExtractionContext,
  LISTICLE_CANDIDATE_CAP,
  type PhotoExtractionContext,
  validPhotoSlideCount,
} from "../_shared/visionExtract.ts";
import {
  HASH_VERSION,
  hashImage,
  hashTextSource,
} from "../_shared/contentHash.ts";
// TICKET-086c: dedupe/merge/rank + the Places similarity gate extracted to
// _shared so the stage implicated in the "7 spots → 1" regressions is
// unit-tested in pre-commit (candidateDedupe.test.ts).
import {
  classifyInteractiveCandidate,
  dedupeAndRank,
  normalizeName,
  type StagedCandidate,
} from "../_shared/candidateDedupe.ts";
import { detectListMarker } from "../_shared/listicle.ts";
// Maps shared-list import: a maps.app.goo.gl list share resolves to a JS-only
// page; the spots come from the page's own entitylist/getlist preload fetch.
// expandMapsShare + parsers live in mapsList.ts (importable without serve(),
// same doctrine as _helpers.ts).
import {
  expandMapsShare,
  MAPS_LIST_CAP,
  mapsItemsToStaged,
  type ParsedMapsList,
  parsePlaceFromMapsUrl,
} from "./mapsList.ts";
import { resizeImageToLimit } from "../_shared/imageResize.ts";
// TICKET-187: acquireAndMirrorHeroPhotos is the deferred (post-response) hero-
// photo job save_spots schedules via EdgeRuntime.waitUntil — the save critical
// path carries ZERO Google calls and never reads client photo fields.
import {
  acquireAndMirrorHeroPhotos,
  upsertRestaurant,
} from "../_shared/restaurant.ts";
import {
  DefaultCompletenessBackend,
  settleClaimedCompletenessItem,
} from "../restaurant-completeness/_worker.ts";
import { getCompletenessJobStatus } from "../restaurant-completeness/_status.ts";
import { CompletenessProvider } from "../_shared/completenessProvider.ts";
import { hasCompleteRestaurantFacts } from "../_shared/completeness.ts";
// TICKET-077: the handoff pin path re-reads the share LIVE (single source of truth,
// shared with handoff/share-page) so it pins against the CURRENT spot set, never a
// stale client-sent list.
import { loadHandoffWriteAuthorization } from "../handoff/snapshot.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Constant-time byte comparison — prevents timing oracle on the internal secret. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

// ── Deadline helper (ARCH-REVIEW-2 #6) ───────────────────────────────────────

class Deadline {
  private readonly deadline: number;
  private readonly controller: AbortController;

  constructor(budgetMs: number) {
    this.deadline = Date.now() + budgetMs;
    this.controller = new AbortController();
    // Auto-abort when budget expires
    const remaining = this.remaining();
    if (remaining <= 0) {
      this.controller.abort();
    } else {
      setTimeout(() => this.controller.abort(), remaining);
    }
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  remaining(): number {
    return Math.max(0, this.deadline - Date.now());
  }

  /** Returns an AbortSignal that fires after `ms` or when the global budget expires. */
  stageSignal(ms: number): AbortSignal {
    const stageController = new AbortController();
    const stageTimeout = setTimeout(
      () => stageController.abort(),
      Math.min(ms, this.remaining()),
    );
    this.signal.addEventListener("abort", () => {
      clearTimeout(stageTimeout);
      stageController.abort();
    }, { once: true });
    return stageController.signal;
  }

  get aborted(): boolean {
    return this.signal.aborted;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

// TICKET-079: reddit/substack are recognized as their own source_type so the client
// can label them ("from reddit" / "from substack") and pick the right copy noun.
// They still flow the SAME unfurl→extraction path as 'web' (see isWebExtractionSource).
// SourceType + detection helpers live in _helpers.ts (testable without serve()).
type Confidence = "exact" | "high" | "low";

/** Shape identical to places-search output */
interface PlacesPayload {
  id: string;
  name: string | null;
  formattedAddress: string | null;
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  categories: string[];
  cuisine: string | null;
  googleRating: number | null;
  googleRatingCount: number | null;
  priceLevel: number | null;
  photoReference: string | null;
  website: string | null;
  link: string | null;
  /** null for unresolved ghost candidates (no confirmed Places id). */
  external_id: string | null;
  location?: {
    address?: string;
    locality?: string;
    country?: string;
  };
}

interface ResolvedCandidate {
  candidate_id: string;
  restaurant: PlacesPayload;
  confidence: Confidence;
  /** null for unresolved ghost candidates (no confirmed Places id). */
  google_place_id: string | null;
  restaurant_id: string | null;
  already_wishlisted: boolean;
  /** TICKET-063: true when city was inferred from context, not stated. */
  city_inferred: boolean;
  /** Structured extracted neighborhood/district for manual-match search. */
  area?: string | null;
  /** TICKET-086c: 'warned' = anti-recommendation ("most overrated") — the
   * client never auto-saves these; review shows them unticked. */
  stance?: "recommended" | "warned" | "neutral" | null;
  /** Server-owned provenance; additive so installed clients ignore it. */
  resolution_decision?: ImportResolutionDecision;
  /** Failed Details target; retry hint only, never matched authority. */
  attempted_external_id?: string | null;
}

interface ResolveUrlResponse {
  source_type: SourceType;
  best_query: string | null;
  note_prefill: string;
  candidates: ResolvedCandidate[];
  partial_source: Omit<WishlistSourceTikTok, "type" | "url"> | null;
  /** True when the URL is Instagram-walled; client shows screenshot nudge. */
  ig_nudge?: boolean;
  /** TICKET-063: advertised list count from the listicle heuristic (≤6). */
  list_count?: number | null;
  /** TICKET-195: import candidates dropped by the Places venue-type backstop. */
  type_rejected?: number;
  /**
   * TICKET-164: the UNCLAMPED, caption-first advertised list count for the import
   * fast-path count gate (`list_count` is clamped to ≤6 and must not be reused as
   * a denominator). Additive — an old client ignores it; a new client treating
   * its ABSENCE as "old server" (→ escalate) is why the server ships first. null =
   * no marker found → the count gate passes. Only handleVideoText emits it.
   */
  list_count_raw?: number | null;
  /**
   * TICKET-209 follow-up: the caption-derived candidate ceiling that governed
   * this extraction (null = no cap fired; the shared 12 applied). Additive +
   * diagnostic only — old clients ignore it, callers must never gate on it.
   * Only handleVideoText emits it.
   */
  caption_cap?: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(
  code: string,
  message: string,
  status: number,
  details?: unknown,
) {
  return jsonResponse({ error: { code, message, details } }, status);
}

/** Check if a URL is Instagram (login-walled) */
function isInstagramUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === "instagram.com" || host === "www.instagram.com";
}

/**
 * Detect source type from a URL.
 *
 * Host-pattern detection (incl. TICKET-079 reddit/substack) lives in the pure,
 * testable detectSourceTypeFromHost helper. This wrapper layers on the one
 * path-dependent case the host helper can't see: www.google.com/maps/… (a maps
 * link whose host is the bare google.com).
 */
function detectSourceType(url: URL): SourceType {
  const host = url.hostname.toLowerCase();
  if (
    (host === "www.google.com" || host === "google.com") &&
    url.pathname.startsWith("/maps")
  ) {
    return "google_maps";
  }
  return detectSourceTypeFromHost(host);
}

// ── Candidate dedup + merge + rank ────────────────────────────────────────────
// normalizeName / dedupeAndRank / mergeExtracted / namesOverlap live in
// _shared/candidateDedupe.ts (TICKET-086c) — imported above.

// ── candidate_id (ARCH-REVIEW-2 #10) ─────────────────────────────────────────

async function computeCandidateId(
  contentHash: string,
  normalizedName: string,
  index: number,
): Promise<string> {
  const raw = `${contentHash}:${normalizedName}:${index}`;
  const bytes = new TextEncoder().encode(raw);
  const buf = await crypto.subtle.digest(
    "SHA-256",
    bytes.buffer as ArrayBuffer,
  );
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 16);
}

// ── Extraction cache (array shape + HASH_VERSION filter) ─────────────────────

/**
 * Read extraction cache.
 * TICKET-063: filters by HASH_VERSION=2 and reads candidates as an array.
 * Old v1 single-object rows are a guaranteed miss (HASH_VERSION mismatch).
 */
async function readExtractionCache(
  supabase: any,
  contentHash: string,
): Promise<ExtractedCandidate[] | null> {
  const { data } = await supabase
    .from("extraction_cache")
    .select("extracted, hash_version")
    .eq("content_hash", contentHash)
    .eq("hash_version", HASH_VERSION)
    .maybeSingle();

  if (!data?.extracted) return null;

  const e = data.extracted as Record<string, unknown>;

  // TICKET-063: expect array shape { candidates: [...] }
  if (Array.isArray(e["candidates"])) {
    const arr = e["candidates"] as unknown[];
    const parsed = arr.map((item: unknown): ExtractedCandidate => {
      const p = (item && typeof item === "object" && !Array.isArray(item))
        ? item as Record<string, unknown>
        : {};
      const conf = p["confidence"];
      const stanceRaw = p["stance"];
      return {
        name: typeof p["name"] === "string" ? p["name"] || null : null,
        city: typeof p["city"] === "string" ? p["city"] || null : null,
        city_inferred: p["city_inferred"] === true,
        // TICKET-086c: area + stance survive the cache round-trip (they
        // were silently dropped here, degrading Places queries and
        // losing the overrated flag on every cache hit).
        area: typeof p["area"] === "string" ? p["area"] || null : null,
        cuisine: typeof p["cuisine"] === "string" ? p["cuisine"] || null : null,
        address: typeof p["address"] === "string" ? p["address"] || null : null,
        booking_url: typeof p["booking_url"] === "string"
          ? p["booking_url"] || null
          : null,
        hours: typeof p["hours"] === "string" ? p["hours"] || null : null,
        confidence: (["high", "low", "exact"].includes(conf as string)
          ? conf
          : "low") as any,
        stance: (stanceRaw === "recommended" || stanceRaw === "warned" ||
            stanceRaw === "neutral")
          ? stanceRaw
          : undefined,
        google_place_id: typeof p["google_place_id"] === "string"
          ? p["google_place_id"] || null
          : null,
      };
    });
    return parsed.filter((c) => c.name !== null);
  }

  // Old single-object shape (shouldn't happen after HASH_VERSION filter, but guard anyway)
  return null;
}

/**
 * Write extraction result array to cache.
 * Stores candidates array inside { candidates: [...] } ONLY content-derived fields.
 * Never stores restaurant_id, already_wishlisted, client_nonce, notes, or resume state.
 */
async function writeExtractionCache(
  supabase: any,
  contentHash: string,
  sourceUrl: string | null,
  candidates: ExtractedCandidate[],
  modelId: string,
  // TICKET-086c: the fused perception text that produced this extraction.
  // Persisted so a bad real-world import becomes an eval fixture in one
  // query (scripts/eval/extraction) instead of being unreproducible.
  rawText: string | null = null,
): Promise<void> {
  await supabase
    .from("extraction_cache")
    .upsert({
      content_hash: contentHash,
      hash_version: HASH_VERSION,
      source_url: sourceUrl,
      extracted: {
        candidates: candidates.map((c) => ({
          name: c.name,
          city: c.city,
          city_inferred: c.city_inferred,
          area: c.area ?? null,
          cuisine: c.cuisine,
          address: c.address,
          booking_url: c.booking_url,
          hours: c.hours,
          confidence: c.confidence,
          stance: c.stance ?? null,
          google_place_id: c.google_place_id,
        })),
      },
      model: modelId,
      raw_text: rawText,
    }, { onConflict: "content_hash" });
}

// ── TikTok oEmbed ─────────────────────────────────────────────────────────────

async function fetchTikTokOEmbed(
  url: string,
  signal: AbortSignal,
): Promise<
  {
    title: string;
    author_unique_id?: string;
    author_name?: string;
    thumbnail_url?: string;
    embed_product_id?: string;
  } | null
> {
  const endpoint = `https://www.tiktok.com/oembed?url=${
    encodeURIComponent(url)
  }`;
  let res: Response;
  try {
    res = await fetch(endpoint, { signal });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw { code: "UPSTREAM_UNAVAILABLE", retryable: true };
  }

  if (res.status === 400 || res.status === 404) return null;
  if (res.status === 429) {
    throw { code: "UPSTREAM_RATE_LIMITED", retryable: true };
  }
  if (res.status >= 500) {
    throw { code: "UPSTREAM_UNAVAILABLE", retryable: true };
  }
  if (!res.ok) return null;

  let json: any;
  try {
    json = await res.json();
  } catch {
    return null;
  }
  if (!json || typeof json.title !== "string") return null;

  return {
    title: json.title,
    author_unique_id: json.author_unique_id ?? undefined,
    author_name: json.author_name ?? undefined,
    thumbnail_url: json.thumbnail_url ?? undefined,
    embed_product_id: json.embed_product_id ?? undefined,
  };
}

// ── Thumbnail fetch + resize (TICKET-063) ─────────────────────────────────────

/**
 * Fetch a thumbnail image URL, validate content-type + size, and downscale.
 * Returns base64 + mimeType on success; null on any failure (fail-soft).
 *
 * ARCH-REVIEW-2 #11: if resize fails, return null — caller MUST skip vision.
 * Raw bytes are never sent.
 *
 * Constraints:
 *   - content-type must start with "image/"
 *   - raw size cap 8MB
 *   - single attempt (no retry)
 */
async function fetchAndResizeThumbnail(
  thumbnailUrl: string,
  signal: AbortSignal,
): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const res = await fetch(thumbnailUrl, { signal });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;

    const blob = await res.blob();
    if (blob.size > 8 * 1024 * 1024) return null; // 8MB cap

    const bytes = new Uint8Array(await blob.arrayBuffer());

    // ARCH-REVIEW-2 #11: resize failure → return null (vision tier skipped)
    const resized = await resizeImageToLimit(bytes, signal);
    if (!resized) return null;

    const base64 = btoa(String.fromCharCode(...resized.data));
    return { base64, mimeType: resized.mimeType };
  } catch {
    return null;
  }
}

// ── Web unfurl ────────────────────────────────────────────────────────────────
// parsePlaceFromMapsUrl / cleanMapsTitle / expandMapsShare live in mapsList.ts
// (importable without serve() — the live share-expansion path is E2E-testable).

async function unfurlWebTitle(
  url: string,
  signal: AbortSignal,
): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal,
      headers: {
        "User-Agent": "Napkin/1.0 (link-resolver; +https://napkin.app)",
      },
    });
    if (!res.ok) return null;
    const text = await res.text().catch(() => null);
    if (!text) return null;
    const titleMatch = text.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
    return titleMatch ? titleMatch[1].trim() : null;
  } catch {
    return null;
  }
}

// ── Places search ─────────────────────────────────────────────────────────────

type CandidateUpstreamFailure = "rate_limited" | "budget_deferred" | "provider";

interface CandidateLookupError {
  code: string;
  retryable: boolean;
  resolutionDecision: "transient" | "unattempted_budget";
  upstreamFailure: CandidateUpstreamFailure;
}

async function throwPlacesLookupFailure(res: Response): Promise<never> {
  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // An opaque error body is still a provider transient, never budget proof.
  }
  const resolutionDecision = placesFailureDecision(res.status, payload);
  const upstreamFailure: CandidateUpstreamFailure =
    resolutionDecision === "unattempted_budget"
      ? "budget_deferred"
      : res.status === 429
      ? "rate_limited"
      : "provider";
  const code = upstreamFailure === "budget_deferred"
    ? "PLACES_BUDGET_DEFERRED"
    : upstreamFailure === "rate_limited"
    ? "PLACES_RATE_LIMITED"
    : res.status >= 500
    ? "UPSTREAM_UNAVAILABLE"
    : "PLACES_AUTH_FAIL";
  throw {
    code,
    retryable: res.status === 429 || res.status >= 500,
    resolutionDecision,
    upstreamFailure,
  } satisfies CandidateLookupError;
}

async function callPlacesSearch(
  query: string,
  authHeader: string,
  supabaseUrl: string,
  supabaseAnonKey: string,
  signal: AbortSignal,
  internalSecret?: string,
  internalOwnerId?: string,
  locality?: { city?: string | null; area?: string | null },
): Promise<PlacesPayload[]> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: authHeader,
    apikey: supabaseAnonKey,
    "x-candidate-consumer": "resolve-url",
  };
  if (internalSecret) {
    headers["x-internal-secret"] = internalSecret;
    if (internalOwnerId) headers["x-owner-id"] = internalOwnerId;
  }

  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/places-search`, {
      method: "POST",
      headers,
      body: JSON.stringify(buildPlacesSearchBody(query, locality)),
      signal,
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw {
      code: "UPSTREAM_UNAVAILABLE",
      retryable: true,
      resolutionDecision: "transient",
      upstreamFailure: "provider",
    } satisfies CandidateLookupError;
  }

  if (!res.ok) await throwPlacesLookupFailure(res);

  let body: any;
  try {
    body = await res.json();
  } catch {
    throw {
      code: "UPSTREAM_UNAVAILABLE",
      retryable: true,
      resolutionDecision: "transient",
      upstreamFailure: "provider",
    } satisfies CandidateLookupError;
  }

  const candidates = body?.data?.candidates ?? body?.data ?? body?.candidates ??
    [];
  return Array.isArray(candidates) ? candidates : [];
}

/**
 * Import-candidate-only wrapper around places-search's broad text search.
 * Search tab and ghost-upsert callers keep using callPlacesSearch directly.
 */
function callImportPlacesSearch(
  query: string,
  authHeader: string,
  supabaseUrl: string,
  supabaseAnonKey: string,
  signal: AbortSignal,
  internalSecret?: string,
  internalOwnerId?: string,
  locality?: { city?: string | null; area?: string | null },
): Promise<{ candidates: PlacesPayload[]; typeRejected: boolean }> {
  return resolveImportPlaceSearch(() =>
    callPlacesSearch(
      query,
      authHeader,
      supabaseUrl,
      supabaseAnonKey,
      signal,
      internalSecret,
      internalOwnerId,
      locality,
    )
  );
}

// ── Exported decision helpers (TICKET-063 fix-pass-1, testable) ──────────────
// Implementations live in _helpers.ts (no serve() call) so test files can
// import them without triggering the HTTP server.
import {
  attemptedExternalIdFromResolutionEvidence,
  buildGhostExternalId,
  buildInlineCompletenessClaims,
  buildPlacesSearchBody,
  buildResolveSpotDecisionResult,
  buildV2CompletenessClientFacts,
  buildV2CompletenessItemIdentities,
  // TICKET-187: photo-field quarantine — the one upsert-input mapping (no
  // photo fields, ever) + the deferred-job id collection.
  buildVerifiedUpsertInput,
  // TICKET-209: caption-authority fusion + cap derivation + route gate.
  buildVideoFusion,
  dedupeSuccessfulRestaurantIds,
  deriveCaptionCap,
  detectSourceTypeFromHost,
  evaluateLegacySaveSunset,
  exhaustedInlineRoute,
  expectedImportOwnerDecision,
  filterUnauthorizedTableIds,
  type ImportResolutionDecision,
  isGhostExternalId,
  isGhostOnlyMode,
  isSpotPinnable,
  isTypeRejectedSaveSpot,
  isV2ResolveSpotsProtocol,
  isV2SaveProtocolRequest,
  isWebExtractionSource,
  listOnlySaveKind,
  mapVerifiedRestaurantIds,
  normalizePinWishlist,
  placesFailureDecision,
  resolutionDecisionForCandidate,
  resolveImportPlaceSearch,
  resolveSpotsRateGate,
  routesToVideoText,
  shouldEmitGhostCandidate,
  type SaveSpotPlacePayload,
  type SourceType,
  v2RestaurantIdsNeedingExternalId,
  // TICKET-152: resolve_spots + pin_wishlist decision helpers.
  validateResolveSpotsArgs,
  validateV2SaveProtocol,
} from "./_helpers.ts";
export { buildGhostExternalId, filterUnauthorizedTableIds, isGhostExternalId };

/**
 * Bind every resolver-produced candidate to append-only, server-owned evidence.
 * The client receives only the generated id and cannot supply or mutate the
 * evidence later. Save/enqueue validates the id against the authenticated user.
 */
async function attachImportResolutionIds(
  supabase: any,
  userId: string,
  response: Response,
  importNonce: unknown,
  path: string,
): Promise<Response> {
  if (response.status < 200 || response.status >= 300) return response;

  let payload: any;
  try {
    payload = await response.clone().json();
  } catch {
    return response;
  }
  const rows: any[] = Array.isArray(payload?.data?.candidates)
    ? payload.data.candidates
    : Array.isArray(payload?.data?.results)
    ? payload.data.results
    : [];
  if (rows.length === 0) return response;

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const boundImportNonce =
    typeof importNonce === "string" && uuidPattern.test(importNonce)
      ? importNonce
      : null;

  await Promise.all(rows.map(async (row) => {
    const provenance = resolutionDecisionForCandidate(row);
    const { data, error } = await supabase
      .from("import_resolutions")
      .insert({
        user_id: userId,
        import_nonce: boundImportNonce,
        candidate_evidence: { path, candidate: row },
        decision: provenance.decision,
        matched_external_id: provenance.matchedExternalId,
        scores: null,
      })
      .select("resolution_id")
      .single();
    if (error || !data?.resolution_id) {
      throw error ?? new Error("resolution provenance insert returned no id");
    }
    row.resolution_id = data.resolution_id;
  }));

  return new Response(JSON.stringify(payload), {
    status: response.status,
    headers: response.headers,
  });
}

// ── Places Details by place_id (FIX #5: never text-search for place_id candidates) ──

/**
 * Call places-search with a `place_id` (Details endpoint) instead of a text query.
 * ARCH-REVIEW-2 #8: on DB miss for a google_place_id, call Details — NEVER text search.
 * Throws a typed lookup failure so provenance can distinguish budget deferral
 * from an interactive throttle/provider transient.
 */
async function callPlacesDetails(
  placeId: string,
  authHeader: string,
  supabaseUrl: string,
  supabaseAnonKey: string,
  signal: AbortSignal,
  internalSecret?: string,
  internalOwnerId?: string,
): Promise<PlacesPayload | null> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: authHeader,
    apikey: supabaseAnonKey,
    "x-candidate-consumer": "resolve-url",
  };
  if (internalSecret) {
    headers["x-internal-secret"] = internalSecret;
    if (internalOwnerId) headers["x-owner-id"] = internalOwnerId;
  }
  let res: Response;
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/places-search`, {
      method: "POST",
      headers,
      body: JSON.stringify({ place_id: placeId }),
      signal,
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw {
      code: "UPSTREAM_UNAVAILABLE",
      retryable: true,
      resolutionDecision: "transient",
      upstreamFailure: "provider",
    } satisfies CandidateLookupError;
  }
  if (!res.ok) await throwPlacesLookupFailure(res);
  let body: any;
  try {
    body = await res.json();
  } catch {
    throw {
      code: "UPSTREAM_UNAVAILABLE",
      retryable: true,
      resolutionDecision: "transient",
      upstreamFailure: "provider",
    } satisfies CandidateLookupError;
  }
  const candidates = body?.data?.candidates ?? body?.data ?? body?.candidates ??
    [];
  const arr = Array.isArray(candidates) ? candidates : [];
  return arr[0] ?? null;
}

// ── Per-candidate Places resolution (ARCH-REVIEW-2 #8) ───────────────────────

/**
 * Resolve a single extracted candidate to a Places result.
 * - If candidate has google_place_id: DB lookup by external_id first,
 *   then Places Details by id on miss (NEVER text-search for a place_id candidate).
 * - Otherwise: text search by name+city.
 * - Never-block: ordinary failures return { place: null, typeRejected: false }.
 * - A text-search top result outside the food/drink allowlist is distinguishable
 *   so callers can DROP it instead of turning it into a ghost.
 */
interface CandidatePlaceResolution {
  place: PlacesPayload | null;
  typeRejected: boolean;
  decision: ImportResolutionDecision;
  upstreamFailure: CandidateUpstreamFailure | null;
}

function failedCandidateResolution(error: unknown): CandidatePlaceResolution {
  const value = error && typeof error === "object"
    ? error as Partial<CandidateLookupError>
    : {};
  return {
    place: null,
    typeRejected: false,
    decision: value.resolutionDecision === "unattempted_budget"
      ? "unattempted_budget"
      : "transient",
    upstreamFailure: value.upstreamFailure === "rate_limited" ||
        value.upstreamFailure === "budget_deferred"
      ? value.upstreamFailure
      : "provider",
  };
}

async function resolveCandidateToPlace(
  supabase: any,
  candidate: ExtractedCandidate,
  authHeader: string,
  supabaseUrl: string,
  supabaseAnonKey: string,
  signal: AbortSignal,
  internalSecret?: string,
  internalOwnerId?: string,
): Promise<CandidatePlaceResolution> {
  if (!candidate.name) {
    return {
      place: null,
      typeRejected: false,
      decision: "name_reject",
      upstreamFailure: null,
    };
  }

  // ARCH-REVIEW-2 #8: if google_place_id → DB lookup first, else Places Details.
  // FIX #5: NEVER fall through to text search for a place_id candidate.
  if (candidate.google_place_id) {
    const { data: existing } = await supabase
      .from("restaurants")
      .select("id, external_id, name, city, address, verification")
      .eq("external_id", candidate.google_place_id)
      .maybeSingle();
    if (existing) {
      if (existing.verification === "verified") {
        // Verified row: return cached DB payload immediately.
        return {
          place: buildPlacesPayloadFromDb(existing, candidate),
          typeRejected: false,
          decision: "matched",
          upstreamFailure: null,
        };
      }
      // Stale unverified row — attempt a Places Details refresh.
      // On success, the candidate flows the external_id save path which upserts
      // the row to verified with full metadata (item 1, fix-pass-2).
      // A failed refresh must not turn the stale unverified id into matched
      // authority; preserve the typed retryable outcome instead.
      try {
        const place = await callPlacesDetails(
          candidate.google_place_id,
          authHeader,
          supabaseUrl,
          supabaseAnonKey,
          signal,
          internalSecret,
          internalOwnerId,
        );
        return {
          place,
          typeRejected: false,
          decision: place?.id ? "matched" : "no_result",
          upstreamFailure: null,
        };
      } catch (error) {
        return failedCandidateResolution(error);
      }
    }
    // DB miss → Places Details by id (binding #8 / fix #5: never text-search here).
    try {
      const place = await callPlacesDetails(
        candidate.google_place_id,
        authHeader,
        supabaseUrl,
        supabaseAnonKey,
        signal,
        internalSecret,
        internalOwnerId,
      );
      return {
        place,
        typeRejected: false,
        decision: place?.id ? "matched" : "no_result",
        upstreamFailure: null,
      };
    } catch (error) {
      return failedCandidateResolution(error);
    }
  }

  // No google_place_id → search by the bare name with structured locality.
  // `city` outranks device/home bias in places-search; `area` still refines
  // same-name venues and ASR-denoised names without double-welding locality.
  const query = candidate.name;
  try {
    const { candidates: results, typeRejected } = await callImportPlacesSearch(
      query,
      authHeader,
      supabaseUrl,
      supabaseAnonKey,
      signal,
      internalSecret,
      internalOwnerId,
      {
        city: candidate.city,
        area: (candidate as { area?: string | null }).area ?? null,
      },
    );
    if (typeRejected) {
      return {
        place: null,
        typeRejected: true,
        decision: "no_result",
        upstreamFailure: null,
      };
    }
    const top = results[0] ?? null;
    // TICKET-086c similarity gate: a garbled name text-search returns SOME
    // popular place; accepting it blind masquerades as "resolved" and the
    // real spot silently leaves the funnel (post-Places dedupe can then
    // collapse two distinct spots onto the same wrong place). No plausible
    // name overlap → ghost instead; the review UI already handles ghosts.
    const decision = top?.id
      ? classifyInteractiveCandidate(candidate, top)
      : "no_result";
    return {
      place: decision === "matched" ? top : null,
      typeRejected: false,
      decision,
      upstreamFailure: null,
    };
  } catch (error) {
    return failedCandidateResolution(error);
  }
}

function buildPlacesPayloadFromDb(
  row: any,
  fallback: ExtractedCandidate,
): PlacesPayload {
  return {
    id: row.external_id ?? "",
    name: row.name ?? fallback.name,
    formattedAddress: row.address ?? fallback.address,
    city: row.city ?? fallback.city,
    country: null,
    latitude: null,
    longitude: null,
    categories: [],
    cuisine: fallback.cuisine,
    googleRating: null,
    googleRatingCount: null,
    priceLevel: null,
    photoReference: null,
    website: null,
    link: null,
    external_id: row.external_id ?? "",
    location: {
      address: row.address ?? undefined,
      locality: row.city ?? undefined,
    },
  };
}

// ── Shared staged→Places resolution core (TICKET-152) ─────────────────────────
//
// The network-touching core the maps-list branch of handleUrlResolve and the new
// resolve_spots action both run: resolve each staged candidate to a Place in
// parallel (the TICKET-086c similarity gate lives inside resolveCandidateToPlace).
// It MUST stay here, not in the pure `_helpers.ts` — it does I/O (only the decision
// helpers are pure-testable). Returns places and type-rejection flags index-aligned
// with `staged`, plus typed decisions. `throttled` preserves the installed-client
// resolve_spots 503 contract; explicit v2 requests keep the per-item transient or
// unattempted-budget rows so the queue can retry them with bound provenance.
async function resolveStagedPlacesParallel(
  supabase: any,
  staged: StagedCandidate[],
  authHeader: string,
  supabaseUrl: string,
  supabaseAnonKey: string,
  placeSignal: AbortSignal,
): Promise<{
  places: (PlacesPayload | null)[];
  typeRejectedByIndex: boolean[];
  typeRejectedCount: number;
  decisionsByIndex: ImportResolutionDecision[];
  throttled: boolean;
}> {
  const resolutions = await Promise.all(
    staged.map(async (s) => {
      if (placeSignal.aborted) {
        return failedCandidateResolution(
          new DOMException("aborted", "AbortError"),
        );
      }
      try {
        return await resolveCandidateToPlace(
          supabase,
          s.extracted,
          authHeader,
          supabaseUrl,
          supabaseAnonKey,
          placeSignal,
        );
      } catch (error) {
        return failedCandidateResolution(error);
      }
    }),
  );
  const typeRejectedByIndex = resolutions.map((r) => r.typeRejected);
  return {
    places: resolutions.map((r) => r.place),
    typeRejectedByIndex,
    typeRejectedCount: typeRejectedByIndex.filter(Boolean).length,
    decisionsByIndex: resolutions.map((r) => r.decision),
    throttled: resolutions.some((r) =>
      r.upstreamFailure === "rate_limited" ||
      r.upstreamFailure === "budget_deferred"
    ),
  };
}

// ── Vision helpers (original single-candidate paths, unchanged) ───────────────

/**
 * Read extraction_cache for a given content_hash (B2: service-role only).
 * Legacy single-candidate version for handleAsyncExtract.
 * TICKET-063: now delegates to readExtractionCache and returns [0].
 */
async function readExtractionCacheSingle(
  supabase: any,
  contentHash: string,
): Promise<ExtractedCandidate | null> {
  const arr = await readExtractionCache(supabase, contentHash);
  return arr?.[0] ?? null;
}

async function writeExtractionCacheSingle(
  supabase: any,
  contentHash: string,
  sourceUrl: string | null,
  extracted: ExtractedCandidate,
  modelId: string,
): Promise<void> {
  await writeExtractionCache(
    supabase,
    contentHash,
    sourceUrl,
    [extracted],
    modelId,
  );
}

/**
 * Handle inline vision extraction (not async — used when image_path is in body).
 * TICKET-063: upgrades to multi-candidate extractor; returns first as before.
 */
async function handleVisionExtract(
  supabase: any,
  user: { id: string },
  imagePath: string,
  caption: string | null,
  supabaseUrl: string,
  supabaseAnonKey: string,
  authHeader: string,
): Promise<Response> {
  const { data: imageData, error: imgError } = await supabase.storage
    .from("import-uploads")
    .download(imagePath);

  if (imgError || !imageData) {
    return errorResponse(
      "IMAGE_NOT_FOUND",
      "Could not read the uploaded image",
      404,
    );
  }

  const imageBytes = new Uint8Array(await (imageData as Blob).arrayBuffer());
  const imageHash = await hashImage(imageBytes);

  let extractedArr = await readExtractionCache(supabase, imageHash);
  const modelId = Deno.env.get("EXTRACTION_MODEL") ??
    "claude-haiku-4-5-20251001";

  if (!extractedArr) {
    const imageBase64 = btoa(String.fromCharCode(...imageBytes));
    extractedArr = await extractFromVisionMulti(
      imageBase64,
      "image/jpeg",
      caption ?? undefined,
    );
    if (extractedArr.length > 0) {
      await writeExtractionCache(
        supabase,
        imageHash,
        null,
        extractedArr,
        modelId,
      ).catch(() => null);
    }
  }

  const extracted = extractedArr?.[0] ?? null;

  if (!extracted || !extracted.name) {
    return jsonResponse({
      data: {
        source_type: "screenshot",
        best_query: null,
        note_prefill: caption ? captionToNote(caption) : "",
        candidates: [],
        partial_source: null,
        extracted_confidence: "low",
        needs_confirm: true,
        type_rejected: 0,
      },
    });
  }

  const abortController = new AbortController();
  setTimeout(() => abortController.abort(), 8000);

  const query = extracted.name;
  let placeCandidates: PlacesPayload[] = [];
  let typeRejectedCount = 0;
  try {
    const search = await callImportPlacesSearch(
      query,
      authHeader,
      supabaseUrl,
      supabaseAnonKey,
      abortController.signal,
      undefined,
      undefined,
      { city: extracted.city, area: extracted.area ?? null },
    );
    placeCandidates = search.candidates;
    typeRejectedCount = search.typeRejected ? 1 : 0;
  } catch { /* zero-candidate */ }

  const googlePlaceIds = placeCandidates.map((p) => p.id).filter(Boolean);
  const { data: restaurantRows } = googlePlaceIds.length > 0
    ? await supabase.from("restaurants").select("id, external_id")
      .in("external_id", googlePlaceIds)
      .eq("verification", "verified")
    : { data: [] };

  const placeIdToRestaurantId = new Map<string, string>();
  for (const row of (restaurantRows ?? [])) {
    if (row.external_id) placeIdToRestaurantId.set(row.external_id, row.id);
  }

  const knownRestaurantIds = [...placeIdToRestaurantId.values()];
  const wishlistedSet = new Set<string>();
  if (knownRestaurantIds.length > 0) {
    const { data: wishlistRows } = await supabase
      .from("wishlist_items")
      .select("restaurant_id")
      .eq("user_id", user.id)
      .in("restaurant_id", knownRestaurantIds);
    for (const row of (wishlistRows ?? [])) {
      if (row.restaurant_id) wishlistedSet.add(row.restaurant_id);
    }
  }

  const topN = placeCandidates.slice(0, 3);
  const candidates: ResolvedCandidate[] = await Promise.all(
    topN.map(async (place, idx): Promise<ResolvedCandidate> => {
      const restaurantId = placeIdToRestaurantId.get(place.id) ?? null;
      const alreadyWishlisted = restaurantId
        ? wishlistedSet.has(restaurantId)
        : false;
      const confidence: Confidence =
        idx === 0 && extracted!.confidence === "high" ? "high" : "low";
      const restaurant: PlacesPayload = {
        ...place,
        external_id: place.id,
        location: {
          address: place.formattedAddress ?? undefined,
          locality: place.city ?? undefined,
          country: place.country ?? undefined,
        },
      };
      const candidateId = await computeCandidateId(
        imageHash,
        normalizeName(place.name),
        idx,
      );
      return {
        candidate_id: candidateId,
        restaurant,
        confidence,
        google_place_id: place.id,
        restaurant_id: restaurantId,
        already_wishlisted: alreadyWishlisted,
        city_inferred: extracted!.city_inferred,
        area: extracted!.area ?? null,
      };
    }),
  );

  // A type rejection must NOT swallow the spot. Until 2026-09-04 this guard
  // carried `&& typeRejectedCount === 0`, so a candidate whose top Places result
  // failed the food/drink allowlist (IMPORT_PLACE_TYPE_ALLOWLIST — no lodging,
  // so every posada / inn / hotel restaurant) returned `candidates: []`. That is
  // an empty 200: no ghost, no import_resolutions row, nothing for the sheet to
  // show, and the client's zero-candidate branch then deletes the manifest with
  // only a toast. Founder repro: "Posada Real Torre Berrueza" extracted at
  // high confidence with a real city and still vanished four times.
  //
  // The ghost is built from `extracted` — the model's name/city — NEVER from the
  // rejected Places result, so promoting it cannot bind the spot to the wrong
  // venue. The allowlist keeps doing its real job (blocking a bad MATCH); it is
  // no longer also a silent drop. `type_rejected` still rides the response so
  // the client can label why this one came through unresolved.
  if (
    shouldEmitGhostCandidate({
      resolvedCount: candidates.length,
      extractedName: extracted.name,
      typeRejectedCount,
    })
  ) {
    // FIX #2: ghost candidates use google_place_id=null and external_id=null.
    // The sentinel 'ghost_pending' caused cross-user row collapse in fn_save_import_spot.
    // The RPC mints a stable 'ghost_{user}_{nonce}' external_id at save time.
    const candidateId = await computeCandidateId(
      imageHash,
      normalizeName(extracted.name),
      0,
    );
    const ghostCandidate: ResolvedCandidate = {
      candidate_id: candidateId,
      restaurant: {
        id: "",
        name: extracted.name,
        formattedAddress: extracted.address,
        city: extracted.city,
        country: null,
        latitude: null,
        longitude: null,
        categories: [],
        cuisine: extracted.cuisine,
        googleRating: null,
        googleRatingCount: null,
        priceLevel: null,
        photoReference: null,
        website: null,
        link: null,
        external_id: null,
        location: {
          address: extracted.address ?? undefined,
          locality: extracted.city ?? undefined,
        },
      },
      confidence: extracted.confidence === "high" ? "high" : "low",
      google_place_id: extracted.google_place_id ?? null,
      restaurant_id: null,
      already_wishlisted: false,
      city_inferred: extracted.city_inferred,
      area: extracted.area ?? null,
    };
    candidates.push(ghostCandidate);
  }

  return jsonResponse({
    data: {
      source_type: "screenshot" as SourceType,
      best_query: query || null,
      note_prefill: caption ? captionToNote(caption) : "",
      candidates,
      partial_source: null,
      extracted_confidence: extracted.confidence,
      type_rejected: typeRejectedCount,
    },
  });
}

/**
 * Async extract action — unchanged from TICKET-060 (internal-only).
 * TICKET-063: upgrades to multi extractor internally; takes [0] for single-candidate path.
 */
async function handleAsyncExtract(
  supabase: any,
  isInternalCall: boolean,
  jobOwnerId: string,
  jobId: string,
  supabaseUrl: string,
  supabaseAnonKey: string,
  authHeader: string,
  internalSecret?: string,
): Promise<Response> {
  const { data: job } = await supabase
    .from("import_jobs")
    .select("*")
    .eq("job_id", jobId)
    .maybeSingle();

  if (!job) return errorResponse("JOB_NOT_FOUND", "Import job not found", 404);

  if (!isInternalCall && job.user_id !== jobOwnerId) {
    await supabase.rpc("fn_complete_import_job", {
      p_job_id: jobId,
      p_status: "needs_confirm",
      p_restaurant_id: null,
    }).catch(() => null);
    return errorResponse("FORBIDDEN", "Not your import job", 403);
  }

  if (job.status !== "pending") {
    return jsonResponse({ data: { job_id: jobId, status: job.status } });
  }

  // Fail-CLOSED (TICKET-091): a missing/errored rate row denies — a DB blip
  // must not uncork unlimited Anthropic + Places spend on the async path.
  const { data: rateRows } = await supabase.rpc(
    "check_and_increment_rate_limit",
    {
      p_user_id: jobOwnerId,
      p_bucket_key: "resolve_content",
      p_max: 20,
      p_window_seconds: 3600,
    },
  ).catch(() => ({ data: null }));
  const rateRow = rateRows?.[0];
  if (!rateRow || !rateRow.allowed) {
    await supabase.rpc("fn_complete_import_job", {
      p_job_id: jobId,
      p_status: "needs_confirm",
      p_restaurant_id: null,
    }).catch(() => null);
    return jsonResponse({
      data: { job_id: jobId, status: "needs_confirm", reason: "rate_limited" },
    });
  }

  const source = job.source as Record<string, unknown> | null;
  const imagePath = (source?.["upload_path"] as string) ?? null;
  const captionText = (source?.["caption"] as string) ?? null;
  const sourceUrl = (source?.["source_url"] as string) ?? null;

  if (imagePath) {
    const firstSegment = imagePath.split("/")[0];
    if (firstSegment !== jobOwnerId) {
      await supabase.rpc("fn_complete_import_job", {
        p_job_id: jobId,
        p_status: "needs_confirm",
        p_restaurant_id: null,
      }).catch(() => null);
      return errorResponse(
        "FORBIDDEN",
        "image_path does not belong to job owner",
        403,
      );
    }
  }

  // Single-candidate for async path (unchanged behavior)
  let extracted: ExtractedCandidate | null = null;
  const modelId = Deno.env.get("EXTRACTION_MODEL") ??
    "claude-haiku-4-5-20251001";

  let realImageHash: string | null = null;
  let imageBytes: Uint8Array | null = null;

  if (imagePath) {
    const { data: imageData } = await supabase.storage
      .from("import-uploads")
      .download(imagePath);
    if (imageData) {
      imageBytes = new Uint8Array(await (imageData as Blob).arrayBuffer());
      realImageHash = await hashImage(imageBytes);
      if (realImageHash !== job.content_hash) {
        await supabase
          .from("import_jobs")
          .update({ content_hash: realImageHash })
          .eq("job_id", jobId)
          .catch(() => null);
        job.content_hash = realImageHash;
      }
    }
  }

  const cacheKey = realImageHash ?? job.content_hash;
  if (cacheKey) {
    extracted = await readExtractionCacheSingle(supabase, cacheKey);
  }

  if (!extracted) {
    if (imageBytes) {
      const imageBase64 = btoa(String.fromCharCode(...imageBytes));
      extracted = await extractFromVision(
        imageBase64,
        "image/jpeg",
        captionText ?? undefined,
      );
    } else if (captionText || sourceUrl) {
      const textInput = [captionText, sourceUrl].filter(Boolean).join("\n");
      extracted = await extractFromText(textInput);
    }

    if (extracted && cacheKey) {
      await writeExtractionCacheSingle(
        supabase,
        cacheKey,
        sourceUrl,
        extracted,
        modelId,
      ).catch(() => null);
    }
  }

  if (!extracted) {
    await supabase.rpc("fn_complete_import_job", {
      p_job_id: jobId,
      p_status: "needs_confirm",
      p_restaurant_id: null,
    }).catch(() => null);
    return jsonResponse({ data: { job_id: jobId, status: "needs_confirm" } });
  }

  const abortController = new AbortController();
  setTimeout(() => abortController.abort(), 8000);

  let restaurantId: string | null = null;
  let finalStatus: string = "needs_confirm";

  if (extracted.name) {
    try {
      const result = await upsertRestaurantFromExtracted(
        supabase,
        extracted,
        job.user_id,
        supabaseUrl,
        supabaseAnonKey,
        authHeader,
        abortController.signal,
        internalSecret,
      );
      restaurantId = result.restaurantId;
      finalStatus = result.confidence === "low" || !restaurantId
        ? "needs_confirm"
        : "resolved";
    } catch (e: any) {
      console.error(
        "upsertRestaurantFromExtracted error (→ needs_confirm):",
        e?.code ?? e,
      );
      finalStatus = "needs_confirm";
      restaurantId = null;
    }
  }

  const { error: completeErr } = await supabase.rpc("fn_complete_import_job", {
    p_job_id: jobId,
    p_status: finalStatus,
    p_restaurant_id: restaurantId ?? null,
  });

  if (completeErr) {
    console.error("fn_complete_import_job error:", completeErr);
  }

  if (finalStatus === "resolved" && restaurantId) {
    try {
      const { data: shareRows } = await supabase
        .from("table_shares")
        .select("table_id")
        .eq("job_id", jobId);

      const tableIds = [
        ...new Set(
          (shareRows ?? []).map((s: { table_id: string }) => s.table_id).filter(
            Boolean,
          ),
        ),
      ];

      const { data: memberRows } = await supabase
        .from("table_members")
        .select("table_id")
        .eq("member_id", job.user_id);

      const allTableIds = [
        ...new Set([
          ...tableIds,
          ...(memberRows ?? []).map((m: { table_id: string }) => m.table_id),
        ]),
      ];

      for (const tableId of allTableIds) {
        await supabase.rpc("fn_detect_and_surface_float", {
          p_table_id: tableId,
          p_restaurant_id: restaurantId,
          p_window_days: 14,
          p_threshold: 3,
        }).catch(() => null);
      }
    } catch {
      // Float detection must never block
    }
  }

  return jsonResponse({
    data: {
      job_id: jobId,
      status: finalStatus,
      restaurant_id: restaurantId,
      extracted: {
        name: extracted.name,
        city: extracted.city,
        cuisine: extracted.cuisine,
        confidence: extracted.confidence,
      },
    },
  });
}

// ── upsertRestaurantFromExtracted (unchanged from TICKET-060) ─────────────────

async function upsertRestaurantFromExtracted(
  supabase: any,
  extracted: ExtractedCandidate,
  userId: string,
  supabaseUrl: string,
  supabaseAnonKey: string,
  authHeader: string,
  abortSignal: AbortSignal,
  internalSecret?: string,
): Promise<
  { restaurantId: string | null; confidence: ExtractedCandidate["confidence"] }
> {
  if (!extracted.name) return { restaurantId: null, confidence: "low" };

  if (extracted.confidence === "low" && !extracted.google_place_id) {
    const { data: ghost } = await supabase
      .from("restaurants")
      .insert({
        external_id: `ghost_${userId}_${Date.now()}`,
        name: extracted.name,
        city: extracted.city,
        address: extracted.address,
        verification: "unverified",
        created_by: userId,
      })
      .select("id")
      .single();
    return { restaurantId: ghost?.id ?? null, confidence: "low" };
  }

  // Mandatory delta 6: use the SAME branch authority as every interactive
  // resolver. A verified DB hit is free; an id miss is Details; no id is Text
  // Search. The old code text-searched even when Google already supplied an id.
  const resolution = await resolveCandidateToPlace(
    supabase,
    extracted,
    authHeader,
    supabaseUrl,
    supabaseAnonKey,
    abortSignal,
    internalSecret,
    userId,
  );
  if (resolution.place?.id && !resolution.typeRejected) {
    const { data: existing, error: existingError } = await supabase
      .from("restaurants")
      .select("id,verification,merged_into")
      .eq("external_id", resolution.place.id)
      .maybeSingle();
    if (existingError) throw existingError;
    // Common resolver contract: a verified live DB identity is a zero-Google
    // hit. Sparse historical rows are repaired by the dedicated completeness
    // worker/backfill; resolve_content must not turn the lookup into a hidden
    // Details debit after already choosing the free branch.
    if (existing?.verification === "verified" && existing.merged_into == null) {
      return { restaurantId: existing.id, confidence: "high" };
    }
    const provider = new CompletenessProvider(supabase, {
      googleApiKey: Deno.env.get("GOOGLE_PLACES_API_KEY") ?? "",
      spendFrozen: Deno.env.get("COMPLETENESS_SPEND_FROZEN") === "true",
    });
    const claimant = crypto.randomUUID();
    // A preceding Details branch is now a cache hit; a Text Search branch
    // intentionally crosses the minimal Details attestation choke point once.
    const projection = await provider.attest(
      userId,
      resolution.place.id,
      claimant,
    );
    const persisted = await provider.persistAttestedRestaurant(
      userId,
      existing?.id ?? null,
      projection,
      claimant,
      true,
    );
    return { restaurantId: persisted.restaurant_id, confidence: "high" };
  }

  const { data: ghost } = await supabase
    .from("restaurants")
    .insert({
      external_id: `ghost_${userId}_${Date.now()}`,
      name: extracted.name,
      city: extracted.city,
      address: extracted.address,
      verification: "unverified",
      created_by: userId,
    })
    .select("id")
    .single();
  return { restaurantId: ghost?.id ?? null, confidence: "low" };
}

// ── save_spots action (ARCH-REVIEW-2 #1 — lives in resolve-url) ───────────────
// TICKET-187: SaveSpotPlacePayload moved to _helpers.ts (imported above) so the
// deno test can assert client photo fields never reach an upsert. The interface
// deliberately carries NO photoReference / photoAttributionHtml — client photo
// fields are ignored; the deferred job re-derives everything from the DB row.

interface SaveSpotInput {
  candidate_id: string;
  client_nonce: string; // uuid string
  restaurant_id: string | null;
  external_id: string | null;
  restaurant_name: string | null;
  restaurant_city: string | null;
  area?: string | null;
  table_id?: string | null;
  table_client_nonce?: string | null;
  /** TICKET-195 v2: server-minted, caller-bound provenance. */
  resolution_id?: string | null;
  /** Full Places payload from the client — used in FIX#4 to upsert with all metadata. */
  place?: SaveSpotPlacePayload | null;
}

interface V2DestinationIntent {
  item_nonce: string;
  destination_nonce: string;
  destination_kind: "wishlist" | "table" | "list" | "new_list";
  target_table_id?: string | null;
  target_list_id?: string | null;
  target_list_title?: string | null;
  title_nonce?: string | null;
  notify_done?: boolean;
}

async function handleSaveSpotsV2(
  supabase: any,
  user: { id: string },
  body: Record<string, unknown>,
  importNonce: string,
  spots: SaveSpotInput[],
): Promise<Response> {
  const destinations = body["destination_intent"] as V2DestinationIntent[];
  const expectedDestinations = body["expected_destinations"] as number;
  const resolutionIds = [
    ...new Set(
      spots.map((spot) => spot.resolution_id).filter((id): id is string =>
        typeof id === "string" && id.length > 0
      ),
    ),
  ];
  const attemptedExternalIdByResolution = new Map<string, string>();
  const decisionByResolution = new Map<string, string>();
  if (resolutionIds.length > 0) {
    const { data: resolutionRows, error: resolutionError } = await supabase
      .from("import_resolutions")
      .select("resolution_id,decision,candidate_evidence")
      .eq("user_id", user.id)
      .in("resolution_id", resolutionIds);
    if (resolutionError) {
      return errorResponse(
        "V2_PROVENANCE_UNAVAILABLE",
        "Could not load server resolution evidence",
        500,
      );
    }
    for (const row of resolutionRows ?? []) {
      if (typeof row.decision === "string") {
        decisionByResolution.set(row.resolution_id, row.decision);
      }
      const attemptedExternalId = attemptedExternalIdFromResolutionEvidence(
        row.candidate_evidence,
      );
      if (attemptedExternalId) {
        attemptedExternalIdByResolution.set(
          row.resolution_id,
          attemptedExternalId,
        );
      }
    }
  }

  // V2 clients omit external_id for already-persisted venues. Restore those
  // identities in one read; fn_enqueue_completeness still validates equality.
  const restaurantIdsNeedingExternalId = v2RestaurantIdsNeedingExternalId(
    spots,
  );
  let restaurantRows: Array<{ id: string; external_id: string | null }> = [];
  if (restaurantIdsNeedingExternalId.length > 0) {
    const { data, error } = await supabase
      .from("restaurants")
      .select("id,external_id")
      .in("id", restaurantIdsNeedingExternalId);
    if (error) {
      return errorResponse(
        "V2_IDENTITY_UNAVAILABLE",
        "Could not load restaurant identity",
        500,
      );
    }
    restaurantRows = data ?? [];
  }

  const itemIdentities = buildV2CompletenessItemIdentities(
    spots,
    restaurantRows,
  );
  const items = itemIdentities.map((identity, index) => {
    const spot = spots[index];
    // client_facts feed the deferred Text Search — a misaligned merge would
    // resolve the wrong venue, so refuse if the identity zip ever drifts.
    if (identity.item_nonce !== spot.client_nonce) {
      throw new Error("v2 item identities misaligned with spot order");
    }
    return {
      ...identity,
      // Advisory only. The worker derives identity, coordinates, and media
      // from its own attestation; these facts are resolution hints at most.
      client_facts: buildV2CompletenessClientFacts(spot, {
        // These two fields are reloaded from append-only server evidence and
        // cannot be forged by the save caller.
        attemptedExternalId: spot.resolution_id
          ? attemptedExternalIdByResolution.get(spot.resolution_id) ?? null
          : null,
        resolutionDecision: spot.resolution_id
          ? decisionByResolution.get(spot.resolution_id) ?? null
          : null,
        source: body["source"],
        note: typeof body["note"] === "string" ? body["note"] : null,
      }),
    };
  });

  const { data, error } = await supabase.rpc("fn_enqueue_completeness", {
    p_owner: user.id,
    p_import_nonce: importNonce,
    p_protocol_generation: "v2",
    p_items: items,
    p_destinations: destinations,
    p_expected_destinations: expectedDestinations,
  });
  if (error) {
    const message = error.message ?? "completeness enqueue failed";
    const status = error.code === "42501"
      ? 403
      : /NONCE_REUSE|SEALED|EXPECTED_MISMATCH|PROTOCOL_GENERATION/.test(message)
      ? 409
      : 400;
    return errorResponse(
      status === 403 ? "FORBIDDEN" : "V2_ENQUEUE_REJECTED",
      message,
      status,
    );
  }

  const enqueue = data as {
    job_id?: string;
    sealed?: boolean;
    items?: Array<{ id?: string; item_nonce?: string }>;
  } | null;
  if (!enqueue?.job_id || !Array.isArray(enqueue.items)) {
    return errorResponse(
      "INTERNAL",
      "completeness enqueue returned an incomplete result",
      500,
    );
  }

  const processedByNonce = new Map<string, {
    state: string;
    restaurant_id?: string | null;
    already_pinned?: boolean;
  }>();
  if (enqueue.sealed === true) {
    const backend = new DefaultCompletenessBackend(supabase, {
      googleApiKey: Deno.env.get("GOOGLE_PLACES_API_KEY") ?? "",
      spendFrozen: Deno.env.get("COMPLETENESS_SPEND_FROZEN") === "true",
    });
    // Exact sealing restores the approved fast path. Each inline contender
    // must win the same lease-token claim used by cron; a concurrent worker
    // simply wins one side and the other observes queued/terminal state.
    const inlineClaims = buildInlineCompletenessClaims(
      enqueue.items,
      new Set(spots.map((spot) => spot.client_nonce)),
    );
    await Promise.all(inlineClaims.map(async ({ item, workerId }) => {
      const claimed = await backend.claimItem(item.id, workerId, 180);
      if (claimed) {
        const result = await settleClaimedCompletenessItem(
          backend,
          claimed,
          workerId,
        );
        processedByNonce.set(item.item_nonce, result);
        return;
      }
      const current = await backend.getItem(item.id);
      if (current) {
        processedByNonce.set(item.item_nonce, {
          state: current.state as string,
          restaurant_id: current.restaurant_id,
        });
      }
    }));
  }

  const exhaustedRoutesByNonce = new Map<string, {
    ghost: boolean;
    wishlistId: string | null;
  }>();
  if (
    [...processedByNonce.values()].some((process) =>
      process.state === "exhausted"
    )
  ) {
    const status = await getCompletenessJobStatus(
      supabase,
      user.id,
      enqueue.job_id,
    );
    for (const item of status?.items ?? []) {
      if (item.state === "exhausted") {
        exhaustedRoutesByNonce.set(
          item.item_nonce,
          exhaustedInlineRoute(item.destinations),
        );
      }
    }
  }

  const results: Array<{
    candidate_id: string;
    client_nonce: string;
    status: "saved" | "already_pinned" | "queued" | "ghost";
    restaurant_id: string | null;
    wishlist_id?: string | null;
  }> = spots.map((spot) => {
    const process = processedByNonce.get(spot.client_nonce);
    const terminal = process?.state === "verified" ||
      process?.state === "resolved";
    const alreadyPinned = terminal && process?.already_pinned === true;
    const exhaustedRoute = process?.state === "exhausted"
      ? exhaustedRoutesByNonce.get(spot.client_nonce)
      : undefined;
    if (exhaustedRoute?.ghost) {
      return {
        candidate_id: spot.candidate_id,
        client_nonce: spot.client_nonce,
        status: "ghost",
        restaurant_id: process?.restaurant_id ?? spot.restaurant_id ?? null,
        wishlist_id: exhaustedRoute.wishlistId,
      };
    }
    return {
      candidate_id: spot.candidate_id,
      client_nonce: spot.client_nonce,
      status: alreadyPinned
        ? "already_pinned" as const
        : terminal
        ? "saved" as const
        : "queued" as const,
      restaurant_id: process?.restaurant_id ?? spot.restaurant_id ?? null,
    };
  });
  return jsonResponse({
    data: {
      results,
      summary: {
        saved: results.filter((result) => result.status === "saved").length,
        already_pinned: results.filter((result) =>
          result.status === "already_pinned"
        ).length,
        queued: results.filter((result) => result.status === "queued").length,
        ghost: results.filter((result) => result.status === "ghost").length,
        failed: 0,
      },
      job_id: enqueue.job_id,
      sealed: enqueue.sealed === true,
    },
  });
}

async function handleSaveSpots(
  supabase: any,
  user: { id: string },
  body: Record<string, unknown>,
): Promise<Response> {
  const importNonce = body["import_nonce"] as string | undefined;
  const spots = body["spots"] as SaveSpotInput[] | undefined;
  // FIX #1: pass source as-is (object), never JSON.stringify — supabase-js
  // serializes jsonb objects itself; stringifying produces a jsonb STRING
  // which fails the wishlist_items_source_shape CHECK (jsonb_typeof='object').
  // cf. table-shares/index.ts:227 canonical pattern.
  const source = body["source"] as unknown;
  const note = typeof body["note"] === "string" ? body["note"] : null;
  // TICKET-152: default TRUE (back-compat). `false` = list-only import — the spot
  // lands only in the destination list, NOT the personal wishlist, so the RPC
  // (which unconditionally pins) is skipped in favor of a direct restaurant upsert.
  const pinWishlist = normalizePinWishlist(body["pin_wishlist"]);

  // Field-presence classification is deliberately first-touch and exhaustive.
  // A partial v2 payload never drifts into the exact legacy response contract.
  if (isV2SaveProtocolRequest(body, spots)) {
    const validationError = validateV2SaveProtocol(importNonce, spots, body);
    if (validationError) {
      return errorResponse("INVALID_V2_BODY", validationError, 400);
    }
    let authoritativeBody = body;
    const v2HandoffToken = typeof body["handoff_token"] === "string"
      ? body["handoff_token"]
      : null;
    if (v2HandoffToken) {
      // V2 must preserve the legacy handoff authority boundary: one live
      // share read immediately before enqueue, and server-owned source
      // attribution. Queue durability must never turn a revoked share into
      // a later write or trust the recipient's source object.
      const auth = await loadHandoffWriteAuthorization(
        supabase,
        v2HandoffToken,
      );
      if (auth.revoked === true) {
        return errorResponse(
          "SHARE_REVOKED",
          "Share revoked or not found",
          409,
        );
      }
      if (
        spots!.some((spot) =>
          !isSpotPinnable(spot.restaurant_id, auth.liveRestaurantIds)
        )
      ) {
        return errorResponse(
          "NOT_IN_SHARE",
          "A spot is no longer in the shared set",
          403,
        );
      }
      authoritativeBody = {
        ...body,
        source: { type: "handoff", sharer_name: auth.sharerName },
      };
    }
    return await handleSaveSpotsV2(
      supabase,
      user,
      authoritativeBody,
      importNonce!,
      spots!,
    );
  }

  // Installed legacy clients retain their exact response contract during the
  // rollout. The floor starts measurable in warn mode; a later operator-only
  // env change can reject builds below it without another code deployment.
  const legacySunset = evaluateLegacySaveSunset(
    Deno.env.get("LEGACY_SAVE_MIN_BUILD"),
    Deno.env.get("LEGACY_SAVE_ENFORCEMENT"),
    body["client_build"],
  );
  if (legacySunset.belowFloor) {
    console.warn("legacy save below configured build floor", {
      observed_build: legacySunset.observedBuild,
      minimum_build: legacySunset.minimumBuild,
      enforcement: legacySunset.reject ? "reject" : "warn",
    });
    if (legacySunset.reject) {
      return errorResponse(
        "LEGACY_CLIENT_UNSUPPORTED",
        "Please update Napkin before importing this link",
        426,
      );
    }
  }

  if (!importNonce || !Array.isArray(spots) || spots.length === 0) {
    return errorResponse(
      "INVALID_BODY",
      "import_nonce and spots[] are required",
      400,
    );
  }

  // Per-request cap — generous enough for video listicles (extraction caps at
  // 12) with abuse headroom. Was 6 (the old text-only spec), which silently
  // dropped spots 7+ of an 11-spot import → only 6 of 11 saved (TICKET-082).
  const requestedCapped = spots.slice(0, 20);
  // TICKET-195: resolve_spots carries a nested marker specifically so older
  // clients preserve the rejection through to this server. Refuse it BEFORE
  // membership reads, restaurant upserts, or fn_save_import_spot; it is scene
  // text noise, not a ghost restaurant.
  const typeRejectedSpots = requestedCapped.filter(isTypeRejectedSaveSpot);
  const capped = requestedCapped.filter((spot) =>
    !isTypeRejectedSaveSpot(spot)
  );
  const typeRejectedResults = typeRejectedSpots.map((spot) => ({
    candidate_id: spot.candidate_id,
    client_nonce: spot.client_nonce,
    status: "failed" as const,
    error: "place type is not an importable food or drink venue",
    code: "TYPE_REJECTED",
  }));
  if (capped.length === 0) {
    return jsonResponse({
      data: {
        results: typeRejectedResults,
        summary: {
          saved: 0,
          already_pinned: 0,
          ghost: 0,
          failed: typeRejectedResults.length,
        },
        job_id: null,
        type_rejected: typeRejectedResults.length,
      },
    });
  }

  // ── TICKET-072 ARCH-REVIEW-2 #1/#4 + TICKET-077: handoff_token gate ──────
  // When handoff_token is present, the server authorizes the pin against the
  // owner's LIVE state (never cached resolve data) and constructs `source`
  // authoritatively — client-sent source is ignored.
  //
  // TICKET-077: shares are live. We pin ONLY restaurant_ids in the owner's CURRENT
  // verified spot set; a restaurant_id the owner has since removed (or one from a
  // different share) is rejected, NOT trusted. sharer_name is the owner's LIVE name.
  //
  // TICKET-077 fix-pass (TOCTOU): the authoritative live read happens at the WRITE
  // BOUNDARY below (loadHandoffWriteAuthorization) — there is intentionally NO early
  // live load here, so nothing stale can leak into isSpotPinnable.
  const handoffToken = typeof body["handoff_token"] === "string"
    ? body["handoff_token"]
    : null;
  let effectiveSource: unknown = source;
  // null ⇒ no handoff gate (normal import). A Set ⇒ handoff: the restaurant_ids
  // in the CURRENT live spot set; only these may be pinned. Both are assigned
  // ONLY at the write boundary below (TICKET-077 fix-pass — TOCTOU): there must
  // be exactly ONE authorization-relevant live read, and it must be as late as
  // possible so an owner removing a spot / deleting the list / de-verifying a
  // restaurant after the request begins cannot leave a stale set that pins.
  let liveRestaurantIds: Set<string> | null = null;

  const buildRevokedResponse = () => {
    const revokedResults = capped.map((spot) => ({
      candidate_id: spot.candidate_id,
      client_nonce: spot.client_nonce,
      status: "failed" as const,
      error: "share revoked or not found",
      code: "SHARE_REVOKED",
    }));
    return jsonResponse({
      data: {
        results: revokedResults,
        summary: { saved: 0, already_pinned: 0, failed: revokedResults.length },
      },
    });
  };

  // ── FIX #3 (P1): validate table memberships BEFORE calling the RPC ──────
  // member_id doctrine (TICKET-034): the column is member_id, NOT user_id.
  // Unauthorized table_ids are short-circuited here and never reach the RPC.
  const tableIdsToCheck = [
    ...new Set(
      capped
        .map((s) => s.table_id ?? null)
        .filter((t): t is string => t !== null),
    ),
  ];

  // Item 6 (fix-pass-2): call the exported helper so the deno test guards this path
  // rather than maintaining a duplicate implementation here.
  let unauthorizedTableIds = new Set<string>();
  if (tableIdsToCheck.length > 0) {
    const { data: memberRows } = await supabase
      .from("table_members")
      .select("table_id")
      .eq("member_id", user.id) // member_id, NOT user_id (TICKET-034)
      .in("table_id", tableIdsToCheck);
    unauthorizedTableIds = filterUnauthorizedTableIds(
      tableIdsToCheck,
      memberRows ?? [],
    );
  }

  // ── TICKET-077 fix-pass (TOCTOU): ONE authoritative authorization read, at the
  // write boundary ──────────────────────────────────────────────────────────
  // This is the SOLE live read used to authorize a handoff pin. It runs here —
  // immediately before the per-spot write loop, AFTER the (potentially ~100 ms)
  // membership / upsert prep above — so it observes the owner's CURRENT state.
  // loadHandoffWriteAuthorization re-checks revocation AND re-loads the live spot
  // set in one place: if the owner removed a spot, deleted/unowned the list, or a
  // restaurant became unverified since the request began, the fresh set reflects
  // it and isSpotPinnable rejects those spots (NOT_IN_SHARE). There is no early
  // live load to drift from — see liveRestaurantIds declaration above.
  //
  // sharer_name (server-authoritative provenance, ARCH-2 #4) also comes from THIS
  // fresh read — the owner's CURRENT display name.
  //
  // Accepted residual: a revoke arriving WITHIN the loop (between individual
  // fn_save_import_spot calls) lets already-in-flight spots complete. This is
  // acceptable per the "copies-keep-living" doctrine — a recipient pinning
  // public restaurant names they already viewed at resolve time is near-zero harm.
  // Do NOT thread token state into fn_save_import_spot (too heavy for the harm
  // profile — ARCH-REVIEW-2 #2 rationale).
  if (handoffToken) {
    const auth = await loadHandoffWriteAuthorization(supabase, handoffToken);
    if (auth.revoked === true) {
      // Revoked, unknown, or list/owner gone NOW → all spots fail SHARE_REVOKED.
      return buildRevokedResponse();
    }
    liveRestaurantIds = auth.liveRestaurantIds;
    effectiveSource = { type: "handoff", sharer_name: auth.sharerName };
  }

  const results: Array<{
    candidate_id: string;
    client_nonce: string;
    // TICKET-152: 'ghost' is only ever produced by the pin_wishlist=false
    // (list-only) branch below — the RPC path returns saved|already_pinned|failed,
    // so old callers never see it.
    status: "saved" | "already_pinned" | "ghost" | "failed";
    wishlist_id?: string | null;
    restaurant_id?: string | null;
    error?: string;
    code?: string;
  }> = [...typeRejectedResults];
  const legacyCompleteness = new DefaultCompletenessBackend(supabase, {
    googleApiKey: Deno.env.get("GOOGLE_PLACES_API_KEY") ?? "",
    spendFrozen: Deno.env.get("COMPLETENESS_SPEND_FROZEN") === "true",
  });

  for (const spot of capped) {
    // FIX #3: early fail for unauthorized table_ids
    if (spot.table_id && unauthorizedTableIds.has(spot.table_id)) {
      results.push({
        candidate_id: spot.candidate_id,
        client_nonce: spot.client_nonce,
        status: "failed",
        error: "not a member of this table",
        code: "NOT_A_MEMBER",
      });
      continue;
    }

    // TICKET-077: for a handoff pin, the spot MUST be in the share's CURRENT
    // live spot set. The client cannot smuggle a restaurant_id the owner has
    // since removed (or one from a different share) — we pin only what the
    // owner shares right now. (isSpotPinnable is the exported pure guard so the
    // deno test exercises this exact decision.)
    if (!isSpotPinnable(spot.restaurant_id, liveRestaurantIds)) {
      results.push({
        candidate_id: spot.candidate_id,
        client_nonce: spot.client_nonce,
        status: "failed",
        error: "spot is not in the shared set",
        code: "NOT_IN_SHARE",
      });
      continue;
    }

    // FIX #2: sanitize client-sent 'ghost_pending' sentinel to null.
    // The RPC mints a stable ghost external_id from (user, client_nonce) when
    // both restaurant_id and external_id are null.
    const safeExternalId = isGhostExternalId(spot.external_id)
      ? null
      : (spot.external_id ?? null);

    // Legacy cannot safely acknowledge a deferred save: an installed client
    // would delete its manifest. Re-attest synchronously from server-held
    // identity and return a plain per-item failure if any provider stage is
    // unavailable. Client coordinates/photo fields never enter this write.
    let resolvedRestaurantId = spot.restaurant_id ?? null;
    let attestedExternalId = safeExternalId;
    let alreadyComplete = false;
    if (resolvedRestaurantId) {
      let { data: existingIdentity, error: identityError } = await supabase
        .from("restaurants")
        .select(
          "id,external_id,verification,merged_into,created_by,lat,lng,photo_url,photo_source,places_photo_attribution_html",
        )
        .eq("id", resolvedRestaurantId)
        .maybeSingle();
      if (identityError) {
        results.push({
          candidate_id: spot.candidate_id,
          client_nonce: spot.client_nonce,
          status: "failed",
          error: "could not verify restaurant identity",
        });
        continue;
      }
      if (existingIdentity?.merged_into) {
        const { data: canonicalId, error: canonicalError } = await supabase.rpc(
          "fn_resolve_canonical",
          { p_id: resolvedRestaurantId },
        );
        if (canonicalError || typeof canonicalId !== "string") {
          results.push({
            candidate_id: spot.candidate_id,
            client_nonce: spot.client_nonce,
            status: "failed",
            error: "could not resolve restaurant identity",
          });
          continue;
        }
        const canonicalRead = await supabase
          .from("restaurants")
          .select(
            "id,external_id,verification,merged_into,created_by,lat,lng,photo_url,photo_source,places_photo_attribution_html",
          )
          .eq("id", canonicalId)
          .maybeSingle();
        if (canonicalRead.error || !canonicalRead.data) {
          results.push({
            candidate_id: spot.candidate_id,
            client_nonce: spot.client_nonce,
            status: "failed",
            error: "could not resolve restaurant identity",
          });
          continue;
        }
        existingIdentity = canonicalRead.data;
        resolvedRestaurantId = canonicalId;
      }
      if (
        !existingIdentity ||
        (existingIdentity.verification !== "verified" &&
          existingIdentity.created_by !== user.id) ||
        (
          existingIdentity.verification === "verified" &&
          attestedExternalId &&
          existingIdentity.external_id !== attestedExternalId
        )
      ) {
        results.push({
          candidate_id: spot.candidate_id,
          client_nonce: spot.client_nonce,
          status: "failed",
          error: "restaurant identity is not bound to this save",
          code: "RESTAURANT_ID_MISMATCH",
        });
        continue;
      }
      alreadyComplete = hasCompleteRestaurantFacts(existingIdentity);
      if (!attestedExternalId) {
        attestedExternalId = !existingIdentity?.external_id ||
            existingIdentity.external_id.startsWith("ghost_") ||
            existingIdentity.external_id.startsWith("merged_")
          ? null
          : (existingIdentity?.external_id ?? null);
      }
    }
    if (!alreadyComplete && !attestedExternalId) {
      results.push({
        candidate_id: spot.candidate_id,
        client_nonce: spot.client_nonce,
        status: "failed",
        error: "restaurant could not be verified",
        code: "ATTESTATION_REQUIRED",
      });
      continue;
    }
    try {
      if (alreadyComplete) {
        // Previously server-attested, terminal rows are the zero-Google
        // path. Replays remain free and preserve the legacy wire shape.
      } else {
        const claimant = crypto.randomUUID();
        const projection = await legacyCompleteness.attest(
          user.id,
          attestedExternalId!,
          claimant,
        );
        const persisted = await legacyCompleteness.persistAttestedRestaurant(
          user.id,
          resolvedRestaurantId,
          projection,
          claimant,
          true,
        );
        resolvedRestaurantId = persisted.restaurant_id;
      }
    } catch (error) {
      results.push({
        candidate_id: spot.candidate_id,
        client_nonce: spot.client_nonce,
        status: "failed",
        error: error instanceof Error
          ? error.message
          : "restaurant attestation failed",
        code: "ATTESTATION_FAILED",
      });
      continue;
    }

    // ── TICKET-152: pin_wishlist=false → LIST-ONLY save (skip the RPC) ──────
    // The RPC (fn_save_import_spot) unconditionally pins to the personal
    // wishlist, so a list-only import routes AROUND it: yield a restaurant_id
    // (for the client's destination-list add_entries) via a direct upsert, and
    // ALWAYS mint a DB row — even for ghosts (M1) — so list-only never silently
    // drops a spot and the lazy verify-on-open repair still fires. wishlist_id is
    // null in every branch (nothing is pinned), which is how the digest knows to
    // show replace·remove (no "unpin"). No migration: upsertRestaurant writes
    // only `restaurants` and is already used above (FIX#4).
    if (!pinWishlist) {
      try {
        const kind = listOnlySaveKind(resolvedRestaurantId, safeExternalId);
        let listRestaurantId = resolvedRestaurantId;
        if (kind === "verified") {
          // Real external_id but FIX#4 didn't already produce an id — upsert now.
          // TICKET-187: same no-photo-fields mapping as FIX#4.
          listRestaurantId = await upsertRestaurant(
            supabase,
            buildVerifiedUpsertInput(safeExternalId!, spot),
          );
        } else if (kind === "ghost") {
          // Mint a DETERMINISTIC unverified ghost row keyed on (user, nonce),
          // matching fn_save_import_spot's own 'ghost_{user}_{nonce}' convention
          // so a resume re-upserts the SAME row (ON CONFLICT external_id) — no dup.
          listRestaurantId = await upsertRestaurant(supabase, {
            external_id: buildGhostExternalId(user.id, spot.client_nonce),
            name: spot.restaurant_name ?? spot.place?.name ?? "Unknown",
            location: {
              address: spot.place?.location?.address ?? undefined,
              locality: spot.restaurant_city ??
                spot.place?.location?.locality ?? undefined,
            },
            verification: "unverified",
          });
        }
        if (!listRestaurantId) {
          // A verified/existing branch that still yielded no id (upsert failed)
          // is a per-spot failure — never poisons the job (client marks needsLook).
          results.push({
            candidate_id: spot.candidate_id,
            client_nonce: spot.client_nonce,
            status: "failed",
            error: "could not resolve a restaurant_id for list-only save",
          });
          continue;
        }
        results.push({
          candidate_id: spot.candidate_id,
          client_nonce: spot.client_nonce,
          status: kind === "ghost" ? "ghost" : "saved",
          wishlist_id: null,
          restaurant_id: listRestaurantId,
        });
      } catch (e: any) {
        results.push({
          candidate_id: spot.candidate_id,
          client_nonce: spot.client_nonce,
          status: "failed",
          error: e?.message ?? "list-only save failed",
        });
      }
      continue;
    }

    try {
      const rpcArgs = {
        p_user_id: user.id,
        p_import_nonce: importNonce,
        p_client_nonce: spot.client_nonce,
        // Required/non-default on the additive overload. Legacy
        // requests have no server provenance, so NULL is explicit.
        p_resolution_id: null,
        p_restaurant_id: resolvedRestaurantId,
        p_external_id: resolvedRestaurantId ? null : safeExternalId,
        p_restaurant_name: spot.restaurant_name ?? null,
        p_restaurant_city: spot.restaurant_city ?? null,
        // FIX #1: pass source as the object value, not JSON.stringify(source)
        // TICKET-072: use effectiveSource (handoff_token overrides client-sent source)
        p_source: effectiveSource ?? null,
        p_note: note,
        p_table_id: spot.table_id ?? null,
        p_table_client_nonce: spot.table_client_nonce ?? null,
      };
      let { data: rpcResult, error: rpcError } = await supabase.rpc(
        "fn_save_import_spot",
        rpcArgs,
      );
      // Migration-before-functions rollout compatibility: an old stack
      // may not have the required-argument overload yet. Only an actual
      // signature-not-found error falls back; application failures do not.
      if (
        rpcError &&
        ["PGRST202", "PGRST203", "42883"].includes(rpcError.code ?? "")
      ) {
        const { p_resolution_id: _resolutionId, ...legacyArgs } = rpcArgs;
        const legacy = await supabase.rpc("fn_save_import_spot", legacyArgs);
        rpcResult = legacy.data;
        rpcError = legacy.error;
      }

      if (rpcError) {
        results.push({
          candidate_id: spot.candidate_id,
          client_nonce: spot.client_nonce,
          status: "failed",
          error: rpcError.message ?? "rpc error",
        });
        continue;
      }

      const r = rpcResult as Record<string, unknown> | null;
      results.push({
        candidate_id: spot.candidate_id,
        client_nonce: spot.client_nonce,
        status: (r?.["status"] as any) ?? "failed",
        wishlist_id: (r?.["wishlist_id"] as string) ?? null,
        restaurant_id: (r?.["restaurant_id"] as string) ?? null,
        error: r?.["status"] === "failed"
          ? (r?.["error"] as string)
          : undefined,
      });
    } catch (e: any) {
      results.push({
        candidate_id: spot.candidate_id,
        client_nonce: spot.client_nonce,
        status: "failed",
        error: e?.message ?? "unexpected error",
      });
    }
  }

  const savedCount = results.filter((r) => r.status === "saved").length;
  const alreadyCount =
    results.filter((r) => r.status === "already_pinned").length;
  const failedCount = results.filter((r) => r.status === "failed").length;
  // TICKET-152: ghost is only produced by the list-only branch; 0 for every
  // legacy (pin_wishlist omitted) caller, so the summary stays back-compatible.
  const ghostCount = results.filter((r) => r.status === "ghost").length;

  // The batch's server job_id (minted by the RPC keyed on import_nonce) so the
  // client toast can deep-link to /imports/[jobId] for review/fix. Nested
  // INSIDE data — callEdgeFn strips the outer envelope and drops siblings.
  let batchJobId: string | null = null;
  try {
    const { data: jobRow } = await supabase
      .from("import_jobs")
      .select("job_id")
      .eq("user_id", user.id)
      .eq("import_nonce", importNonce)
      .maybeSingle();
    batchJobId = jobRow?.job_id ?? null;
  } catch {
    /* link is optional — never fail the save over it */
  }

  // TICKET-123: the auto-save path rides this server round-trip to write the
  // durable `import_done` inbox row (outcome 'saved'). Only when the client
  // opts in (notify_done) AND real pins landed — an all-already_pinned re-drain
  // emits nothing (matches TICKET-120's `saved > 0` banner gate). Uses the
  // server batchJobId so the inbox tap deep-links to /imports/[jobId].
  // Best-effort — never fails the save over a notification.
  if (body["notify_done"] === true && savedCount > 0) {
    await emitImportDone(supabase, {
      recipientUserId: user.id,
      jobId: batchJobId,
      count: savedCount,
      outcome: "saved",
    });
  }

  // ── TICKET-187: deferred hero-photo acquisition ───────────────────────────
  // Build the response FIRST, then schedule the ENTIRE photo workflow
  // (Details → decide → mirror) via EdgeRuntime.waitUntil — zero Google calls
  // on the save critical path; a slow/failing Google response can never delay
  // or fail a save. The job receives ONLY deduplicated successful
  // restaurant_ids + the requester's user id (never client-paired external ids
  // or client photo fields); everything else is re-derived from the DB.
  const response = jsonResponse({
    data: {
      results,
      summary: {
        saved: savedCount,
        already_pinned: alreadyCount,
        ghost: ghostCount,
        failed: failedCount,
      },
      job_id: batchJobId,
      type_rejected: typeRejectedResults.length,
    },
  });

  const mirrorIds = dedupeSuccessfulRestaurantIds(results);
  if (mirrorIds.length > 0) {
    // .catch first: an unhandled rejection must never crash the isolate.
    // acquireAndMirrorHeroPhotos reports its own failures to Sentry
    // internally (its outer catch swallows, so this .catch is a dead-code
    // last resort today) — the reportError here only fires if a future
    // refactor lets the job reject.
    const photoJob = acquireAndMirrorHeroPhotos(supabase, mirrorIds, user.id)
      .catch((e) => {
        console.error("deferred hero-photo job failed (non-fatal):", e);
        reportError(e, {
          fn: "resolve-url",
          action: "photo-mirror",
          extra: { user_id: user.id },
        });
      });
    try {
      // Supabase's edge runtime keeps the isolate alive until the job
      // settles WITHOUT delaying the response. Not available everywhere
      // (local deno, tests) — fall back silently to fire-and-forget
      // (same pattern as _shared/report.ts).
      // deno-lint-ignore no-explicit-any
      (globalThis as any).EdgeRuntime?.waitUntil?.(photoJob);
    } catch {
      // ignore — plain fire-and-forget still stands.
    }
  }

  return response;
}

// ── cache_clip_thumb action (TICKET-156 — On Socials rail thumbnail cache) ────

/**
 * Cache a small JPEG cover frame for a clipped video, keyed by the CANONICAL
 * video URL (shared across every saver of that video — dedupe for free). The
 * client fetches the fresh, still-unexpired provider thumbnail on-device and
 * POSTs its bytes here; the server recomputes the content key, validates the
 * bytes, uploads service-role to the public-read `clip-thumbs` bucket, and
 * upserts the `clip_thumbs` row. Public-read / service-role-write only — there
 * is no authenticated write path (the whole RLS attack surface is deleted).
 *
 * [ARCH-REVIEW W1]: JPEG magic-byte check (FF D8 FF) + a hard ≤512KB decoded cap
 * BEFORE upload, so a poisoned/garbage payload can never render as a broken
 * image forever (a non-null thumb_url skips the typographic fallback). First-
 * write-wins: a key that's already 'cached' OR 'gone' short-circuits before any
 * decode/upload ('gone' is the backfill's permanent skip-marker — respected).
 */
async function handleCacheClipThumb(
  supabase: any,
  body: Record<string, unknown>,
): Promise<Response> {
  const videoUrl = typeof body["video_url"] === "string"
    ? body["video_url"]
    : null;
  const imageBase64 = typeof body["image_base64"] === "string"
    ? body["image_base64"]
    : null;
  const sourceType = typeof body["source_type"] === "string"
    ? body["source_type"]
    : null;

  if (!videoUrl || !imageBase64) {
    return errorResponse(
      "INVALID_BODY",
      "video_url and image_base64 are required",
      400,
    );
  }
  // Only the two providers that render a photo card cache a thumb (video-type
  // never renders a photo, so it never captures — client-enforced too).
  if (sourceType !== "tiktok" && sourceType !== "instagram") {
    return errorResponse(
      "INVALID_SOURCE_TYPE",
      "source_type must be tiktok or instagram",
      400,
    );
  }

  const key = await contentKey(videoUrl);

  // First-write-wins: a 'cached' OR 'gone' key short-circuits before decode/upload.
  const { data: existing } = await supabase
    .from("clip_thumbs")
    .select("content_key, status")
    .eq("content_key", key)
    .maybeSingle();
  if (existing) {
    return jsonResponse({ data: { ok: true, deduped: true } });
  }

  // Bounded inbound guard BEFORE decoding a huge string (512KB decoded ≈ 683KB
  // base64; a little headroom for padding/whitespace).
  if (imageBase64.length > 720 * 1024) {
    return errorResponse("IMAGE_TOO_LARGE", "thumbnail exceeds size cap", 413);
  }

  let bytes: Uint8Array;
  try {
    const bin = atob(imageBase64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return errorResponse(
      "INVALID_IMAGE",
      "image_base64 is not valid base64",
      400,
    );
  }

  // W1: hard decoded cap + JPEG magic-byte validation BEFORE upload.
  // Residual risk accepted (review NIT-1): a 3-byte JPEG prefix on garbage
  // passes and first-write-wins persists it — bounded to public-frame stakes.
  if (bytes.length === 0 || bytes.length > 512 * 1024) {
    return errorResponse("IMAGE_TOO_LARGE", "thumbnail must be 1B–512KB", 413);
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return errorResponse("NOT_A_JPEG", "thumbnail is not a JPEG", 400);
  }

  const storagePath = `${key}.jpg`;
  const { error: uploadErr } = await supabase.storage
    .from("clip-thumbs")
    .upload(storagePath, bytes, { contentType: "image/jpeg", upsert: true });
  if (uploadErr) {
    console.error(
      "cache_clip_thumb upload error:",
      uploadErr.message ?? uploadErr,
    );
    return errorResponse("UPLOAD_FAILED", "could not cache thumbnail", 500);
  }

  const { error: rowErr } = await supabase
    .from("clip_thumbs")
    .upsert({
      content_key: key,
      storage_path: storagePath,
      status: "cached",
      source_type: sourceType,
      updated_at: new Date().toISOString(),
    }, { onConflict: "content_key" });
  if (rowErr) {
    console.error(
      "cache_clip_thumb row upsert error:",
      rowErr.message ?? rowErr,
    );
    return errorResponse("UPSERT_FAILED", "could not record thumbnail", 500);
  }

  return jsonResponse({ data: { ok: true } });
}

// ── resolve_spots action (TICKET-152 — large Maps-list chunked resolution) ────

/**
 * Resolve one drain chunk (≤20 {name,address,client_nonce}) of a large Maps-list
 * import job to Places candidates. Routed like handleUrlResolve (NOT save_spots):
 * it owns its Deadline + a stageSignal(2500) for the ≤20 parallel Places calls and
 * threads authHeader/supabaseUrl/supabaseAnonKey into the shared resolve core so
 * the user JWT (and thus places-search's own bucket + auth) applies (L2).
 *
 * Guard order is explicit (L3): arg validation → kill-switch → rate check →
 * Places. Malformed requests 400 before burning an import_spots token; the
 * kill-switch degrades to ghost-mode with zero Places spend and no token spend.
 *
 * Response nests inside `data` (callEdgeFn strips the outer envelope). It echoes
 * every input client_nonce back as the deterministic join key — one result per
 * item, NEVER dropping duplicates: a within-chunk true-dupe returns the same
 * external_id twice and collapses at SAVE time (save_spots already_pinned), whereas
 * dropping it would strand its nonce and the client would ghost-save a real dupe.
 */
async function handleResolveSpots(
  supabase: any,
  user: { id: string },
  body: Record<string, unknown>,
  authHeader: string,
  supabaseUrl: string,
  supabaseAnonKey: string,
): Promise<Response> {
  // ── Guard 1 (L3): arg validation FIRST — before the rate check / any Places ──
  const validation = validateResolveSpotsArgs(
    body["import_nonce"],
    body["items"],
  );
  if (validation.ok === false) {
    return errorResponse("INVALID_BODY", validation.message, 400);
  }
  const items = validation.items;
  const importNonce = body["import_nonce"] as string;
  const deferredProtocol = isV2ResolveSpotsProtocol(
    body["protocol_generation"],
  );

  const buildWholeChunkDecision = async (
    decision: "transient" | "unattempted_budget",
  ) =>
    await Promise.all(
      items.map(async (item, index) =>
        buildResolveSpotDecisionResult(
          item,
          await computeCandidateId(
            importNonce,
            normalizeName(item.name),
            index,
          ),
          decision,
        )
      ),
    );

  // ── Guard 2: kill-switch — global Places-spend-cap degradation lever ────────
  // Zero Places calls AND no rate-token spend. Still mint one server-owned
  // `unattempted_budget` resolution per item so v2 can enqueue now and let the
  // worker retry after the freeze clears; no client-fabricated ghost evidence.
  if (isGhostOnlyMode(Deno.env.get("RESOLVE_SPOTS_GHOST_ONLY"))) {
    const results = await buildWholeChunkDecision("unattempted_budget");
    return jsonResponse({ data: { results, ghost_mode: true } });
  }

  // ── Guard 3: import_spots rate bucket — AFTER validation, BEFORE Places ─────
  // Distinct from places_search (120/hr) and resolve_url (30/hr) so imports never
  // starve interactive search and vice-versa. Fail-CLOSED (TICKET-091). The RPC
  // increments by 1/call and each call is ≤20 items, so p_max is requests/day.
  // 86400s = a fixed UTC-day bucket (resets 00:00 UTC). A 429 here means ONE thing
  // only — the import budget — so the drain reads it as budget-exhausted (M3).
  const rawMax = Number(Deno.env.get("IMPORT_SPOTS_MAX_PER_DAY") ?? "40");
  const importSpotsMax = Number.isFinite(rawMax) && rawMax > 0
    ? Math.floor(rawMax)
    : 40;
  const { data: rlRows, error: rlErr } = await supabase.rpc(
    "check_and_increment_rate_limit",
    {
      p_user_id: user.id,
      p_bucket_key: "import_spots",
      p_max: importSpotsMax,
      p_window_seconds: 86400,
    },
  );
  const rlRow = rlRows?.[0];
  const rateGate = resolveSpotsRateGate(rlErr, rlRow);
  if (rateGate !== "allowed") {
    if (rlErr) {
      console.error("resolve-url resolve_spots rate check failed:", rlErr);
    }
    if (deferredProtocol) {
      const results = await buildWholeChunkDecision(rateGate);
      return jsonResponse({
        data: {
          results,
          ghost_mode: rateGate === "unattempted_budget",
        },
      });
    }
    return jsonResponse(
      {
        error: {
          code: "RATE_LIMITED",
          message: "Daily import budget reached — try again tomorrow",
          details: { retry_after_seconds: rlRow?.retry_after_seconds ?? 3600 },
        },
      },
      429,
    );
  }

  // ── Places resolution — own Deadline + stageSignal for ≤20 parallel calls ──
  const deadline = new Deadline(12000);
  // Stage through the SAME helper the maps-list branch uses (full address rides in
  // `area`). Output is index-aligned with `items`, so results zip back by index →
  // client_nonce (validateResolveSpotsArgs already enforced ≤20 + nonce presence).
  const staged = mapsItemsToStaged(
    items.map((it) => ({ name: it.name, address: it.address })),
    MAPS_LIST_CAP,
  );
  const placeSignal = deadline.stageSignal(2500);
  const {
    places,
    typeRejectedByIndex,
    typeRejectedCount,
    decisionsByIndex,
    throttled,
  } = await resolveStagedPlacesParallel(
    supabase,
    staged,
    authHeader,
    supabaseUrl,
    supabaseAnonKey,
    placeSignal,
  );

  // ── M3: an inner places-search throttle surfaces as 503 (NOT 429) so the drain
  // treats it as a resumable transient, never a budget-exhaustion ghost-degrade.
  if (throttled && !deferredProtocol) {
    return errorResponse(
      "PLACES_RATE_LIMITED",
      "Search is temporarily unavailable — try again",
      503,
    );
  }

  // ── restaurant_id is set ONLY for an existing VERIFIED DB row (mirrors the URL
  // path) — an unverified row stays unmapped so the client's save flows the
  // external_id path and the save-time upsert promotes it to verified.
  const resolvedPlaceIds = places
    .map((p) => p?.id)
    .filter((id): id is string => !!id);
  const { data: restaurantRows } = resolvedPlaceIds.length > 0
    ? await supabase.from("restaurants").select("id, external_id, verification")
      .in("external_id", resolvedPlaceIds)
    : { data: [] };
  const placeIdToRestaurantId = mapVerifiedRestaurantIds(restaurantRows ?? []);

  const results = await Promise.all(
    staged.map(async (s, i) => {
      const clientNonce = items[i].client_nonce;
      const candidateId = await computeCandidateId(
        importNonce,
        normalizeName(s.extracted.name),
        i,
      );
      if (typeRejectedByIndex[i]) {
        // Keep the nonce echo 1:1 so chunk accounting remains deterministic.
        // New clients read the typed flag and omit this row from save_spots.
        // Old clients preserve `place` verbatim, so the nested marker reaches
        // handleSaveSpots's pre-write compatibility guard.
        return {
          client_nonce: clientNonce,
          candidate_id: candidateId,
          restaurant_id: null,
          external_id: null,
          restaurant_name: s.extracted.name,
          restaurant_city: s.extracted.city,
          area: s.extracted.area ?? null,
          place: { type_rejected: true as const },
          confidence: "low" as Confidence,
          ghost: false,
          type_rejected: true as const,
          resolution_decision: "no_result" as const,
        };
      }
      const place = places[i];
      if (place && place.id) {
        const restaurant: PlacesPayload = {
          ...place,
          external_id: place.id,
          location: {
            address: place.formattedAddress ?? undefined,
            locality: place.city ?? undefined,
            country: place.country ?? undefined,
          },
        };
        return {
          client_nonce: clientNonce,
          candidate_id: candidateId,
          restaurant_id: placeIdToRestaurantId.get(place.id) ?? null,
          external_id: place.id,
          restaurant_name: place.name,
          restaurant_city: place.city,
          area: s.extracted.area ?? null,
          place: restaurant,
          confidence: "high" as Confidence,
          ghost: false,
          resolution_decision: "matched" as const,
        };
      }
      // Ghost — no Places match (similarity-gate miss / no result). Client saves
      // it as a ghost via save_spots (external_id null) and marks it needsLook.
      const ghostPayload: PlacesPayload = {
        id: "",
        name: s.extracted.name,
        formattedAddress: s.extracted.address,
        city: s.extracted.city,
        country: null,
        latitude: null,
        longitude: null,
        categories: [],
        cuisine: s.extracted.cuisine,
        googleRating: null,
        googleRatingCount: null,
        priceLevel: null,
        photoReference: null,
        website: null,
        link: null,
        external_id: null,
        location: {
          address: s.extracted.address ?? undefined,
          locality: s.extracted.city ?? undefined,
        },
      };
      return {
        client_nonce: clientNonce,
        candidate_id: candidateId,
        restaurant_id: null,
        external_id: null,
        restaurant_name: s.extracted.name,
        restaurant_city: s.extracted.city,
        area: s.extracted.area ?? null,
        place: ghostPayload,
        confidence: "low" as Confidence,
        ghost: true,
        resolution_decision: decisionsByIndex[i] ?? "transient",
      };
    }),
  );

  return jsonResponse({
    data: {
      results,
      ghost_mode: false,
      type_rejected: typeRejectedCount,
    },
  });
}

// ── Main pipeline (TICKET-063 multi-candidate URL path) ───────────────────────

async function handleUrlResolve(
  supabase: any,
  user: { id: string },
  rawUrl: string,
  parsedUrl: URL,
  sourceType: SourceType,
  caption: string | null,
  authHeader: string,
  supabaseUrl: string,
  supabaseAnonKey: string,
  // TICKET-152: the client advertises large-list support. When set AND the
  // parsed Maps list exceeds the sync cap, we enumerate (name+address only) and
  // hand the list back for the client-pumped chunked job — no Places spend here.
  supportsLargeLists = false,
): Promise<Response> {
  // 086c: 8s → 12s. The 2.5s text-LLM stage aborted routinely, silently
  // falling back to a raw 3-place caption search — the founder's "3 random
  // spots" runs. This path also serves the background import queue, where
  // wall time is invisible; the interactive sheet shows a spinner.
  const deadline = new Deadline(12000);

  let query: string | null = null;
  let notePrefill = "";
  let partialSource: Omit<WishlistSourceTikTok, "type" | "url"> | null = null;
  let thumbnailUrl: string | null = null;
  let oEmbedCaption: string | null = null;
  // Set when the maps URL resolves to a shared LIST (multi-spot import).
  let mapsList: ParsedMapsList | null = null;

  // ── Step 1: source-specific query extraction ──────────────────────────────
  if (sourceType === "tiktok") {
    if (deadline.aborted) {
      return errorResponse("TIMEOUT", "Resolver timed out", 503);
    }
    let oEmbed: Awaited<ReturnType<typeof fetchTikTokOEmbed>> = null;
    try {
      oEmbed = await fetchTikTokOEmbed(rawUrl, deadline.stageSignal(2500));
    } catch (e: any) {
      if (e?.name === "AbortError" || deadline.aborted) {
        return errorResponse("TIMEOUT", "Resolver timed out", 503);
      }
      if (e?.code === "UPSTREAM_RATE_LIMITED") {
        return errorResponse(
          "UPSTREAM_RATE_LIMITED",
          "TikTok is busy — try again in a minute",
          503,
        );
      }
      return errorResponse(
        "UPSTREAM_UNAVAILABLE",
        "Could not reach TikTok — try again",
        503,
      );
    }

    if (oEmbed) {
      notePrefill = captionToNote(oEmbed.title);
      oEmbedCaption = oEmbed.title;
      const firstLine = oEmbed.title.split(/\n/)[0].trim();
      query = firstLine.length > 0 ? firstLine : oEmbed.title;
      thumbnailUrl = oEmbed.thumbnail_url ?? null;

      const partial: Omit<WishlistSourceTikTok, "type" | "url"> = {};
      if (oEmbed.thumbnail_url) partial.thumbnail_url = oEmbed.thumbnail_url;
      if (oEmbed.author_unique_id) {
        partial.author_handle = oEmbed.author_unique_id;
      }
      if (oEmbed.author_name) partial.author_name = oEmbed.author_name;
      if (oEmbed.embed_product_id) {
        partial.embed_product_id = oEmbed.embed_product_id;
      }
      partialSource = partial;
    }
  } else if (sourceType === "google_maps") {
    // Already-expanded links: parse directly.
    query = parsePlaceFromMapsUrl(rawUrl);
    // Share links (maps.app.goo.gl/…) are short redirects with no place
    // segment — follow the redirect to a single place OR a shared list.
    if (!query) {
      const expanded = await expandMapsShare(
        rawUrl,
        (ms) => deadline.stageSignal(ms),
      );
      if (expanded.list && expanded.list.items.length > 0) {
        mapsList = expanded.list;
      } else {
        query = expanded.placeQuery;
      }
    }
  } else if (isWebExtractionSource(sourceType)) {
    // TICKET-079: 'web' + reddit/substack all unfurl the page <title> here.
    const title = await unfurlWebTitle(rawUrl, deadline.stageSignal(2000))
      .catch(() => null);
    if (title) {
      query = title.replace(/\s*[\|—\-]\s*.+$/, "").trim();
      oEmbedCaption = title;
    }
  }

  // ── Step 1b: large-list short-circuit (TICKET-152) ────────────────────────
  // A Maps list exceeding the sync cap, when the client advertises
  // supports_large_lists, is ENUMERATED here (every {name,address}, uncapped) and
  // handed back for the client-pumped chunked import job — with NO Places call on
  // this invocation. The discriminator is `mode: 'large_list'` (its absence ⇒ an
  // old server / the sub-cap path). Nested inside `data` (callEdgeFn strips the
  // outer envelope, dropping any sibling top-level fields). Old clients never send
  // the flag → fall through to today's ≤20 truncated resolution, byte-for-byte.
  if (mapsList && mapsList.items.length > MAPS_LIST_CAP && supportsLargeLists) {
    return jsonResponse({
      data: {
        source_type: sourceType,
        mode: "large_list",
        title: mapsList.title,
        items: mapsList.items.map((it) => ({
          name: it.name,
          address: it.address,
        })),
        list_count: mapsList.items.length,
      },
    });
  }

  // ── Step 2: cache check ───────────────────────────────────────────────────
  const contentHash = await hashTextSource(rawUrl, oEmbedCaption);
  const modelId = Deno.env.get("EXTRACTION_MODEL") ??
    "claude-haiku-4-5-20251001";

  let textCandidates: ExtractedCandidate[] = [];
  let visionCandidates: ExtractedCandidate[] = [];
  let fromCache = false;

  // Maps lists bypass the extraction cache entirely: lists are mutable (the
  // sharer adds spots), and the items are deterministic — nothing to cache.
  const cached = mapsList
    ? null
    : await readExtractionCache(supabase, contentHash);
  if (cached && cached.length > 0) {
    textCandidates = cached;
    fromCache = true;
  }

  // ── Step 3: text-tier extraction ──────────────────────────────────────────
  if (!fromCache && oEmbedCaption && !deadline.aborted) {
    try {
      const extracted = await extractFromTextMulti(
        oEmbedCaption,
        deadline.stageSignal(5000),
      );
      textCandidates = extracted;
    } catch (e: any) {
      if (e?.name === "AbortError") {
        // Budget exhausted — proceed with empty (degrade gracefully)
      }
    }
  }

  // ── Step 4: listicle detection + vision trigger ───────────────────────────
  const captionForListicle = oEmbedCaption ?? query ?? "";
  const listMarker = detectListMarker(captionForListicle);
  const highConfCount =
    textCandidates.filter((c) =>
      c.confidence === "high" || c.confidence === "exact"
    ).length;

  const needsVision = thumbnailUrl &&
    !fromCache &&
    !deadline.aborted &&
    (
      highConfCount === 0 ||
      (listMarker.isList &&
        textCandidates.length < Math.min(listMarker.count ?? 6, 6))
    );

  if (needsVision && thumbnailUrl) {
    // Fetch + resize thumbnail (ARCH-REVIEW-2 #11: skip vision if resize fails)
    const resized = await fetchAndResizeThumbnail(
      thumbnailUrl,
      deadline.stageSignal(2000),
    );
    if (resized && !deadline.aborted) {
      try {
        const vExtracted = await extractFromVisionMulti(
          resized.base64,
          resized.mimeType,
          oEmbedCaption ?? undefined,
          deadline.stageSignal(2500),
        );
        visionCandidates = vExtracted;
      } catch {
        // Vision failed — text-tier results stand
      }
    }
    // If resized is null (ARCH-REVIEW-2 #11): vision skipped entirely
  }

  // ── Step 5: merge + dedupe + rank + cap ───────────────────────────────────
  // 6 for model-extracted URL shares; a deterministic maps LIST gets the
  // save_spots-aligned ceiling and stages DIRECTLY — the fuzzy fold merges
  // same-name branches ("Dishoom" vs "Dishoom Shoreditch"), which are
  // distinct list items here. True dupes still collapse post-Places.
  const stagedCap = mapsList ? MAPS_LIST_CAP : 6;
  const staged = mapsList
    ? mapsItemsToStaged(mapsList.items, MAPS_LIST_CAP)
    : dedupeAndRank(textCandidates, visionCandidates, stagedCap);

  // ── Step 6: cache write (content-derived only, before Places) ────────────
  if (!fromCache && staged.length > 0 && !mapsList) {
    const cacheArr = staged.map((s) => s.extracted);
    writeExtractionCache(
      supabase,
      contentHash,
      rawUrl,
      cacheArr,
      modelId,
      oEmbedCaption,
    )
      .catch(() => null);
  }

  // ── Step 7: per-candidate Places resolution (parallel ≤6) ────────────────
  // Short-circuit candidates with existing google_place_id via DB lookup (free).
  // Google-Maps source type: don't run model extraction; use direct Places search.
  let resolvedPlaces: (PlacesPayload | null)[] = [];

  if (sourceType === "google_maps" && query) {
    // Google Maps: single Places search, no model extraction needed
    let typeRejectedCount = 0;
    try {
      const search = await callImportPlacesSearch(
        query,
        authHeader,
        supabaseUrl,
        supabaseAnonKey,
        deadline.stageSignal(2500),
      );
      typeRejectedCount = search.typeRejected ? 1 : 0;
      resolvedPlaces = search.candidates.slice(0, 3).map((r) => r);
    } catch {
      resolvedPlaces = [];
    }

    // Map to PlacesPayload[] for the canonical resolution path below
    const googlePlaceIds = resolvedPlaces.filter(Boolean).map((p) => p!.id);
    const { data: restaurantRows } = googlePlaceIds.length > 0
      ? await supabase.from("restaurants").select("id, external_id").in(
        "external_id",
        googlePlaceIds,
      )
      : { data: [] };

    const placeIdToRestaurantId = new Map<string, string>();
    for (const row of (restaurantRows ?? [])) {
      if (row.external_id) placeIdToRestaurantId.set(row.external_id, row.id);
    }

    const knownRestaurantIds = [...placeIdToRestaurantId.values()];
    const wishlistedSet = new Set<string>();
    if (knownRestaurantIds.length > 0) {
      const { data: wishlistRows } = await supabase
        .from("wishlist_items")
        .select("restaurant_id")
        .eq("user_id", user.id)
        .in("restaurant_id", knownRestaurantIds);
      for (const row of (wishlistRows ?? [])) {
        if (row.restaurant_id) wishlistedSet.add(row.restaurant_id);
      }
    }

    const candidates: ResolvedCandidate[] = await Promise.all(
      (resolvedPlaces.filter(Boolean) as PlacesPayload[]).slice(0, 3).map(
        async (place, idx) => {
          const restaurantId = placeIdToRestaurantId.get(place.id) ?? null;
          const alreadyWishlisted = restaurantId
            ? wishlistedSet.has(restaurantId)
            : false;
          // FIX #6: Google Maps URL parse is a deterministic source → 'exact' for top result.
          // Confidence enum: exact = deterministic source (google_maps URL parse or visible place_id).
          const confidence: Confidence = idx === 0 ? "exact" : "low";
          const restaurant: PlacesPayload = {
            ...place,
            external_id: place.id,
            location: {
              address: place.formattedAddress ?? undefined,
              locality: place.city ?? undefined,
              country: place.country ?? undefined,
            },
          };
          const candidateId = await computeCandidateId(
            contentHash,
            normalizeName(place.name),
            idx,
          );
          return {
            candidate_id: candidateId,
            restaurant,
            confidence,
            google_place_id: place.id,
            restaurant_id: restaurantId,
            already_wishlisted: alreadyWishlisted,
            city_inferred: false,
            area: null,
          };
        },
      ),
    );

    return jsonResponse({
      data: {
        source_type: sourceType,
        best_query: query,
        note_prefill: notePrefill,
        candidates,
        partial_source: partialSource,
        // TICKET-152 P2-4: a google_maps SINGLE-place resolve must not emit
        // the ≤6 listicle-heuristic denominator (it is a fake "N of M" for a
        // lone place). Omit it so clients never render a phantom count.
        list_count: null,
        type_rejected: typeRejectedCount,
      } satisfies ResolveUrlResponse,
    });
  }

  // For non-Maps sources: resolve staged candidates in parallel
  if (staged.length === 0) {
    // No candidates from model extraction — fall back to old direct Places search
    if (!query) {
      return jsonResponse({
        data: {
          source_type: sourceType,
          best_query: null,
          note_prefill: notePrefill,
          candidates: [],
          partial_source: partialSource,
          list_count: listMarker.count,
        } satisfies ResolveUrlResponse,
      });
    }

    // Direct Places search on the caption-derived query
    let placeCandidates: PlacesPayload[] = [];
    let typeRejectedCount = 0;
    try {
      const search = await callImportPlacesSearch(
        query,
        authHeader,
        supabaseUrl,
        supabaseAnonKey,
        deadline.stageSignal(2500),
      );
      placeCandidates = search.candidates;
      typeRejectedCount = search.typeRejected ? 1 : 0;
    } catch (e: any) {
      if (e?.code === "PLACES_RATE_LIMITED") {
        return errorResponse(
          "PLACES_RATE_LIMITED",
          "Search is temporarily unavailable — try again",
          503,
        );
      }
      if (deadline.aborted) {
        return errorResponse("TIMEOUT", "Resolver timed out", 503);
      }
      return errorResponse(
        "UPSTREAM_UNAVAILABLE",
        "Could not complete search — try again",
        503,
      );
    }

    return buildLegacyCandidateResponse(
      supabase,
      user,
      placeCandidates,
      sourceType,
      query,
      notePrefill,
      partialSource,
      contentHash,
      listMarker.count,
      typeRejectedCount,
    );
  }

  // Resolve staged model candidates to Places in parallel (≤6) via the shared
  // core (TICKET-152). `throttled` is ignored here: a throttled candidate stays
  // null → ghost, byte-for-byte the prior inline `catch → null` behavior.
  const placeSignal = deadline.stageSignal(2500);
  const {
    places: placeResults,
    typeRejectedByIndex,
    typeRejectedCount,
    decisionsByIndex,
  } = await resolveStagedPlacesParallel(
    supabase,
    staged,
    authHeader,
    supabaseUrl,
    supabaseAnonKey,
    placeSignal,
  );

  // ── Step 8: post-Places dedupe by google_place_id ─────────────────────────
  const seenPlaceIds = new Set<string>();
  const dedupedStaged: Array<{
    staged: typeof staged[0];
    place: PlacesPayload | null;
    decision: ImportResolutionDecision;
  }> = [];
  for (let i = 0; i < staged.length; i++) {
    // Unlike an ordinary no-match/name/locality miss (which remains a
    // reviewable ghost), a non-food Places top result is scene-text noise and
    // must never reach the candidate staging queue.
    if (typeRejectedByIndex[i]) continue;
    const place = placeResults[i];
    const placeId = place?.id ?? staged[i].extracted.google_place_id;
    if (placeId && seenPlaceIds.has(placeId)) continue;
    if (placeId) seenPlaceIds.add(placeId);
    dedupedStaged.push({
      staged: staged[i],
      place,
      decision: decisionsByIndex[i] ?? "transient",
    });
  }

  // ── Step 9: wishlist dedupe ───────────────────────────────────────────────
  const allPlaceIds = dedupedStaged
    .map((d) => d.place?.id)
    .filter(Boolean) as string[];

  const { data: restaurantRows } = allPlaceIds.length > 0
    ? await supabase.from("restaurants").select("id, external_id, verification")
      .in("external_id", allPlaceIds)
    : { data: [] };

  // ROUND-3 FIX: map ONLY verified rows. Mapping an unverified (stale ghost)
  // row here hands the client a restaurant_id, the client then nulls
  // external_id, and the save path skips the verified upsert — the repair
  // never happens. Unverified rows stay unmapped so the candidate flows the
  // external_id path and save-time upsert promotes the SAME row (ON CONFLICT
  // external_id) to verified with full metadata.
  const placeIdToRestaurantId = mapVerifiedRestaurantIds(restaurantRows ?? []);

  const knownRestaurantIds = [...placeIdToRestaurantId.values()];
  const wishlistedSet = new Set<string>();
  if (knownRestaurantIds.length > 0) {
    const { data: wishlistRows } = await supabase
      .from("wishlist_items")
      .select("restaurant_id")
      .eq("user_id", user.id)
      .in("restaurant_id", knownRestaurantIds);
    for (const row of (wishlistRows ?? [])) {
      if (row.restaurant_id) wishlistedSet.add(row.restaurant_id);
    }
  }

  // ── Step 10: build candidates[] ──────────────────────────────────────────
  const candidates: ResolvedCandidate[] = await Promise.all(
    dedupedStaged.slice(0, stagedCap).map(
      async ({ staged: s, place, decision }, idx) => {
        const restaurantId = place
          ? (placeIdToRestaurantId.get(place.id) ?? null)
          : null;
        const alreadyWishlisted = restaurantId
          ? wishlistedSet.has(restaurantId)
          : false;
        // 086c: 'exact' was being demoted to 'low' here for no reason.
        const confidence: Confidence = s.extracted.confidence === "high" ||
            s.extracted.confidence === "exact"
          ? "high"
          : "low";
        const candidateId = await computeCandidateId(
          contentHash,
          normalizeName(s.extracted.name),
          idx,
        );

        const restaurant: PlacesPayload = place
          ? {
            ...place,
            external_id: place.id,
            location: {
              address: place.formattedAddress ?? undefined,
              locality: place.city ?? undefined,
              country: place.country ?? undefined,
            },
          }
          : {
            // FIX #2: ghost candidates use external_id=null (not 'ghost_pending').
            // The RPC mints 'ghost_{user}_{nonce}' at save time for true ghosts.
            id: "",
            name: s.extracted.name,
            formattedAddress: s.extracted.address,
            city: s.extracted.city,
            country: null,
            latitude: null,
            longitude: null,
            categories: [],
            cuisine: s.extracted.cuisine,
            googleRating: null,
            googleRatingCount: null,
            priceLevel: null,
            photoReference: null,
            website: null,
            link: null,
            external_id: null,
            location: {
              address: s.extracted.address ?? undefined,
              locality: s.extracted.city ?? undefined,
            },
          };

        return {
          candidate_id: candidateId,
          restaurant,
          confidence,
          // FIX #2: google_place_id is null for unresolved ghosts.
          google_place_id: place?.id ?? null,
          restaurant_id: restaurantId,
          already_wishlisted: alreadyWishlisted,
          city_inferred: s.extracted.city_inferred,
          area: s.extracted.area ?? null,
          stance: s.extracted.stance ?? null,
          resolution_decision: decision,
          attempted_external_id:
            decision === "transient" || decision === "unattempted_budget"
              ? s.extracted.google_place_id ?? null
              : null,
        };
      },
    ),
  );

  // best_query = top candidate name + city (or cleaned caption fallback)
  const topCandidate = dedupedStaged[0]?.staged.extracted;
  const bestQuery = topCandidate?.name
    ? [topCandidate.name, topCandidate.city].filter(Boolean).join(", ")
    : query;

  return jsonResponse({
    data: {
      source_type: sourceType,
      best_query: bestQuery,
      note_prefill: notePrefill,
      candidates,
      partial_source: partialSource,
      // Maps list: the TRUE item count, so the client can say "20 of 34".
      list_count: mapsList ? mapsList.items.length : listMarker.count,
      type_rejected: typeRejectedCount,
    } satisfies ResolveUrlResponse,
  });
}

/**
 * Build the legacy (pre-model) candidates response for the old direct-Places path.
 * Used when model extraction yields zero candidates and we fall back to raw query search.
 */
async function buildLegacyCandidateResponse(
  supabase: any,
  user: { id: string },
  placeCandidates: PlacesPayload[],
  sourceType: SourceType,
  query: string,
  notePrefill: string,
  partialSource: Omit<WishlistSourceTikTok, "type" | "url"> | null,
  contentHash: string,
  listCount: number | null,
  typeRejectedCount: number,
): Promise<Response> {
  if (placeCandidates.length === 0) {
    return jsonResponse({
      data: {
        source_type: sourceType,
        best_query: query,
        note_prefill: notePrefill,
        candidates: [],
        partial_source: partialSource,
        list_count: listCount,
        type_rejected: typeRejectedCount,
      } satisfies ResolveUrlResponse,
    });
  }

  const googlePlaceIds = placeCandidates.map((p) => p.id).filter(Boolean);
  const { data: restaurantRows } = await supabase
    .from("restaurants")
    .select("id, external_id")
    .in("external_id", googlePlaceIds);

  const placeIdToRestaurantId = new Map<string, string>();
  for (const row of (restaurantRows ?? [])) {
    if (row.external_id) placeIdToRestaurantId.set(row.external_id, row.id);
  }

  const knownRestaurantIds = [...placeIdToRestaurantId.values()];
  const wishlistedSet = new Set<string>();
  if (knownRestaurantIds.length > 0) {
    const { data: wishlistRows } = await supabase
      .from("wishlist_items")
      .select("restaurant_id")
      .eq("user_id", user.id)
      .in("restaurant_id", knownRestaurantIds);
    for (const row of (wishlistRows ?? [])) {
      if (row.restaurant_id) wishlistedSet.add(row.restaurant_id);
    }
  }

  const topN = placeCandidates.slice(0, 3);
  const candidates: ResolvedCandidate[] = await Promise.all(
    topN.map(async (place, idx): Promise<ResolvedCandidate> => {
      const restaurantId = placeIdToRestaurantId.get(place.id) ?? null;
      const alreadyWishlisted = restaurantId
        ? wishlistedSet.has(restaurantId)
        : false;
      let confidence: Confidence = "low";
      if (idx === 0 && (place.googleRatingCount ?? 0) > 50) confidence = "high";
      const restaurant: PlacesPayload = {
        ...place,
        external_id: place.id,
        location: {
          address: place.formattedAddress ?? undefined,
          locality: place.city ?? undefined,
          country: place.country ?? undefined,
        },
      };
      const candidateId = await computeCandidateId(
        contentHash,
        normalizeName(place.name),
        idx,
      );
      return {
        candidate_id: candidateId,
        restaurant,
        confidence,
        google_place_id: place.id,
        restaurant_id: restaurantId,
        already_wishlisted: alreadyWishlisted,
        city_inferred: false,
        area: null,
      };
    }),
  );

  return jsonResponse({
    data: {
      source_type: sourceType,
      best_query: query,
      note_prefill: notePrefill,
      candidates,
      partial_source: partialSource,
      list_count: listCount,
      type_rejected: typeRejectedCount,
    } satisfies ResolveUrlResponse,
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * TICKET-082 — resolve restaurants from on-device-extracted video text.
 *
 * The client runs Vision OCR (frame overlays) + Speech transcription (voiceover)
 * on the phone and POSTs the combined text. We feed it through the SAME
 * multi-candidate text extractor the TikTok caption path uses, then resolve each
 * candidate to a Place. Mirrors handleUrlResolve's text-tier + resolution
 * (steps 3,5,7–10) minus oEmbed/thumbnail-vision/deadline-budget — the heavy
 * perception already happened for free on-device. Cap raised to 12 (listicles
 * routinely run to 10–11 spots, vs the URL path's 6).
 */
async function handleVideoText(
  supabase: any,
  user: { id: string },
  extractedText: string,
  caption: string | null,
  authHeader: string,
  supabaseUrl: string,
  supabaseAnonKey: string,
  photoContext?: PhotoExtractionContext,
): Promise<Response> {
  const sourceType: SourceType = "video";
  const notePrefill = caption ? captionToNote(caption) : "";
  // Photo and video listicles share one numeric ceiling. A validated photo slide
  // count remains prompt/cache context only; it never truncates candidates.
  const photoSlideCount = validPhotoSlideCount(photoContext);
  const CAP = LISTICLE_CANDIDATE_CAP;

  // TICKET-209: the caption is GROUND TRUTH, not a hint. It rides in its own
  // labeled section (budgeted separately so a long caption can't evict the OCR
  // channel), and when it enumerates its own spot count that count becomes a
  // real ceiling. The cheap tier (TICKET-164 fast path) sends caption=desc +
  // extracted_text=transcript, so this fusion is still [desc, transcript] —
  // never double-fused (R6).
  const { fullText, hasVideoText } = buildVideoFusion(caption, extractedText);
  // Derived from the caption BODY FIELD only (never the fused text, never OCR),
  // and never in photo mode — see deriveCaptionCap for the TICKET-204 rationale.
  // An INVALID photo context still counts as photo mode: it keeps today's
  // "photo request, generic prompt" behaviour byte-for-byte.
  const hasPhotoContext = photoContext !== undefined;
  const captionCap = deriveCaptionCap(caption, hasPhotoContext);
  const effectiveCap = captionCap ?? CAP;
  // captionPresent gates the entire video prompt block: a no-caption body (old
  // client / paste sheet / shared-.mov) has NO labeled sections painted, so it
  // must run on the pre-209 generic prompt — labeled-section rules against
  // unlabeled text would judge the fused caption as OCR noise.
  const captionPresent = typeof caption === "string" &&
    caption.trim().length > 0;
  const extractionContext: ExtractionContext = hasPhotoContext
    ? photoContext
    : { sourceKind: "video", captionPresent, hasVideoText, captionCap };
  const listMarker = detectListMarker(fullText);
  // TICKET-164: the count gate reads the UNCLAMPED total, computed CAPTION-FIRST
  // (a "top 12" marker lives in the caption; the spoken transcript's stray
  // numbers must not drive it). Falls back to fullText when no caption body field
  // was sent (escalation / music-only clip). null = no marker → gate passes.
  const listCountRaw = detectListMarker(caption || fullText).countRaw;

  // Content hash for cache + stable candidate ids (re-importing a clip is free).
  // Namespace photo rows by mode + validated count + candidate-cap contract.
  // Including the cap invalidates TICKET-195 rows that were already truncated to
  // slide count; otherwise a repeat import would bypass this fix via cache.
  // TICKET-209: BOTH namespaces gain the `g2` extraction-contract token (the
  // prompt's caption-authority/noise blocks changed video AND photo results),
  // and the video namespace ALWAYS embeds the effective cap — including the
  // default 12 — so a future cap-derivation change can never serve stale rows.
  const cacheNamespace = photoSlideCount === null
    ? `video:g2:cap${effectiveCap}`
    : `photo:listicle-${CAP}:g2:${photoSlideCount}`;
  const hashBuf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${cacheNamespace}:${fullText}`)
      .buffer as ArrayBuffer,
  );
  const contentHash = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const modelId = Deno.env.get("EXTRACTION_MODEL") ??
    "claude-haiku-4-5-20251001";

  let textCandidates = await readExtractionCache(supabase, contentHash);
  if (!textCandidates || textCandidates.length === 0) {
    // Bound the (paid) model call — URL path uses a deadline budget; here we
    // didn't pay for on-device perception, but a hung extraction still needs
    // a graceful ceiling.
    const extractAc = new AbortController();
    // 086c: 7s → 15s. A 12-candidate haiku response (now with a retry on
    // malformed JSON) can exceed 7s; an abort here silently returned []
    // and the whole import read as "no spots found".
    const extractTimer = setTimeout(() => extractAc.abort(), 15000);
    try {
      textCandidates = await extractFromTextMulti(
        fullText,
        extractAc.signal,
        effectiveCap,
        extractionContext,
      );
    } catch {
      textCandidates = [];
    } finally {
      clearTimeout(extractTimer);
    }
    if (textCandidates.length > 0) {
      writeExtractionCache(
        supabase,
        contentHash,
        null,
        textCandidates,
        modelId,
        fullText,
      )
        .catch(() => null);
    }
  }

  // Video and photo listicles stay at 12 unless the caption declared fewer.
  // dedupeAndRank's default cap is 6 (right for the URL path), so this path
  // passes the effective listicle cap explicitly — one of the four layers
  // (prompt · parser · dedupe · final slice) that must agree.
  const staged = dedupeAndRank(textCandidates ?? [], [], effectiveCap);
  if (staged.length === 0) {
    return jsonResponse({
      data: {
        source_type: sourceType,
        best_query: null,
        note_prefill: notePrefill,
        candidates: [],
        partial_source: null,
        list_count: listMarker.count,
        list_count_raw: listCountRaw,
        type_rejected: 0,
        caption_cap: captionCap,
      } satisfies ResolveUrlResponse,
    });
  }

  // Resolve each candidate to a Place in parallel (bounded).
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 9000);
  let placeResults: (PlacesPayload | null)[] = [];
  let typeRejectedByIndex: boolean[] = [];
  let decisionsByIndex: ImportResolutionDecision[] = [];
  let typeRejectedCount = 0;
  try {
    const resolution = await resolveStagedPlacesParallel(
      supabase,
      staged,
      authHeader,
      supabaseUrl,
      supabaseAnonKey,
      ac.signal,
    );
    placeResults = resolution.places;
    typeRejectedByIndex = resolution.typeRejectedByIndex;
    decisionsByIndex = resolution.decisionsByIndex;
    typeRejectedCount = resolution.typeRejectedCount;
  } finally {
    clearTimeout(timer);
  }

  // Post-Places dedupe by google_place_id.
  const seenPlaceIds = new Set<string>();
  const deduped: Array<{
    s: StagedCandidate;
    place: PlacesPayload | null;
    decision: ImportResolutionDecision;
  }> = [];
  for (let i = 0; i < staged.length; i++) {
    if (typeRejectedByIndex[i]) continue;
    const place = placeResults[i];
    const placeId = place?.id ?? staged[i].extracted.google_place_id;
    if (placeId && seenPlaceIds.has(placeId)) continue;
    if (placeId) seenPlaceIds.add(placeId);
    deduped.push({
      s: staged[i],
      place,
      decision: decisionsByIndex[i] ?? "transient",
    });
  }

  // Map verified restaurants + wishlist dedupe.
  const allPlaceIds = deduped.map((d) => d.place?.id).filter(
    Boolean,
  ) as string[];
  const { data: restaurantRows } = allPlaceIds.length > 0
    ? await supabase.from("restaurants").select("id, external_id, verification")
      .in("external_id", allPlaceIds)
    : { data: [] };
  const placeIdToRestaurantId = mapVerifiedRestaurantIds(restaurantRows ?? []);

  const knownRestaurantIds = [...placeIdToRestaurantId.values()];
  const wishlistedSet = new Set<string>();
  if (knownRestaurantIds.length > 0) {
    const { data: wishlistRows } = await supabase
      .from("wishlist_items")
      .select("restaurant_id")
      .eq("user_id", user.id)
      .in("restaurant_id", knownRestaurantIds);
    for (const row of (wishlistRows ?? [])) {
      if (row.restaurant_id) wishlistedSet.add(row.restaurant_id);
    }
  }

  const candidates: ResolvedCandidate[] = await Promise.all(
    deduped.slice(0, effectiveCap).map(async ({ s, place, decision }, idx) => {
      const restaurantId = place
        ? (placeIdToRestaurantId.get(place.id) ?? null)
        : null;
      const alreadyWishlisted = restaurantId
        ? wishlistedSet.has(restaurantId)
        : false;
      // 086c: 'exact' was being demoted to 'low' here for no reason.
      const confidence: Confidence =
        s.extracted.confidence === "high" || s.extracted.confidence === "exact"
          ? "high"
          : "low";
      const candidateId = await computeCandidateId(
        contentHash,
        normalizeName(s.extracted.name),
        idx,
      );
      const restaurant: PlacesPayload = place
        ? {
          ...place,
          external_id: place.id,
          location: {
            address: place.formattedAddress ?? undefined,
            locality: place.city ?? undefined,
            country: place.country ?? undefined,
          },
        }
        : {
          id: "",
          name: s.extracted.name,
          formattedAddress: s.extracted.address,
          city: s.extracted.city,
          country: null,
          latitude: null,
          longitude: null,
          categories: [],
          cuisine: s.extracted.cuisine,
          googleRating: null,
          googleRatingCount: null,
          priceLevel: null,
          photoReference: null,
          website: null,
          link: null,
          external_id: null,
          location: {
            address: s.extracted.address ?? undefined,
            locality: s.extracted.city ?? undefined,
          },
        };
      return {
        candidate_id: candidateId,
        restaurant,
        confidence,
        google_place_id: place?.id ?? null,
        restaurant_id: restaurantId,
        already_wishlisted: alreadyWishlisted,
        city_inferred: s.extracted.city_inferred,
        area: s.extracted.area ?? null,
        stance: s.extracted.stance ?? null,
        resolution_decision: decision,
        attempted_external_id:
          decision === "transient" || decision === "unattempted_budget"
            ? s.extracted.google_place_id ?? null
            : null,
      };
    }),
  );

  const top = deduped[0]?.s.extracted;
  const bestQuery = top?.name
    ? [top.name, top.city].filter(Boolean).join(", ")
    : null;

  return jsonResponse({
    data: {
      source_type: sourceType,
      best_query: bestQuery,
      note_prefill: notePrefill,
      candidates,
      partial_source: null,
      list_count: listMarker.count,
      list_count_raw: listCountRaw,
      type_rejected: typeRejectedCount,
      caption_cap: captionCap,
    } satisfies ResolveUrlResponse,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("METHOD_NOT_ALLOWED", "POST only", 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let body: {
    url?: string;
    image_path?: string;
    /** TICKET-082: on-device video OCR + voiceover transcript (text-only path). */
    extracted_text?: string;
    /** TICKET-195: additive photo-carousel extraction context. */
    source_kind?: string;
    slide_count?: number;
    caption?: string;
    action?: string;
    job_id?: string;
    import_nonce?: string;
    spots?: unknown[];
    source?: unknown;
    note?: string;
    /** TICKET-123: opt-in — write the durable import_done inbox row on this save. */
    notify_done?: boolean;
    /** TICKET-152: save_spots — pin to the personal wishlist (default true). */
    pin_wishlist?: boolean;
    /** TICKET-152: resolve_spots — the drain chunk of {name,address,client_nonce}. */
    items?: unknown[];
    /** TICKET-152: URL resolve — client can handle the large-list job path. */
    supports_large_lists?: boolean;
    /** Durable-manifest owner fence; optional only for deployed-client compatibility. */
    expected_owner_id?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return errorResponse("INVALID_BODY", "Request body must be JSON", 400);
  }

  // ── [N1] Async extract action — INTERNAL ONLY ─────────────────────────────
  if (body?.action === "extract" && body?.job_id) {
    const INTERNAL_CALL_SECRET = Deno.env.get("INTERNAL_CALL_SECRET") ?? "";
    const callerSecret = req.headers.get("x-internal-secret") ?? "";

    if (
      !INTERNAL_CALL_SECRET ||
      !timingSafeEqual(
        new TextEncoder().encode(callerSecret),
        new TextEncoder().encode(INTERNAL_CALL_SECRET),
      )
    ) {
      return errorResponse(
        "UNAUTHORIZED",
        "Invalid or missing internal secret",
        401,
      );
    }

    const { data: jobRow } = await supabase
      .from("import_jobs")
      .select("user_id")
      .eq("job_id", body.job_id)
      .maybeSingle();
    if (!jobRow?.user_id) {
      return errorResponse("JOB_NOT_FOUND", "Import job not found", 404);
    }
    const jobOwnerId = jobRow.user_id as string;

    return await handleAsyncExtract(
      supabase,
      true,
      jobOwnerId,
      body.job_id,
      supabaseUrl,
      supabaseAnonKey,
      `Bearer ${supabaseServiceKey}`,
      INTERNAL_CALL_SECRET,
    );
  }

  // ── Auth — all non-internal paths require a valid user JWT ────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return errorResponse("UNAUTHORIZED", "Missing Authorization header", 401);
  }

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: userError } = await supabase.auth.getUser(
    token,
  );
  if (userError || !user) {
    return errorResponse("UNAUTHORIZED", "Unauthorized", 401);
  }

  const expectedOwner = expectedImportOwnerDecision(
    body?.expected_owner_id,
    user.id,
  );
  if (expectedOwner === "invalid") {
    return errorResponse(
      "INVALID_EXPECTED_OWNER",
      "expected_owner_id must be a UUID",
      400,
    );
  }
  if (expectedOwner === "mismatch") {
    return errorResponse(
      "EXPECTED_OWNER_MISMATCH",
      "Import manifest belongs to a different signed-in account",
      403,
    );
  }

  // ── save_spots action (ARCH-REVIEW-2 #1) ──────────────────────────────────
  if (body?.action === "save_spots") {
    return handleSaveSpots(supabase, user, body as Record<string, unknown>);
  }

  // ── cache_clip_thumb action (TICKET-156) ──────────────────────────────────
  // Authenticated; the just-imported provider cover frame is cached here for
  // the On Socials rail. Fire-and-forget from the client — failure never blocks
  // the underlying save.
  if (body?.action === "cache_clip_thumb") {
    return handleCacheClipThumb(supabase, body as Record<string, unknown>);
  }

  // ── resolve_spots action (TICKET-152 — large Maps-list chunked resolution) ─
  // Routed like handleUrlResolve (threads auth + owns its own Deadline), NOT
  // save_spots-style. Its own guard order (arg validation → kill-switch → the
  // import_spots rate bucket → Places) lives inside the handler.
  if (body?.action === "resolve_spots") {
    try {
      const resolved = await handleResolveSpots(
        supabase,
        user,
        body as Record<string, unknown>,
        authHeader,
        supabaseUrl,
        supabaseAnonKey,
      );
      return await attachImportResolutionIds(
        supabase,
        user.id,
        resolved,
        body.import_nonce,
        "resolve_spots",
      );
    } catch (e: any) {
      if (e?.name === "AbortError") {
        return errorResponse("TIMEOUT", "Resolver timed out", 503);
      }
      console.error("resolve-url resolve_spots error:", e);
      reportError(e, { fn: "resolve-url", action: "resolve_spots" });
      return errorResponse("INTERNAL", "Internal server error", 500);
    }
  }

  // ── Video text path (TICKET-082): on-device OCR/transcript supplied ────────
  // The phone did the heavy perception (Vision OCR + Speech) for free; we only
  // run the cheap text extractor + Places resolution here. No URL required.
  // TICKET-209: a caption-ONLY body routes here too (every Instagram import and
  // every ASR-less TikTok) — but only when neither `url` nor `image_path` was
  // sent, because `caption` stays a first-class MODIFIER on the IG-nudge,
  // vision/screenshot and URL routes below. routesToVideoText owns that gate.
  const extractedText = typeof body?.extracted_text === "string"
    ? body.extracted_text.trim()
    : "";
  if (routesToVideoText(body)) {
    // Fail-CLOSED (TICKET-091): RPC error or missing row denies.
    const { data: rlRows, error: rlErr } = await supabase.rpc(
      "check_and_increment_rate_limit",
      {
        p_user_id: user.id,
        p_bucket_key: "resolve_url",
        p_max: 30,
        p_window_seconds: 3600,
      },
    );
    const rlRow = rlRows?.[0];
    if (rlErr || !rlRow || !rlRow.allowed) {
      if (rlErr) {
        console.error("resolve-url video-text rate check failed:", rlErr);
      }
      return jsonResponse(
        {
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests",
            details: { retry_after_seconds: rlRow?.retry_after_seconds ?? 60 },
          },
        },
        429,
      );
    }
    try {
      const photoContext: PhotoExtractionContext | undefined =
        body?.source_kind === "photo" && typeof body?.slide_count === "number"
          ? { sourceKind: "photo", slideCount: body.slide_count }
          : undefined;
      const resolved = await handleVideoText(
        supabase,
        user,
        extractedText,
        body?.caption ?? null,
        authHeader,
        supabaseUrl,
        supabaseAnonKey,
        photoContext,
      );
      return await attachImportResolutionIds(
        supabase,
        user.id,
        resolved,
        body.import_nonce,
        "video_text",
      );
    } catch (e: any) {
      console.error("resolve-url video-text error:", e);
      return errorResponse("INTERNAL", "Internal server error", 500);
    }
  }

  const rawUrl = body?.url;
  const hasImage = typeof body?.image_path === "string";
  if (!hasImage && (typeof rawUrl !== "string" || !rawUrl)) {
    return errorResponse("INVALID_URL", "url is required", 400);
  }

  // ── URL validation ────────────────────────────────────────────────────────
  let parsedUrl: URL | null = null;
  let sourceType: SourceType = "screenshot";

  if (rawUrl) {
    const urlResult = validateUrl(rawUrl);
    if (urlResult.ok === false) {
      return errorResponse(
        "INVALID_URL",
        `URL rejected: ${urlResult.reason}`,
        400,
      );
    }
    parsedUrl = urlResult.url;
  }

  // ── Rate limit ────────────────────────────────────────────────────────────
  // Fail-CLOSED (TICKET-091): RPC error or missing row denies — this branch
  // previously logged-and-continued, letting a DB blip bypass the throttle.
  const { data: rateRows, error: rateError } = await supabase.rpc(
    "check_and_increment_rate_limit",
    {
      p_user_id: user.id,
      p_bucket_key: "resolve_url",
      p_max: 30,
      p_window_seconds: 3600,
    },
  );
  const rateRow = rateRows?.[0];
  if (rateError || !rateRow || !rateRow.allowed) {
    if (rateError) console.error("Rate limit check failed:", rateError);
    return jsonResponse(
      {
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests",
          details: { retry_after_seconds: rateRow?.retry_after_seconds ?? 60 },
        },
      },
      429,
    );
  }

  // ── Source detection ──────────────────────────────────────────────────────
  if (parsedUrl) {
    sourceType = detectSourceType(parsedUrl);
  }

  // ── Instagram: login-walled — nudge screenshot ────────────────────────────
  if (sourceType === "instagram") {
    const caption = body?.caption?.trim();
    let notePrefill = "";
    let query: string | null = null;
    if (caption) {
      notePrefill = captionToNote(caption);
      query = caption.split(/\n/)[0].trim() || caption;
    }
    return jsonResponse({
      data: {
        source_type: "instagram",
        best_query: query,
        note_prefill: notePrefill,
        candidates: [],
        partial_source: null,
        ig_nudge: true,
      } satisfies ResolveUrlResponse,
    });
  }

  // ── Vision/screenshot path: image_path supplied ───────────────────────────
  if (hasImage && body?.image_path) {
    const resolved = await handleVisionExtract(
      supabase,
      user,
      body.image_path,
      body?.caption ?? null,
      supabaseUrl,
      supabaseAnonKey,
      authHeader,
    );
    return await attachImportResolutionIds(
      supabase,
      user.id,
      resolved,
      body.import_nonce,
      "vision",
    );
  }

  // ── URL resolve pipeline (TICKET-063) ─────────────────────────────────────
  try {
    const resolved = await handleUrlResolve(
      supabase,
      user,
      rawUrl!,
      parsedUrl!,
      sourceType,
      body?.caption ?? null,
      authHeader,
      supabaseUrl,
      supabaseAnonKey,
      // TICKET-152: flag-gated — only a client that advertises support gets the
      // large_list enumeration response; old clients keep the ≤20 truncation.
      body?.supports_large_lists === true,
    );
    return await attachImportResolutionIds(
      supabase,
      user.id,
      resolved,
      body.import_nonce,
      "url",
    );
  } catch (e: any) {
    if (e?.name === "AbortError") {
      return errorResponse("TIMEOUT", "Resolver timed out", 503);
    }
    console.error("resolve-url error:", e);
    reportError(e, { fn: "resolve-url" });
    return errorResponse("INTERNAL", "Internal server error", 500);
  }
});
