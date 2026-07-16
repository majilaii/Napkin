/**
 * Durable restaurant-completeness worker.
 *
 * The orchestration layer depends on a narrow backend interface so lease and
 * failure semantics can be unit-tested without teaching the repo's Deno fake
 * client to execute PostgREST filters. DefaultCompletenessBackend is the real
 * Supabase/Google/Storage adapter used by the Edge entry point.
 */

import {
  type GoogleTextCandidate,
  hasCompleteRestaurantFacts,
  hasCompleteRestaurantHero,
  type PlaceAttestationProjection,
} from "../_shared/completeness.ts";
import {
  CompletenessPaidPathError,
  CompletenessProvider,
  type CompletenessProviderOptions,
} from "../_shared/completenessProvider.ts";
import {
  type DeferredResolutionDecision,
  scoreDeferredCandidates,
} from "../_shared/candidateDedupe.ts";

export const DEFAULT_BATCH_LIMIT = 10;
export const MAX_BATCH_LIMIT = 50;
export const DEFAULT_SWEEP_LIMIT = 25;
export const MAX_SWEEP_LIMIT = 100;
export const ITEM_LEASE_SECONDS = 180;
export const PROVIDER_LEASE_SECONDS = 180;
export const ATTEMPT_CAP = 6;

export type CompletenessTerminalState = "verified" | "resolved" | "exhausted";

export interface ClaimedCompletenessItem {
  id: string;
  owner_id: string;
  job_id: string;
  item_nonce: string;
  restaurant_id: string | null;
  external_id: string | null;
  resolution_id: string | null;
  client_facts: Record<string, unknown> | null;
  state: "leased";
  attempts: number;
  next_attempt_at: string;
  lease_token: string;
}

export interface CompletenessDestination {
  id: string;
  owner_id: string;
  job_id: string;
  item_nonce: string;
  destination_nonce: string;
  destination_kind: "wishlist" | "table" | "list" | "new_list";
  target_table_id: string | null;
  target_list_id: string | null;
  target_list_title: string | null;
  outcome: "pending" | "fulfilled" | "rejected";
}

export interface RestaurantCompletionState {
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
}

export interface RecordedResolution {
  decision:
    | DeferredResolutionDecision
    | "transient"
    | "unattempted_budget";
  candidateEvidence: Record<string, unknown>;
  matchedExternalId: string | null;
  scores: Record<string, unknown>;
}

export interface ProcessResult {
  item_id: string;
  state: CompletenessTerminalState | "deferred" | "pending" | "lost_lease";
  restaurant_id?: string | null;
  reason?: string;
  already_pinned?: boolean;
}

export interface DrainResult {
  worker_id: string;
  claimed: number;
  processed: ProcessResult[];
  swept_jobs: number;
}

export interface CompletenessWorkerBackend {
  claimBatch(
    workerId: string,
    limit: number,
    leaseSeconds: number,
  ): Promise<ClaimedCompletenessItem[]>;
  claimItem(
    itemId: string,
    workerId: string,
    leaseSeconds: number,
  ): Promise<ClaimedCompletenessItem | null>;
  sweep(limit: number): Promise<number>;
  getItem(itemId: string): Promise<ClaimedCompletenessItem | null>;
  getRestaurantState(
    restaurantId: string,
  ): Promise<RestaurantCompletionState | null>;
  searchDeferred(
    ownerId: string,
    query: {
      name: string;
      city: string;
      area: string | null;
      address: string | null;
    },
  ): Promise<GoogleTextCandidate[]>;
  recordResolution(
    item: ClaimedCompletenessItem,
    resolution: RecordedResolution,
  ): Promise<string>;
  canonicalize(
    item: ClaimedCompletenessItem,
    externalId: string,
  ): Promise<RestaurantCompletionState>;
  attest(
    ownerId: string,
    placeId: string,
    claimant: string,
  ): Promise<PlaceAttestationProjection>;
  applyAttestation(
    item: ClaimedCompletenessItem,
    restaurant: RestaurantCompletionState,
    projection: PlaceAttestationProjection,
  ): Promise<RestaurantCompletionState>;
  acquireMedia(
    ownerId: string,
    restaurantId: string,
    projection: PlaceAttestationProjection,
    claimant: string,
  ): Promise<string | null>;
  destinations(
    item: ClaimedCompletenessItem,
  ): Promise<CompletenessDestination[]>;
  route(
    item: ClaimedCompletenessItem,
    destination: CompletenessDestination,
    restaurantId: string,
  ): Promise<unknown>;
  finalize(
    item: ClaimedCompletenessItem,
    state: CompletenessTerminalState,
    restaurantId: string | null,
    lastError: string | null,
  ): Promise<unknown>;
  defer(
    item: ClaimedCompletenessItem,
    reason: string,
    withoutAttempt: boolean,
  ): Promise<"pending" | "deferred" | "exhausted">;
  enqueueDeployGate(input: DeployGateInput): Promise<{
    job_id: string;
    item_id: string;
    destination_id: string;
  }>;
}

