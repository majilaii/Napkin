/** Google Cloud Vision SAFE_SEARCH_DETECTION adapter for TICKET-196. */

import { sha256Hex } from "./imageCanonical.ts";

export const VISION_SAFE_SEARCH_ENDPOINT =
  "https://vision.googleapis.com/v1/images:annotate";
export const VISION_ATTEMPT_TIMEOUT_MS = 8_000;

export const LIKELIHOODS = [
  "UNKNOWN",
  "VERY_UNLIKELY",
  "UNLIKELY",
  "POSSIBLE",
  "LIKELY",
  "VERY_LIKELY",
] as const;

export type SafeSearchLikelihood = typeof LIKELIHOODS[number];
export type SafeSearchVerdict = "pass" | "rejected";

export interface SafeSearchLikelihoods {
  adult: SafeSearchLikelihood;
  violence: SafeSearchLikelihood;
  racy: SafeSearchLikelihood;
  medical: SafeSearchLikelihood;
  spoof: SafeSearchLikelihood;
}

export interface SafeSearchResult {
  verdict: SafeSearchVerdict;
  likelihoods: SafeSearchLikelihoods;
  /** Explicit deploy-canary proof that this result came from Vision, not cache. */
  providerCalled: true;
}

export class VisionSafeSearchError extends Error {
  readonly retryable = true;

  constructor(
    readonly code:
      | "missing_api_key"
      | "provider_timeout"
      | "provider_network"
      | "provider_http"
      | "provider_error"
      | "provider_invalid_response"
      | "provider_unknown",
    message: string,
  ) {
    super(message);
    this.name = "VisionSafeSearchError";
  }
}

export type VisionFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface ScanSafeSearchOptions {
  fetchImpl?: VisionFetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type ImageScanBudgetScope = "general" | "sweep" | "canary";

export interface SafeSearchLedgerResult {
  sha256: string;
  verdict: SafeSearchVerdict;
  likelihoods: SafeSearchLikelihoods;
  cacheHit: boolean;
  providerCalled: boolean;
}

export class SafeSearchLedgerError extends Error {
  constructor(
    readonly code:
      | "cache_failed"
      | "canonical_not_unique"
      | "lease_busy"
      | "invalid_lease"
      | "budget_exhausted"
      | "lease_superseded"
      | "rpc_failed",
    message: string,
  ) {
    super(message);
    this.name = "SafeSearchLedgerError";
  }
}

export interface ResolveSafeSearchVerdictOptions extends ScanSafeSearchOptions {
  /** Service-role Supabase client. All underlying RPCs are service-only. */
  client: any;
  canonicalJpeg: Uint8Array;
  userId: string;
  scope: ImageScanBudgetScope;
  apiKey: string;
  /** Supplying a known hash avoids re-hashing in a caller that promotes it. */
  sha256?: string;
  owner?: string;
  scanImpl?: typeof scanSafeSearch;
  /** Canary mode: a cache hit is an error, never a successful no-op. */
  requireProviderCall?: boolean;
}

function bytesToBase64(bytes: Uint8Array): string {
  const nativeToBase64 = (
    bytes as Uint8Array & { toBase64?: () => string }
  ).toBase64;
  if (typeof nativeToBase64 === "function") {
    // Avoid materializing a second byte-per-character binary string.  That
    // transient copy is large enough to exhaust an Edge isolate for the 4MP
    // deploy canary before the Vision request is sent.
    return nativeToBase64.call(bytes);
  }

  // Older runtimes do not expose Uint8Array#toBase64.  Keep each fallback
  // chunk aligned to a base64 triplet so it can be encoded independently,
  // without retaining an array of binary-string copies of the whole image.
  const chunkSize = 0x6000;
  let encoded = "";
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const chunk = bytes.subarray(
      offset,
      Math.min(offset + chunkSize, bytes.byteLength),
    );
    let binary = "";
    for (let i = 0; i < chunk.byteLength; i += 1) {
      binary += String.fromCharCode(chunk[i]);
    }
    encoded += btoa(binary);
  }
  return encoded;
}

function likelihood(value: unknown, field: string): SafeSearchLikelihood {
  if (
    typeof value !== "string" ||
    !LIKELIHOODS.includes(value as SafeSearchLikelihood)
  ) {
    throw new VisionSafeSearchError(
      "provider_invalid_response",
      `Vision omitted a valid ${field} likelihood`,
    );
  }
  if (value === "UNKNOWN") {
    throw new VisionSafeSearchError(
      "provider_unknown",
      `Vision returned UNKNOWN for ${field}`,
    );
  }
  return value as SafeSearchLikelihood;
}