export interface DeployGateInput {
  owner_id: string;
  restaurant_id: string;
  import_nonce: string;
}

export interface DeployGateResult {
  job_id: string;
  item_id: string;
  restaurant_id: string;
  state: "verified" | "resolved";
}

/** A wait/freeze/single-flight outcome that must not consume an item attempt. */
export class DeferredWithoutAttempt extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeferredWithoutAttempt";
  }
}

/** Provider/network/storage failure that consumes an attempt. */
export class RetryableCompletenessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableCompletenessError";
  }
}

/** A newer lease owns the item/claim; the stale worker must make no further commit. */
export class LostLeaseError extends Error {
  constructor(message = "lease token no longer owns this item") {
    super(message);
    this.name = "LostLeaseError";
  }
}

function clampInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) return fallback;
  return Math.min(value!, maximum);
}

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function factString(
  facts: Record<string, unknown> | null,
  key: string,
): string | null {
  const direct = facts?.[key];
  if (typeof direct === "string" && direct.trim() !== "") return direct.trim();
  const extracted = asRecord(facts?.extracted);
  const nested = extracted?.[key];
  return typeof nested === "string" && nested.trim() !== ""
    ? nested.trim()
    : null;
}

/** Server-copied queue facts never fall back to advisory nested extraction. */
function directFactString(
  facts: Record<string, unknown> | null,
  key: string,
): string | null {
  const direct = facts?.[key];
  return typeof direct === "string" && direct.trim() !== ""
    ? direct.trim()
    : null;
}

export function restaurantIsComplete(
  state: RestaurantCompletionState,
): boolean {
  return hasCompleteRestaurantFacts(state);
}

async function resolveExternalId(
  backend: CompletenessWorkerBackend,
  item: ClaimedCompletenessItem,
): Promise<
  {
    externalId: string | null;
    terminalResult: ProcessResult | null;
    preAttestBeforeCanonicalize: boolean;
  }
> {
  if (item.external_id && !item.external_id.startsWith("ghost_")) {
    return {
      externalId: item.external_id,
      terminalResult: null,
      preAttestBeforeCanonicalize: false,
    };
  }

  const recordedDecision = directFactString(
    item.client_facts,
    "resolution_decision",
  );
  if (
    recordedDecision === "no_result" || recordedDecision === "name_reject" ||
    recordedDecision === "locality_reject" || recordedDecision === "ambiguous"
  ) {
    // The save handler copied this from the owner-bound append-only
    // import_resolutions row. It is already terminal-for-auto, so never pay
    // for another search or turn a type-rejected item into a ghost pin.
    await backend.finalize(
      item,
      "exhausted",
      item.restaurant_id,
      recordedDecision,
    );
    return {
      externalId: null,
      preAttestBeforeCanonicalize: false,
      terminalResult: {
        item_id: item.id,
        state: "exhausted",
        restaurant_id: item.restaurant_id,
        reason: recordedDecision,
      },
    };
  }

  // A resolver may already know the Place id but have failed at the paid
  // Details boundary. The save handler copies this hint from append-only
  // server evidence (never client input), so retry Details directly instead
  // of paying for a broader Text Search that can select another venue.
  const attemptedExternalId = directFactString(
    item.client_facts,
    "attempted_external_id",
  );
  if (
    attemptedExternalId &&
    attemptedExternalId !== "ghost_pending" &&
    !attemptedExternalId.startsWith("ghost_") &&
    !attemptedExternalId.startsWith("merged_")
  ) {
    return {
      externalId: attemptedExternalId,
      terminalResult: null,
      preAttestBeforeCanonicalize: true,
    };
  }

  const name = factString(item.client_facts, "name");
  const city = factString(item.client_facts, "city");
  const area = factString(item.client_facts, "area");
  const address = factString(item.client_facts, "address");
  if (!name || !city) {
    const decision: DeferredResolutionDecision = !name
      ? "name_reject"
      : "locality_reject";
    await backend.recordResolution(item, {
      decision,
      candidateEvidence: {
        client_facts: item.client_facts ?? {},
        provider_candidates: [],
      },
      matchedExternalId: null,
      scores: { reason: !name ? "missing_name" : "missing_required_city" },
    });
    await backend.finalize(item, "exhausted", item.restaurant_id, decision);
    return {
      externalId: null,
      preAttestBeforeCanonicalize: false,
      terminalResult: {
        item_id: item.id,
        state: "exhausted",
        restaurant_id: item.restaurant_id,
        reason: decision,
      },
    };
  }

  const query = { name, city, area, address };
  let candidates: GoogleTextCandidate[];
  try {
    candidates = await backend.searchDeferred(item.owner_id, query);
  } catch (error) {
    const decision = error instanceof DeferredWithoutAttempt
      ? "unattempted_budget"
      : "transient";
    await backend.recordResolution(item, {
      decision,
      candidateEvidence: { query, provider_candidates: [] },
      matchedExternalId: null,
      scores: { error: cleanError(error) },
    });
    throw error;
  }

  const scored = scoreDeferredCandidates(
    { name, city },
    candidates.map(({ externalId, name, city, formattedAddress }) => ({
      externalId,
      name,
      city,
      formattedAddress,
    })),
  );
  const scorePayload = {
    name_threshold: 0.85,
    ambiguity_margin: 0.1,
    candidates: scored.scores.map((candidate) => ({
      external_id: candidate.externalId,
      name_score: candidate.nameScore,
      city_confirmed: candidate.cityConfirmed,
    })),
  };
  const evidence = {
    query,
    provider_candidates: candidates.map((candidate) => candidate.raw),
  };
  await backend.recordResolution(item, {
    decision: scored.decision,
    candidateEvidence: evidence,
    matchedExternalId: scored.match?.externalId ?? null,
    scores: scorePayload,
  });

  if (scored.decision !== "matched" || !scored.match) {
    await backend.finalize(
      item,
      "exhausted",
      item.restaurant_id,
      scored.decision,
    );
    return {
      externalId: null,
      preAttestBeforeCanonicalize: false,
      terminalResult: {
        item_id: item.id,
        state: "exhausted",
        restaurant_id: item.restaurant_id,
        reason: scored.decision,
      },
    };
  }
  return {
    externalId: scored.match.externalId,
    terminalResult: null,
    preAttestBeforeCanonicalize: false,
  };
}