/** Apply the ticket's pinned adult/violence/racy rejection thresholds. */
export function classifySafeSearch(
  likelihoods: SafeSearchLikelihoods,
): SafeSearchVerdict {
  // UNKNOWN is never terminal and therefore must never become a cached pass.
  for (const [field, value] of Object.entries(likelihoods)) {
    if (value === "UNKNOWN") {
      throw new VisionSafeSearchError(
        "provider_unknown",
        `Vision returned UNKNOWN for ${field}`,
      );
    }
  }

  const high = new Set<SafeSearchLikelihood>(["LIKELY", "VERY_LIKELY"]);
  return high.has(likelihoods.adult) ||
      high.has(likelihoods.violence) ||
      likelihoods.racy === "VERY_LIKELY"
    ? "rejected"
    : "pass";
}

function linkedAbortController(
  parent: AbortSignal | undefined,
  timeoutMs: number,
) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(parent?.reason);
  if (parent?.aborted) abortFromParent();
  else parent?.addEventListener("abort", abortFromParent, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(
      new DOMException("Vision request timed out", "TimeoutError"),
    );
  }, timeoutMs);

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abortFromParent);
    },
  };
}

/**
 * Make exactly one Vision images:annotate request. The caller supplies the
 * dedicated GOOGLE_VISION_API_KEY; this module never reads the Places key.
 */