/** Process one already-fenced claim. All committing RPCs receive its lease token. */
export async function processClaimedCompletenessItem(
  backend: CompletenessWorkerBackend,
  item: ClaimedCompletenessItem,
  workerId: string,
): Promise<ProcessResult> {
  const requiredDeferredResolution = !item.external_id ||
    item.external_id.startsWith("ghost_");
  const resolved = await resolveExternalId(backend, item);
  if (resolved.terminalResult) return resolved.terminalResult;
  const externalId = resolved.externalId!;

  // A known-id retry is still non-matched evidence until Details succeeds.
  // Attest before canonicalization so a stale/404/provider failure cannot
  // repoint or merge any restaurant row. Reuse the successful projection
  // below so the path never issues a duplicate Details lookup.
  let projection: PlaceAttestationProjection | null = null;
  if (resolved.preAttestBeforeCanonicalize) {
    projection = await backend.attest(item.owner_id, externalId, workerId);
  }

  // Canonical identity is settled before any completeness write. The SQL RPC
  // owns merge locking/media-claim transfer and returns the current target.
  let restaurant = await backend.canonicalize(item, externalId);

  // Existing complete rows are the zero-spend fast path and the deploy-gate
  // primitive. Coordinate and photo predicates are independent: an existing
  // photo_source='none' is a valid terminal hero state.
  if (!restaurantIsComplete(restaurant)) {
    projection ??= await backend.attest(item.owner_id, externalId, workerId);
    restaurant = await backend.applyAttestation(item, restaurant, projection);
    if (
      (!hasCompleteRestaurantHero(restaurant) ||
        (restaurant.photo_source === "places" &&
          restaurant.photo_reference !== projection.photo_reference)) &&
      projection.photo_reference &&
      projection.photo_attribution_html
    ) {
      await backend.acquireMedia(
        item.owner_id,
        restaurant.id,
        projection,
        workerId,
      );
      // Media installation resolves the canonical id again after upload;
      // reload through the idempotent canonicalizer so a merge during the
      // download cannot leave us routing a tombstone or stale hero shape.
      restaurant = await backend.canonicalize(item, externalId);
    }
  }

  // Defense in depth mirrors fn_finalize_completeness_item. Never route side
  // effects based on the optimistic apply/media return values alone.
  if (!restaurantIsComplete(restaurant)) {
    throw new RetryableCompletenessError(
      "restaurant remained incomplete after attestation/media",
    );
  }

  const destinations = await backend.destinations(item);
  let alreadyPinned = false;
  for (const destination of destinations) {
    // Routing and its ledger acknowledgement commit in one SQL transaction.
    // A terminal destination therefore needs no replay after a worker dies
    // between routing and item finalization.  In particular, re-routing it
    // after a later canonical merge would compare the old append-only ledger
    // payload with the new canonical id and manufacture a false conflict.
    if (destination.outcome !== "pending") continue;
    const routed = await backend.route(item, destination, restaurant.id);
    if (
      routed && typeof routed === "object" &&
      (routed as { status?: unknown }).status === "already_pinned"
    ) {
      alreadyPinned = true;
    }
  }

  const terminalState: CompletenessTerminalState = requiredDeferredResolution
    ? "resolved"
    : "verified";
  await backend.finalize(item, terminalState, restaurant.id, null);
  return {
    item_id: item.id,
    state: terminalState,
    restaurant_id: restaurant.id,
    already_pinned: alreadyPinned,
  };
}

/** Isolate one item's failure while preserving the lease-token failure semantics. */
export async function settleClaimedCompletenessItem(
  backend: CompletenessWorkerBackend,
  item: ClaimedCompletenessItem,
  workerId: string,
): Promise<ProcessResult> {
  try {
    return await processClaimedCompletenessItem(backend, item, workerId);
  } catch (error) {
    if (error instanceof LostLeaseError) {
      return {
        item_id: item.id,
        state: "lost_lease",
        reason: cleanError(error),
      };
    }

    const withoutAttempt = error instanceof DeferredWithoutAttempt;
    try {
      const state = await backend.defer(
        item,
        cleanError(error),
        withoutAttempt,
      );
      return {
        item_id: item.id,
        state,
        restaurant_id: item.restaurant_id,
        reason: cleanError(error),
      };
    } catch (deferError) {
      // A stale worker is expected to lose the defer CAS too. Do not make a
      // second unfenced write or overwrite the newer worker's state.
      return {
        item_id: item.id,
        state: "lost_lease",
        reason: cleanError(deferError),
      };
    }
  }
}

export async function drainCompletenessQueue(
  backend: CompletenessWorkerBackend,
  options: { batchLimit?: number; sweepLimit?: number; workerId?: string } = {},
): Promise<DrainResult> {
  const workerId = options.workerId ?? crypto.randomUUID();
  const batchLimit = clampInteger(
    options.batchLimit,
    DEFAULT_BATCH_LIMIT,
    MAX_BATCH_LIMIT,
  );
  const sweepLimit = clampInteger(
    options.sweepLimit,
    DEFAULT_SWEEP_LIMIT,
    MAX_SWEEP_LIMIT,
  );
  const claimed = await backend.claimBatch(
    workerId,
    batchLimit,
    ITEM_LEASE_SECONDS,
  );
  const processed: ProcessResult[] = [];
  for (const item of claimed) {
    processed.push(
      await settleClaimedCompletenessItem(backend, item, workerId),
    );
  }
  // Bounded, job-locked SQL safety net. It remains useful even though normal
  // finalization emits the barrier in the same transaction.
  const sweptJobs = await backend.sweep(sweepLimit);
  return {
    worker_id: workerId,
    claimed: claimed.length,
    processed,
    swept_jobs: sweptJobs,
  };
}