export async function scanSafeSearch(
  canonicalJpeg: Uint8Array,
  apiKey: string,
  options: ScanSafeSearchOptions = {},
): Promise<SafeSearchResult> {
  if (!apiKey) {
    throw new VisionSafeSearchError(
      "missing_api_key",
      "GOOGLE_VISION_API_KEY is not configured",
    );
  }
  if (canonicalJpeg.byteLength === 0) {
    throw new VisionSafeSearchError(
      "provider_invalid_response",
      "Canonical image is empty",
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const linked = linkedAbortController(
    options.signal,
    options.timeoutMs ?? VISION_ATTEMPT_TIMEOUT_MS,
  );

  let response: Response;
  let payload: unknown;
  try {
    response = await fetchImpl(
      `${VISION_SAFE_SEARCH_ENDPOINT}?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [{
            image: { content: bytesToBase64(canonicalJpeg) },
            features: [{ type: "SAFE_SEARCH_DETECTION", maxResults: 1 }],
          }],
        }),
        signal: linked.signal,
      },
    );
    try {
      // Keep the same deadline armed through response-body consumption;
      // fetch resolves when headers arrive, not when JSON has finished.
      payload = await response.json();
    } catch (error) {
      if (linked.timedOut() || options.signal?.aborted) throw error;
      throw new VisionSafeSearchError(
        "provider_invalid_response",
        "Vision returned non-JSON data",
      );
    }
  } catch (error) {
    if (error instanceof VisionSafeSearchError) throw error;
    if (linked.timedOut() || options.signal?.aborted) {
      throw new VisionSafeSearchError(
        "provider_timeout",
        "Vision request timed out",
      );
    }
    throw new VisionSafeSearchError(
      "provider_network",
      "Vision request failed",
    );
  } finally {
    linked.dispose();
  }

  if (!response.ok) {
    throw new VisionSafeSearchError(
      "provider_http",
      `Vision returned HTTP ${response.status}`,
    );
  }

  const first = (payload as {
    responses?: Array<{
      error?: { code?: number; message?: string };
      safeSearchAnnotation?: Record<string, unknown>;
    }>;
  })?.responses?.[0];
  if (first?.error) {
    throw new VisionSafeSearchError(
      "provider_error",
      `Vision annotation failed${
        first.error.code ? ` (${first.error.code})` : ""
      }`,
    );
  }
  if (!first?.safeSearchAnnotation) {
    throw new VisionSafeSearchError(
      "provider_invalid_response",
      "Vision omitted safeSearchAnnotation",
    );
  }

  const annotation = first.safeSearchAnnotation;
  const likelihoods: SafeSearchLikelihoods = {
    adult: likelihood(annotation.adult, "adult"),
    violence: likelihood(annotation.violence, "violence"),
    racy: likelihood(annotation.racy, "racy"),
    medical: likelihood(annotation.medical, "medical"),
    spoof: likelihood(annotation.spoof, "spoof"),
  };

  return {
    verdict: classifySafeSearch(likelihoods),
    likelihoods,
    providerCalled: true,
  };
}

function ledgerObject(data: unknown): Record<string, unknown> {
  const value = Array.isArray(data) && data.length === 1 ? data[0] : data;
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

async function ledgerRpc(
  client: any,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await client.rpc(name, args);
  if (error) {
    const message = typeof error.message === "string"
      ? error.message
      : `${name} failed`;
    if (/SCAN_LEASE_BUSY|LEASE_BUSY/i.test(message)) {
      throw new SafeSearchLedgerError(
        "lease_busy",
        "Identical bytes are already being scanned",
      );
    }
    if (/BUDGET|RATE_LIMIT|CAP_EXHAUST/i.test(message)) {
      throw new SafeSearchLedgerError(
        "budget_exhausted",
        "Image scan budget is exhausted",
      );
    }
    throw new SafeSearchLedgerError("rpc_failed", `${name} failed`);
  }
  return data;
}

function fenceToken(value: unknown): number | string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : value;
  }
  return null;
}

function rpcAffirmative(
  data: unknown,
  field: "acquired" | "committed",
): boolean {
  if (data === true) return true;
  const value = ledgerObject(data);
  if (value[field] === true) return true;
  // Older/replay-safe acquire implementations returned the token-bearing row
  // without a redundant acquired flag. A fencing token is the authority.
  return field === "acquired" && fenceToken(value.fencing_token) !== null;
}

async function recordScanResult(
  client: any,
  ledgerId: string,
  sha256: string,
  outcome: SafeSearchVerdict | "provider_error" | "timeout",
  providerCallMarker: string | null,
  error: string | null,
): Promise<void> {
  const recorded = await ledgerRpc(client, "fn_record_scan_result", {
    p_ledger_id: ledgerId,
    p_sha256: sha256,
    p_outcome: outcome,
    p_provider_call_marker: providerCallMarker,
    p_error: error,
  });
  if (recorded !== true) {
    throw new SafeSearchLedgerError(
      "rpc_failed",
      "Scan ledger result was not recorded",
    );
  }
}

async function readTerminalVerdict(
  client: any,
  sha256: string,
): Promise<
  { verdict: SafeSearchVerdict; likelihoods: SafeSearchLikelihoods } | null
> {
  const { data, error } = await client
    .from("image_hash_verdicts")
    .select("verdict,likelihoods")
    .eq("sha256", sha256)
    .maybeSingle();
  if (error) {
    throw new SafeSearchLedgerError(
      "cache_failed",
      "Could not read image verdict cache",
    );
  }
  if (!data) return null;
  if (data.verdict !== "pass" && data.verdict !== "rejected") {
    throw new SafeSearchLedgerError(
      "cache_failed",
      "Image verdict cache is non-terminal",
    );
  }
  return {
    verdict: data.verdict,
    likelihoods: data.likelihoods as SafeSearchLikelihoods,
  };
}

/**
 * Shared paid-scan authority for moderate-image and grandfather jobs.
 *
 * Given canonical bytes, this performs the complete global-cache → fenced
 * per-hash lease → scoped atomic budget debit → one Vision attempt → fenced
 * terminal verdict commit sequence. Provider errors and UNKNOWN are never
 * cached. The lease is token-conditionally released on every non-terminal
 * path, so callers cannot accidentally bypass crash recovery or caps.
 */
export async function resolveSafeSearchVerdict(
  options: ResolveSafeSearchVerdictOptions,
): Promise<SafeSearchLedgerResult> {
  const computedSha256 = await sha256Hex(options.canonicalJpeg);
  if (options.sha256 && options.sha256 !== computedSha256) {
    throw new SafeSearchLedgerError(
      "rpc_failed",
      "Canonical byte hash does not match supplied hash",
    );
  }
  const sha256 = computedSha256;
  const cached = await readTerminalVerdict(options.client, sha256);
  if (cached) {
    if (options.requireProviderCall) {
      throw new SafeSearchLedgerError(
        "canonical_not_unique",
        "Post-canonical image hash already has a terminal verdict",
      );
    }
    return {
      sha256,
      ...cached,
      cacheHit: true,
      // This marker describes where THIS result came from. Consumers
      // that require a real round-trip must also require cacheHit=false.
      providerCalled: false,
    };
  }
  const owner = options.owner ?? crypto.randomUUID();
  const lease = await ledgerRpc(options.client, "fn_acquire_scan_lease", {
    p_sha256: sha256,
    p_owner: owner,
  });
  const leaseData = ledgerObject(lease);
  if (!rpcAffirmative(lease, "acquired")) {
    throw new SafeSearchLedgerError(
      "lease_busy",
      "Identical bytes are already being scanned",
    );
  }
  const token = fenceToken(leaseData.fencing_token);
  if (token === null) {
    throw new SafeSearchLedgerError(
      "invalid_lease",
      "Scan lease omitted its fencing token",
    );
  }

  let leaseHeld = true;
  try {
    // Close the cache-read/acquire race: a previous owner can commit and
    // release after our first cache miss but before this acquire succeeds.
    // Once we hold the only live lease, re-read the terminal cache before
    // spending budget so there are zero provider attempts after a verdict.
    const cachedAfterAcquire = await readTerminalVerdict(
      options.client,
      sha256,
    );
    if (cachedAfterAcquire) {
      if (options.requireProviderCall) {
        throw new SafeSearchLedgerError(
          "canonical_not_unique",
          "Post-canonical image hash already has a terminal verdict",
        );
      }
      return {
        sha256,
        ...cachedAfterAcquire,
        cacheHit: true,
        providerCalled: false,
      };
    }
    if (!options.apiKey) {
      throw new VisionSafeSearchError(
        "missing_api_key",
        "GOOGLE_VISION_API_KEY is not configured",
      );
    }

    const debit = await ledgerRpc(options.client, "fn_debit_scan_budget", {
      p_user_id: options.userId,
      p_scope: options.scope,
    });
    const debitData = ledgerObject(debit);
    if (
      debit === false || debitData.allowed === false || debitData.ok === false
    ) {
      throw new SafeSearchLedgerError(
        "budget_exhausted",
        "Image scan budget is exhausted",
      );
    }
    const ledgerId = typeof debitData.ledger_id === "string"
      ? debitData.ledger_id
      : null;
    if (!ledgerId) {
      throw new SafeSearchLedgerError(
        "rpc_failed",
        "Scan budget debit omitted its ledger id",
      );
    }

    // Unique per attempt. This proves a provider attempt occurred without
    // storing response content or credentials in either ledger table.
    const providerCallMarker = `gcv-safe-search:${owner}`;

    let scanned: SafeSearchResult;
    try {
      scanned = await (options.scanImpl ?? scanSafeSearch)(
        options.canonicalJpeg,
        options.apiKey,
        {
          fetchImpl: options.fetchImpl,
          signal: options.signal,
          timeoutMs: options.timeoutMs,
        },
      );
    } catch (error) {
      const timeout = error instanceof VisionSafeSearchError &&
        error.code === "provider_timeout";
      const marker = error instanceof VisionSafeSearchError &&
          error.code === "missing_api_key"
        ? null
        : providerCallMarker;
      await recordScanResult(
        options.client,
        ledgerId,
        sha256,
        timeout ? "timeout" : "provider_error",
        marker,
        error instanceof VisionSafeSearchError
          ? error.code
          : "provider_failure",
      );
      throw error;
    }

    let committed: unknown;
    try {
      committed = await ledgerRpc(options.client, "fn_commit_image_verdict", {
        p_sha256: sha256,
        p_owner: owner,
        p_fencing_token: token,
        p_verdict: scanned.verdict,
        p_likelihoods: scanned.likelihoods,
        p_provider_call_marker: providerCallMarker,
      });
      if (rpcAffirmative(committed, "committed")) leaseHeld = false;
    } finally {
      await recordScanResult(
        options.client,
        ledgerId,
        sha256,
        scanned.verdict,
        providerCallMarker,
        null,
      );
    }
    if (!rpcAffirmative(committed, "committed")) {
      const winner = await readTerminalVerdict(options.client, sha256);
      if (!winner) {
        throw new SafeSearchLedgerError(
          "lease_superseded",
          "Scan lease was superseded before terminal commit",
        );
      }
      leaseHeld = false;
      if (options.requireProviderCall) {
        // This invocation did call the provider, but a newer fencing
        // owner won. The terminal winner is authoritative.
        return {
          sha256,
          ...winner,
          cacheHit: false,
          providerCalled: true,
        };
      }
      return {
        sha256,
        ...winner,
        cacheHit: false,
        providerCalled: true,
      };
    }

    // The terminal-commit RPC releases only the matching fencing token in
    // the same transaction.
    return { sha256, ...scanned, cacheHit: false };
  } finally {
    if (leaseHeld) {
      try {
        await ledgerRpc(options.client, "fn_release_scan_lease", {
          p_sha256: sha256,
          p_owner: owner,
          p_fencing_token: token,
        });
      } catch {
        // TTL/takeover is the fallback; never mask the primary error.
      }
    }
  }
}