/**
 * Deploy gate: enqueue a sealed one-item v2 job, exact-claim it (bypassing the
 * normal 15-minute grace), then use the same route/finalize pipeline as cron.
 * The supplied restaurant must already be complete, keeping the gate no-spend.
 */
export async function runCompletenessDeployGate(
  backend: CompletenessWorkerBackend,
  input: DeployGateInput,
  workerId: string = crypto.randomUUID(),
): Promise<DeployGateResult> {
  const existing = await backend.getRestaurantState(input.restaurant_id);
  if (
    !existing || existing.verification !== "verified" ||
    !restaurantIsComplete(existing)
  ) {
    throw new Error("GATE_RESTAURANT_INCOMPLETE");
  }

  const seeded = await backend.enqueueDeployGate(input);
  const claimed = await backend.claimItem(
    seeded.item_id,
    workerId,
    ITEM_LEASE_SECONDS,
  );
  if (!claimed) {
    const current = await backend.getItem(seeded.item_id);
    if (
      current &&
      (current.state as string === "verified" ||
        current.state as string === "resolved")
    ) {
      return {
        job_id: seeded.job_id,
        item_id: seeded.item_id,
        restaurant_id: input.restaurant_id,
        state: current.state as "verified" | "resolved",
      };
    }
    throw new Error("GATE_ITEM_NOT_CLAIMABLE");
  }

  // The destination row returned by enqueue is fetched by the normal
  // destinations() call; seeded.destination_id is retained for smoke evidence.
  void seeded.destination_id;
  const result = await processClaimedCompletenessItem(
    backend,
    claimed,
    workerId,
  );
  if (result.state !== "verified" && result.state !== "resolved") {
    throw new Error(`GATE_NOT_TERMINAL:${result.state}`);
  }
  return {
    job_id: seeded.job_id,
    item_id: seeded.item_id,
    restaurant_id: result.restaurant_id ?? input.restaurant_id,
    state: result.state,
  };
}

// ── Real Supabase + Google adapter ───────────────────────────────────────────

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

function firstRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return value === null || value === undefined ? null : value as T;
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

export class DefaultCompletenessBackend extends CompletenessProvider
  implements CompletenessWorkerBackend {
  constructor(
    supabase: SupabaseLike,
    options: CompletenessProviderOptions = {},
  ) {
    super(supabase, options);
  }

  protected override async rpc<T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    try {
      return await super.rpc<T>(name, args);
    } catch (error) {
      const message =
        typeof (error as { message?: unknown })?.message === "string"
          ? (error as { message: string }).message
          : String(error);
      if (message.includes("STALE_LEASE") || message.includes("LEASE_LOST")) {
        throw new LostLeaseError(message);
      }
      throw new Error(message);
    }
  }

  async claimBatch(workerId: string, limit: number, leaseSeconds: number) {
    const rows = await this.rpc<ClaimedCompletenessItem[]>(
      "fn_claim_completeness_batch",
      {
        p_worker_id: workerId,
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      },
    );
    return Array.isArray(rows) ? rows : [];
  }

  async claimItem(itemId: string, workerId: string, leaseSeconds: number) {
    const value = await this.rpc<unknown>("fn_claim_completeness_item", {
      p_item_id: itemId,
      p_worker_id: workerId,
      p_lease_seconds: leaseSeconds,
    });
    return firstRow<ClaimedCompletenessItem>(value);
  }

  async sweep(limit: number): Promise<number> {
    const value = await this.rpc<unknown>("fn_sweep_stuck_jobs", {
      p_limit: limit,
    });
    if (typeof value === "number") return value;
    const scalar = scalarString(value);
    const parsed = scalar ? Number(scalar) : NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  }

  async getItem(itemId: string): Promise<ClaimedCompletenessItem | null> {
    const { data, error } = await this.supabase
      .from("restaurant_completeness_queue")
      .select(
        "id,owner_id,job_id,item_nonce,restaurant_id,external_id,resolution_id,client_facts,state,attempts,next_attempt_at,lease_token",
      )
      .eq("id", itemId)
      .maybeSingle();
    if (error) throw error;
    return data as ClaimedCompletenessItem | null;
  }

  async getRestaurantState(
    restaurantId: string,
  ): Promise<RestaurantCompletionState | null> {
    const { data, error } = await this.supabase
      .from("restaurants")
      .select(
        "id,external_id,verification,merged_into,completeness_version,lat,lng,photo_url,photo_reference,photo_source,places_photo_attribution_html",
      )
      .eq("id", restaurantId)
      .maybeSingle();
    if (error) throw error;
    return data as RestaurantCompletionState | null;
  }

  private translatePaidPathError(error: unknown): never {
    if (!(error instanceof CompletenessPaidPathError)) throw error;
    if (error.code === "BUDGET_DEFERRED" || error.code === "CLAIM_PENDING") {
      throw new DeferredWithoutAttempt(error.message);
    }
    if (error.code === "LEASE_LOST") throw new LostLeaseError(error.message);
    throw new RetryableCompletenessError(error.message);
  }

  async searchDeferred(
    ownerId: string,
    query: {
      name: string;
      city: string;
      area: string | null;
      address: string | null;
    },
  ): Promise<GoogleTextCandidate[]> {
    try {
      return await super.searchText(ownerId, query);
    } catch (error) {
      return this.translatePaidPathError(error);
    }
  }

  async recordResolution(
    item: ClaimedCompletenessItem,
    resolution: RecordedResolution,
  ): Promise<string> {
    const value = await this.rpc<unknown>("fn_record_completeness_resolution", {
      p_item_id: item.id,
      p_lease_token: item.lease_token,
      p_decision: resolution.decision,
      p_candidate_evidence: resolution.candidateEvidence,
      p_matched_external_id: resolution.matchedExternalId,
      p_scores: resolution.scores,
    });
    const id = scalarString(value);
    if (!id) throw new Error("resolution RPC returned no id");
    return id;
  }

  async canonicalize(
    item: ClaimedCompletenessItem,
    externalId: string,
  ): Promise<RestaurantCompletionState> {
    if (!item.restaurant_id) throw new Error("NO_RESTAURANT_ROW");
    let state = await this.getRestaurantState(item.restaurant_id);
    if (!state) throw new Error("NO_RESTAURANT_ROW");
    if (state.merged_into) {
      const resolved = await this.rpc<unknown>("fn_resolve_canonical", {
        p_id: state.id,
      });
      const resolvedId = scalarString(resolved);
      if (!resolvedId) throw new Error("canonical resolver returned no id");
      state = await this.getRestaurantState(resolvedId);
      if (!state) throw new Error("canonical restaurant missing");
    }

    const value = await this.rpc<unknown>("fn_canonicalize_completeness_item", {
      p_item_id: item.id,
      p_lease_token: item.lease_token,
      p_ghost_id: state.id,
      p_canonical_external_id: externalId,
      p_expected_version: state.completeness_version,
    });
    const canonicalId = scalarString(value);
    if (!canonicalId) throw new Error("canonicalization returned no id");
    const canonical = await this.getRestaurantState(canonicalId);
    if (!canonical) throw new Error("canonical restaurant missing after merge");
    return canonical;
  }

  async attest(
    ownerId: string,
    placeId: string,
    claimant: string,
  ): Promise<PlaceAttestationProjection> {
    try {
      return await super.attest(
        ownerId,
        placeId,
        claimant,
        PROVIDER_LEASE_SECONDS,
      );
    } catch (error) {
      return this.translatePaidPathError(error);
    }
  }

  async applyAttestation(
    item: ClaimedCompletenessItem,
    restaurant: RestaurantCompletionState,
    projection: PlaceAttestationProjection,
  ): Promise<RestaurantCompletionState> {
    const value = await this.rpc<unknown>("fn_apply_restaurant_attestation", {
      p_item_id: item.id,
      p_lease_token: item.lease_token,
      p_restaurant_id: restaurant.id,
      p_expected_version: restaurant.completeness_version,
      p_projection: projection,
    });
    const result = firstRow<{ restaurant_id?: string; canonical_id?: string }>(
      value,
    );
    const id = result?.canonical_id ?? result?.restaurant_id ??
      scalarString(value);
    if (!id) throw new Error("attestation apply returned no canonical id");
    const state = await this.getRestaurantState(id);
    if (!state) throw new Error("attested restaurant missing");
    return state;
  }

  async acquireMedia(
    ownerId: string,
    restaurantId: string,
    projection: PlaceAttestationProjection,
    claimant: string,
  ): Promise<string | null> {
    try {
      return await super.acquireMedia(
        ownerId,
        restaurantId,
        projection,
        claimant,
        PROVIDER_LEASE_SECONDS,
      );
    } catch (error) {
      if (
        error instanceof CompletenessPaidPathError &&
        error.code === "MEDIA_CAS_LOST"
      ) {
        const state = await this.getRestaurantState(restaurantId);
        if (state && restaurantIsComplete(state)) return state.photo_url;
      }
      return this.translatePaidPathError(error);
    }
  }

  async destinations(
    item: ClaimedCompletenessItem,
  ): Promise<CompletenessDestination[]> {
    const { data, error } = await this.supabase
      .from("completeness_destinations")
      .select(
        "id,owner_id,job_id,item_nonce,destination_nonce,destination_kind,target_table_id,target_list_id,target_list_title,outcome",
      )
      .eq("owner_id", item.owner_id)
      .eq("job_id", item.job_id)
      .eq("item_nonce", item.item_nonce)
      .eq("outcome", "pending")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return Array.isArray(data) ? data as CompletenessDestination[] : [];
  }

  async route(
    item: ClaimedCompletenessItem,
    destination: CompletenessDestination,
    restaurantId: string,
  ): Promise<unknown> {
    return await this.rpc("fn_route_destination", {
      p_item_id: item.id,
      p_lease_token: item.lease_token,
      p_destination_id: destination.id,
      p_restaurant_id: restaurantId,
    });
  }

  async finalize(
    item: ClaimedCompletenessItem,
    state: CompletenessTerminalState,
    restaurantId: string | null,
    lastError: string | null,
  ): Promise<unknown> {
    return await this.rpc("fn_finalize_completeness_item", {
      p_item_id: item.id,
      p_lease_token: item.lease_token,
      p_terminal_state: state,
      p_restaurant_id: restaurantId,
      p_last_error: lastError,
    });
  }

  async defer(
    item: ClaimedCompletenessItem,
    reason: string,
    withoutAttempt: boolean,
  ): Promise<"pending" | "deferred" | "exhausted"> {
    const value = await this.rpc<unknown>("fn_defer_completeness_item", {
      p_item_id: item.id,
      p_lease_token: item.lease_token,
      p_reason: reason,
      p_budget_deferred: withoutAttempt,
      p_attempt_cap: ATTEMPT_CAP,
    });
    const state = scalarString(value);
    if (state === "pending" || state === "deferred" || state === "exhausted") {
      return state;
    }
    throw new Error("defer RPC returned an invalid state");
  }

  async enqueueDeployGate(input: DeployGateInput): Promise<{
    job_id: string;
    item_id: string;
    destination_id: string;
  }> {
    const restaurant = await this.getRestaurantState(input.restaurant_id);
    if (
      !restaurant?.external_id || restaurant.external_id.startsWith("ghost_")
    ) {
      throw new Error("GATE_RESTAURANT_UNVERIFIED");
    }
    const value = await this.rpc<unknown>("fn_enqueue_completeness", {
      p_owner: input.owner_id,
      p_import_nonce: input.import_nonce,
      p_protocol_generation: "v2",
      p_items: [{
        item_nonce: input.import_nonce,
        restaurant_id: input.restaurant_id,
        external_id: restaurant.external_id,
        resolution_id: null,
        client_facts: { deploy_gate: true },
      }],
      p_destinations: [{
        item_nonce: input.import_nonce,
        destination_nonce: input.import_nonce,
        destination_kind: "wishlist",
        target_table_id: null,
        target_list_id: null,
        target_list_title: null,
        title_nonce: null,
        notify_done: false,
      }],
      p_expected_destinations: 1,
    });
    const result = firstRow<{
      job_id?: string;
      items?: Array<{ id?: string; item_nonce?: string }>;
      destinations?: Array<{ id?: string; destination_nonce?: string }>;
    }>(value);
    const itemId = result?.items?.[0]?.id;
    const destinationId = result?.destinations?.[0]?.id;
    if (!result?.job_id || !itemId || !destinationId) {
      throw new Error("deploy-gate enqueue returned an incomplete result");
    }
    return {
      job_id: result.job_id,
      item_id: itemId,
      destination_id: destinationId,
    };
  }
}
