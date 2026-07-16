import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders } from "../_shared/cors.ts";
import { reportError } from "../_shared/report.ts";
import {
  type CanonicalImage,
  canonicalizeImage,
  generateCanonicalCanary,
  inspectImageHeaders,
  sha256Hex,
} from "../_shared/imageCanonical.ts";
import {
  resolveSafeSearchVerdict,
  SafeSearchLedgerError,
  type SafeSearchResult,
  scanSafeSearch,
  VisionSafeSearchError,
} from "../_shared/visionSafeSearch.ts";

export const STAGING_BUCKET = "image-staging";
export const MAX_STAGE_BYTES = 5 * 1024 * 1024;
export const STORAGE_PUT_DEADLINE_MS = 60_000;
const STORAGE_READ_DEADLINE_MS = 60_000;
const STORAGE_CLEANUP_DEADLINE_MS = 10_000;
export const MODERATION_DEADLINE_MS = 10_000;

export type ImageKind = "avatar" | "entry_photo";
type SupabaseClientLike = any;
type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface ModerateImageDeps {
  createSupabase: (url: string, serviceKey: string) => SupabaseClientLike;
  fetchImpl: FetchLike;
  canonicalize: typeof canonicalizeImage;
  generateCanary: typeof generateCanonicalCanary;
  scan: (
    bytes: Uint8Array,
    apiKey: string,
    options: { fetchImpl: FetchLike; signal?: AbortSignal },
  ) => Promise<SafeSearchResult>;
  sha256: typeof sha256Hex;
  uuid: () => string;
  env: (name: string) => string | undefined;
  moderationDeadlineMs: number;
}

export interface StorageRequestOptions {
  fetchImpl: FetchLike;
  supabaseUrl: string;
  serviceKey: string;
  bucket: string;
  path: string;
  bytes: Uint8Array;
  contentType: string;
  timeoutMs?: number;
  cacheControl?: string;
  signal?: AbortSignal;
}

export interface ModerateOwnedStorageObjectOptions {
  /** Service-role client; caller has already selected a DB-owned work item. */
  client: SupabaseClientLike;
  supabaseUrl: string;
  serviceKey: string;
  visionApiKey: string;
  userId: string;
  sourceBucket: "avatars" | "entry-photos";
  /** Bucket-relative legacy path. URLs and non-owner prefixes are rejected. */
  sourcePath: string;
  kind: ImageKind;
  signal?: AbortSignal;
  fetchImpl?: FetchLike;
  canonicalize?: typeof canonicalizeImage;
  scan?: ModerateImageDeps["scan"];
  sha256?: typeof sha256Hex;
  uuid?: () => string;
}

export type OwnedStorageModerationResult =
  | {
    verdict: "rejected";
    sha256: string;
    likelihoods: SafeSearchResult["likelihoods"];
  }
  | {
    verdict: "pass";
    approved_url: string;
    storage_path: string;
    bucket: "avatars" | "entry-photos";
    sha256: string;
  };

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class BodyLimitError extends Error {
  constructor(readonly limit: number) {
    super(`Image exceeds the ${limit} byte limit`);
    this.name = "BodyLimitError";
  }
}

export class StorageRequestError extends Error {
  constructor(
    readonly operation: "upload" | "download" | "delete",
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = "StorageRequestError";
  }
}

const defaultDeps: ModerateImageDeps = {
  createSupabase: (url, key) => createClient(url, key),
  fetchImpl: fetch,
  canonicalize: canonicalizeImage,
  generateCanary: generateCanonicalCanary,
  scan: (bytes, apiKey, options) => scanSafeSearch(bytes, apiKey, options),
  sha256: sha256Hex,
  uuid: () => crypto.randomUUID(),
  env: (name) => Deno.env.get(name),
  moderationDeadlineMs: MODERATION_DEADLINE_MS,
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(error: HttpError): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    }),
    {
      status: error.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

function encodeStoragePath(path: string): string {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function storageObjectUrl(
  supabaseUrl: string,
  bucket: string,
  path: string,
): string {
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/${
    encodeURIComponent(bucket)
  }/${encodeStoragePath(path)}`;
}

function publicObjectUrl(
  supabaseUrl: string,
  bucket: string,
  path: string,
): string {
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${
    encodeURIComponent(bucket)
  }/${encodeStoragePath(path)}`;
}

function serviceHeaders(serviceKey: string): Record<string, string> {
  return { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };
}

function timedController(timeoutMs: number, parent?: AbortSignal) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parent?.reason);
  if (parent?.aborted) abortFromParent();
  else parent?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException("Storage request timed out", "TimeoutError"),
      ),
    timeoutMs,
  );
  return {
    controller,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abortFromParent);
    },
  };
}

/**
 * New-object Storage upload with a real AbortSignal. Supabase Storage's
 * standard create endpoint is POST (PUT is its replace endpoint); x-upsert is
 * pinned false so neither staging nor approved bytes can be swapped in place.
 */
export async function putStorageObject(
  options: StorageRequestOptions,
): Promise<void> {
  const timed = timedController(
    options.timeoutMs ?? STORAGE_PUT_DEADLINE_MS,
    options.signal,
  );
  let response: Response;
  try {
    response = await options.fetchImpl(
      storageObjectUrl(options.supabaseUrl, options.bucket, options.path),
      {
        method: "POST",
        headers: {
          ...serviceHeaders(options.serviceKey),
          "Content-Type": options.contentType,
          "Cache-Control": options.cacheControl ?? "max-age=0",
          "x-upsert": "false",
        },
        body: options.bytes.slice().buffer as ArrayBuffer,
        signal: timed.controller.signal,
      },
    );
  } catch (error) {
    throw new StorageRequestError(
      "upload",
      null,
      timed.controller.signal.aborted
        ? "Storage upload timed out"
        : error instanceof Error
        ? error.message
        : "Storage upload failed",
    );
  } finally {
    timed.dispose();
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new StorageRequestError(
      "upload",
      response.status,
      `Storage upload returned HTTP ${response.status}`,
    );
  }
  await response.body?.cancel().catch(() => {});
}

export async function deleteStorageObject(options: {
  fetchImpl: FetchLike;
  supabaseUrl: string;
  serviceKey: string;
  bucket: string;
  path: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<void> {
  const timed = timedController(
    options.timeoutMs ?? STORAGE_CLEANUP_DEADLINE_MS,
    options.signal,
  );
  let response: Response;
  try {
    response = await options.fetchImpl(
      `${options.supabaseUrl.replace(/\/$/, "")}/storage/v1/object/${
        encodeURIComponent(options.bucket)
      }`,
      {
        method: "DELETE",
        headers: {
          ...serviceHeaders(options.serviceKey),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prefixes: [options.path] }),
        signal: timed.controller.signal,
      },
    );
  } catch (error) {
    throw new StorageRequestError(
      "delete",
      null,
      error instanceof Error ? error.message : "Storage delete failed",
    );
  } finally {
    timed.dispose();
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new StorageRequestError(
      "delete",
      response.status,
      `Storage delete returned HTTP ${response.status}`,
    );
  }
  await response.body?.cancel().catch(() => {});
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/** Byte-count a stream; Content-Length is deliberately irrelevant. */
export async function readByteStreamLimited(
  stream: ReadableStream<Uint8Array> | null,
  limit = MAX_STAGE_BYTES,
): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new TypeError("Request body yielded a non-byte chunk");
      }
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel("body limit exceeded").catch(() => {});
        throw new BodyLimitError(limit);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return concatChunks(chunks, total);
}

async function downloadStorageObject(options: {
  fetchImpl: FetchLike;
  supabaseUrl: string;
  serviceKey: string;
  bucket: string;
  path: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<Uint8Array> {
  const timed = timedController(STORAGE_READ_DEADLINE_MS, options.signal);
  let response: Response;
  try {
    response = await options.fetchImpl(
      storageObjectUrl(options.supabaseUrl, options.bucket, options.path),
      {
        method: "GET",
        headers: serviceHeaders(options.serviceKey),
        signal: timed.controller.signal,
      },
    );
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new StorageRequestError(
        "download",
        response.status,
        `Storage download returned HTTP ${response.status}`,
      );
    }
    return await readByteStreamLimited(
      response.body,
      options.limit ?? MAX_STAGE_BYTES,
    );
  } catch (error) {
    if (
      error instanceof StorageRequestError || error instanceof BodyLimitError
    ) throw error;
    throw new StorageRequestError(
      "download",
      null,
      timed.controller.signal.aborted
        ? "Storage download timed out"
        : error instanceof Error
        ? error.message
        : "Storage download failed",
    );
  } finally {
    timed.dispose();
  }
}

function bodyMime(bytes: Uint8Array): "image/jpeg" | "image/png" | null {
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) return "image/jpeg";
  if (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) return "image/png";
  return null;
}

function objectData(data: unknown): Record<string, unknown> {
  const value = Array.isArray(data) && data.length === 1 ? data[0] : data;
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

async function rpc(
  client: SupabaseClientLike,
  name: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await client.rpc(name, args);
  if (error) {
    const message = typeof error.message === "string"
      ? error.message
      : `${name} failed`;
    if (/ACCOUNT_DELET|TOMBSTONE/i.test(message)) {
      throw new HttpError(
        409,
        "ACCOUNT_DELETING",
        "Image work is frozen for account deletion",
      );
    }
    if (/STAGE_NOT_FOUND|NOT_FOUND/i.test(message)) {
      throw new HttpError(
        404,
        "STAGING_NOT_FOUND",
        "Staging reservation was not found",
      );
    }
    if (
      /STAGE_NOT_STAGED|STAGE_NOT_MODERATABLE|INVALID_STAGE_STATE/i.test(
        message,
      )
    ) {
      throw new HttpError(
        409,
        "STAGING_NOT_READY",
        "Staging reservation is not ready",
      );
    }
    if (
      /STAGE_CLAIM_CONFLICT|STAGE_FINISH_CONFLICT|SERIALIZATION/i.test(message)
    ) {
      throw new HttpError(
        409,
        "STAGE_FENCE_REJECTED",
        "Staging generation was consumed, expired, or frozen",
      );
    }
    if (/STAGE_NOT_OWNED|FORBIDDEN/i.test(message)) {
      throw new HttpError(
        403,
        "FORBIDDEN",
        "Staging reservation is not owned by the caller",
      );
    }
    if (/BUDGET|RATE_LIMIT|CAP_EXHAUST/i.test(message)) {
      throw new HttpError(
        429,
        "IMAGE_BUDGET_EXHAUSTED",
        "Image budget is exhausted; retry later",
      );
    }
    throw new HttpError(500, "MODERATION_RPC_FAILED", `${name} failed`);
  }
  return data;
}

function requireAllowed(
  data: unknown,
  code: string,
  message: string,
): Record<string, unknown> {
  const value = objectData(data);
  if (data === false || value.allowed === false || value.ok === false) {
    throw new HttpError(429, code, message);
  }
  return value;
}

function generationValue(value: unknown): number | string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value;
  }
  return null;
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    mismatch |= (a[i % Math.max(1, a.length)] ?? 0) ^
      (b[i % Math.max(1, b.length)] ?? 0);
  }
  return mismatch === 0 && a.length > 0 && b.length > 0;
}

function parseGeneration(value: string | null): string {
  if (!value || !/^\d+$/.test(value)) {
    throw new HttpError(
      400,
      "INVALID_GENERATION",
      "generation must be a non-negative integer",
    );
  }
  return value;
}

function parseBearer(request: Request): string {
  const match = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    throw new HttpError(401, "UNAUTHORIZED", "Missing Authorization header");
  }
  return match[1];
}

async function authenticate(
  client: SupabaseClientLike,
  request: Request,
): Promise<{ id: string }> {
  const token = parseBearer(request);
  const { data: { user } = {}, error } = await client.auth.getUser(token);
  if (error || !user?.id) {
    throw new HttpError(401, "UNAUTHORIZED", "Unauthorized");
  }
  return user;
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("not an object");
    }
    return body as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "INVALID_INPUT", "A JSON object body is required");
  }
}

async function resolveAction(request: Request): Promise<string | null> {
  const queryAction = new URL(request.url).searchParams.get("action");
  if (queryAction) return queryAction;
  if (request.headers.get("content-type")?.includes("application/json")) {
    try {
      const body = await request.clone().json();
      return typeof body?.action === "string" ? body.action : null;
    } catch {
      return null;
    }
  }
  return null;
}

function assertOnlyKeys(body: Record<string, unknown>, allowed: string[]) {
  const allow = new Set([...allowed, "action"]);
  const unexpected = Object.keys(body).filter((key) => !allow.has(key));
  if (unexpected.length > 0) {
    throw new HttpError(
      400,
      "CLIENT_DESTINATION_FORBIDDEN",
      "Destination and storage fields are server-derived",
      { unexpected },
    );
  }
}

function destinationBucket(kind: unknown): "avatars" | "entry-photos" {
  if (kind === "avatar") return "avatars";
  if (kind === "entry_photo") return "entry-photos";
  throw new HttpError(
    400,
    "INVALID_IMAGE_KIND",
    "kind must be avatar or entry_photo",
  );
}

async function bestEffortStageCleanup(
  client: SupabaseClientLike,
  deps: ModerateImageDeps,
  config: { supabaseUrl: string; serviceKey: string },
  userId: string,
  stagingPath: string,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await deleteStorageObject({
      fetchImpl: deps.fetchImpl,
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      bucket: STAGING_BUCKET,
      path: stagingPath,
      signal,
    });
    await rpc(client, "fn_mark_stage_consumed", {
      p_user_id: userId,
      p_staging_path: stagingPath,
    });
  } catch (error) {
    reportError(error, {
      fn: "moderate-image",
      action: "stage_cleanup",
      extra: { user_id: userId, staging_path: stagingPath },
    });
  }
}

async function markWriteFailed(
  client: SupabaseClientLike,
  userId: string,
  stagingPath: string,
  generation: number | string,
): Promise<boolean> {
  try {
    await rpc(client, "fn_mark_stage_write_failed", {
      p_user_id: userId,
      p_staging_path: stagingPath,
      p_generation: generation,
    });
    return true;
  } catch {
    // The durable reservation remains reclaimable even if this annotation
    // loses a race with account deletion or lease reclamation.
    return false;
  }
}

async function beginStage(
  client: SupabaseClientLike,
  userId: string,
  request: Request,
) {
  const body = request.headers.get("content-length") === "0"
    ? {}
    : await jsonBody(request).catch(() => ({}));
  assertOnlyKeys(body, ["kind"]);
  if (body.kind !== undefined) destinationBucket(body.kind);

  const value = objectData(
    await rpc(client, "fn_begin_stage", { p_user_id: userId }),
  );
  const stagingPath = typeof value.staging_path === "string"
    ? value.staging_path
    : typeof value.path === "string"
    ? value.path
    : null;
  const generation = generationValue(value.generation);
  if (!stagingPath || generation === null) {
    throw new HttpError(
      500,
      "INVALID_STAGE_RESERVATION",
      "begin_stage returned an invalid reservation",
    );
  }
  return { staging_path: stagingPath, generation };
}

async function finishStage(
  client: SupabaseClientLike,
  userId: string,
  request: Request,
  deps: ModerateImageDeps,
  config: { supabaseUrl: string; serviceKey: string },
) {
  const url = new URL(request.url);
  const stagingPath = url.searchParams.get("staging_path") ??
    request.headers.get("x-staging-path");
  if (!stagingPath) {
    throw new HttpError(
      400,
      "INVALID_STAGING_PATH",
      "staging_path is required",
    );
  }
  const suppliedGeneration = parseGeneration(
    url.searchParams.get("generation") ??
      request.headers.get("x-staging-generation"),
  );

  let bytes: Uint8Array;
  try {
    bytes = await readByteStreamLimited(request.body, MAX_STAGE_BYTES);
  } catch (error) {
    // Do not let a stale generation delete bytes written by the current one.
    // Only the generation-conditioned state transition authorizes cleanup.
    if (
      await markWriteFailed(client, userId, stagingPath, suppliedGeneration)
    ) {
      await bestEffortStageCleanup(
        client,
        deps,
        config,
        userId,
        stagingPath,
      );
    }
    if (error instanceof BodyLimitError) {
      throw new HttpError(413, "IMAGE_TOO_LARGE", error.message);
    }
    throw new HttpError(
      400,
      "INVALID_IMAGE_BODY",
      "Could not read image bytes",
    );
  }

  const contentType = bodyMime(bytes);
  if (!contentType) {
    if (
      await markWriteFailed(client, userId, stagingPath, suppliedGeneration)
    ) {
      await bestEffortStageCleanup(
        client,
        deps,
        config,
        userId,
        stagingPath,
      );
    }
    throw new HttpError(
      415,
      "UNSUPPORTED_IMAGE_TYPE",
      "Only JPEG and PNG image bytes are supported",
    );
  }

  // This claim is intentionally the final operation before byte arrival. It
  // consumes the caller's generation, renews a full 300s lease, checks the
  // tombstone in the same statement, and returns the NEW generation.
  const claim = objectData(
    await rpc(client, "fn_claim_stage_put", {
      p_user_id: userId,
      p_staging_path: stagingPath,
      p_generation: suppliedGeneration,
    }),
  );
  const consumedGeneration = generationValue(claim.generation);
  if (claim.claimed === false || consumedGeneration === null) {
    throw new HttpError(
      409,
      "STAGE_FENCE_REJECTED",
      "Staging generation was consumed, expired, or frozen",
    );
  }

  try {
    await putStorageObject({
      fetchImpl: deps.fetchImpl,
      supabaseUrl: config.supabaseUrl,
      serviceKey: config.serviceKey,
      bucket: STAGING_BUCKET,
      path: stagingPath,
      bytes,
      contentType,
      timeoutMs: STORAGE_PUT_DEADLINE_MS,
    });
  } catch (error) {
    await bestEffortStageCleanup(
      client,
      deps,
      config,
      userId,
      stagingPath,
    );
    await markWriteFailed(client, userId, stagingPath, consumedGeneration);
    throw error;
  }

  let finish: Record<string, unknown>;
  try {
    finish = objectData(
      await rpc(client, "fn_finish_stage", {
        p_user_id: userId,
        p_staging_path: stagingPath,
        p_generation: consumedGeneration,
        p_succeeded: true,
      }),
    );
  } catch (error) {
    await bestEffortStageCleanup(client, deps, config, userId, stagingPath);
    throw error;
  }

  if (finish.state !== "staged") {
    await bestEffortStageCleanup(client, deps, config, userId, stagingPath);
    throw new HttpError(
      409,
      "STAGE_FINISH_REJECTED",
      "Staged bytes were frozen or superseded",
    );
  }

  return {
    staging_path: stagingPath,
    generation: consumedGeneration,
    state: "staged" as const,
  };
}

async function promoteCanonical(
  client: SupabaseClientLike,
  deps: ModerateImageDeps,
  config: { supabaseUrl: string; serviceKey: string },
  userId: string,
  bucket: "avatars" | "entry-photos",
  sha256: string,
  canonical: Uint8Array,
  signal?: AbortSignal,
) {
  const storagePath = `approved/${userId}/${sha256}.jpg`;
  const approvedUrl = publicObjectUrl(config.supabaseUrl, bucket, storagePath);
  const started = objectData(
    await rpc(client, "fn_begin_image_promotion", {
      p_user_id: userId,
      p_bucket: bucket,
      p_sha256: sha256,
      p_public_url: approvedUrl,
    }),
  );
  const objectId = typeof started.object_id === "string"
    ? started.object_id
    : null;
  if (!objectId) {
    throw new HttpError(
      500,
      "PROMOTION_REGISTRY_FAILED",
      "Promotion did not create a registry object",
    );
  }

  const needsCopy = started.needs_copy !== false &&
    started.state !== "approved";
  if (needsCopy) {
    try {
      await putStorageObject({
        fetchImpl: deps.fetchImpl,
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        bucket,
        path: storagePath,
        bytes: canonical,
        contentType: "image/jpeg",
        cacheControl: "public, max-age=31536000, immutable",
        signal,
      });
    } catch (error) {
      // A retry can encounter bytes written by a prior handler that died
      // before its registry approval update. Accept only bit-identical
      // bytes; x-upsert:false still makes byte swapping impossible.
      if (!(error instanceof StorageRequestError) || error.status !== 409) {
        throw error;
      }
      const existing = await downloadStorageObject({
        fetchImpl: deps.fetchImpl,
        supabaseUrl: config.supabaseUrl,
        serviceKey: config.serviceKey,
        bucket,
        path: storagePath,
        limit: MAX_STAGE_BYTES,
        signal,
      });
      if (await deps.sha256(existing) !== sha256) {
        throw new HttpError(
          500,
          "PROMOTION_HASH_CONFLICT",
          "Approved path contains different bytes",
        );
      }
    }

    const finished = objectData(
      await rpc(client, "fn_finish_image_promotion", {
        p_user_id: userId,
        p_object_id: objectId,
      }),
    );
    if (finished.state !== "approved") {
      throw new HttpError(
        500,
        "PROMOTION_COMMIT_FAILED",
        "Promotion could not be committed",
      );
    }
  }

  return {
    approved_url: approvedUrl,
    storage_path: storagePath,
    bucket,
    sha256,
    verdict: "pass" as const,
  };
}

function assertOwnedLocalSource(
  userId: string,
  bucket: string,
  path: string,
): asserts bucket is "avatars" | "entry-photos" {
  if (bucket !== "avatars" && bucket !== "entry-photos") {
    throw new HttpError(
      400,
      "INVALID_SOURCE_BUCKET",
      "Grandfather source bucket is not allowed",
    );
  }
  if (
    !path ||
    path.includes("://") ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((segment) => segment === "." || segment === "..") ||
    path.split("/")[0] !== userId
  ) {
    throw new HttpError(
      403,
      "SOURCE_NOT_OWNED",
      "Grandfather source must be an owned local object",
    );
  }
}

/**
 * Grandfather/sweep entry point. It accepts only a bucket-relative object under
 * the owning user's legacy prefix, never a foreign URL, then reuses the exact
 * validation/canonical/cache/lease/sweep-budget/Vision/promotion authority as
 * live moderation. Binding and legacy-column rewrite remain the job's atomic
 * responsibility.
 */
export async function moderateOwnedStorageObject(
  options: ModerateOwnedStorageObjectOptions,
): Promise<OwnedStorageModerationResult> {
  assertOwnedLocalSource(
    options.userId,
    options.sourceBucket,
    options.sourcePath,
  );
  const deps: ModerateImageDeps = {
    ...defaultDeps,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.canonicalize ? { canonicalize: options.canonicalize } : {}),
    ...(options.scan ? { scan: options.scan } : {}),
    ...(options.sha256 ? { sha256: options.sha256 } : {}),
    ...(options.uuid ? { uuid: options.uuid } : {}),
  };
  const deadline = timedController(MODERATION_DEADLINE_MS, options.signal);
  try {
    requireAllowed(
      await rpc(options.client, "fn_debit_image_compute", {
        p_user_id: options.userId,
      }),
      "IMAGE_COMPUTE_EXHAUSTED",
      "Image processing budget is exhausted; retry later",
    );
    const source = await downloadStorageObject({
      fetchImpl: deps.fetchImpl,
      supabaseUrl: options.supabaseUrl,
      serviceKey: options.serviceKey,
      bucket: options.sourceBucket,
      path: options.sourcePath,
      signal: deadline.controller.signal,
    });
    const header = inspectImageHeaders(source);
    if (header.ok === false) {
      throw new HttpError(
        header.code === "unsupported_format" ? 415 : 422,
        header.code.toUpperCase(),
        header.message,
      );
    }
    const canonical = await deps.canonicalize(
      source,
      deadline.controller.signal,
    );
    if (!canonical) {
      throw new HttpError(
        422,
        "CANONICAL_TRANSCODE_FAILED",
        "Image could not be safely transcoded",
      );
    }
    const sha256 = await deps.sha256(canonical.data);
    const terminal = await resolveSafeSearchVerdict({
      client: options.client,
      canonicalJpeg: canonical.data,
      sha256,
      userId: options.userId,
      scope: "sweep",
      apiKey: options.visionApiKey,
      owner: deps.uuid(),
      fetchImpl: deps.fetchImpl,
      scanImpl: deps.scan,
      signal: deadline.controller.signal,
    });
    if (deadline.controller.signal.aborted) {
      throw new HttpError(
        503,
        "MODERATION_TIMEOUT",
        "Image moderation timed out; retry",
      );
    }
    if (terminal.verdict === "rejected") {
      return { verdict: "rejected", sha256, likelihoods: terminal.likelihoods };
    }
    const promoted = await promoteCanonical(
      options.client,
      deps,
      { supabaseUrl: options.supabaseUrl, serviceKey: options.serviceKey },
      options.userId,
      destinationBucket(options.kind),
      sha256,
      canonical.data,
      deadline.controller.signal,
    );
    if (deadline.controller.signal.aborted) {
      throw new HttpError(
        503,
        "MODERATION_TIMEOUT",
        "Image moderation timed out; retry",
      );
    }
    return promoted;
  } catch (error) {
    if (deadline.controller.signal.aborted) {
      throw new HttpError(
        503,
        "MODERATION_TIMEOUT",
        "Image moderation timed out; retry",
      );
    }
    throw error;
  } finally {
    deadline.dispose();
  }
}

async function moderateWithinDeadline(
  client: SupabaseClientLike,
  userId: string,
  request: Request,
  deps: ModerateImageDeps,
  config: {
    supabaseUrl: string;
    serviceKey: string;
    visionKey: string | undefined;
  },
  signal: AbortSignal,
) {
  const body = await jsonBody(request);
  assertOnlyKeys(body, ["staging_path", "kind"]);
  const stagingPath = typeof body.staging_path === "string"
    ? body.staging_path
    : null;
  if (!stagingPath) {
    throw new HttpError(
      400,
      "INVALID_STAGING_PATH",
      "staging_path is required",
    );
  }
  const bucket = destinationBucket(body.kind);

  // The RPC holds the per-user lifecycle lock while checking ownership,
  // staged state, and the account-deletion tombstone.
  await rpc(client, "fn_assert_stage_moderatable", {
    p_user_id: userId,
    p_staging_path: stagingPath,
  });

  // Compute is debited before any Storage download or decoder work.
  requireAllowed(
    await rpc(client, "fn_debit_image_compute", { p_user_id: userId }),
    "IMAGE_COMPUTE_EXHAUSTED",
    "Image processing budget is exhausted; retry later",
  );

  const stagedBytes = await downloadStorageObject({
    fetchImpl: deps.fetchImpl,
    supabaseUrl: config.supabaseUrl,
    serviceKey: config.serviceKey,
    bucket: STAGING_BUCKET,
    path: stagingPath,
    signal,
  });

  const header = inspectImageHeaders(stagedBytes);
  if (header.ok === false) {
    await bestEffortStageCleanup(
      client,
      deps,
      config,
      userId,
      stagingPath,
      signal,
    );
    const status = header.code === "unsupported_format" ? 415 : 422;
    throw new HttpError(status, header.code.toUpperCase(), header.message);
  }

  const canonical = await deps.canonicalize(stagedBytes, signal);
  if (!canonical) {
    await bestEffortStageCleanup(
      client,
      deps,
      config,
      userId,
      stagingPath,
      signal,
    );
    throw new HttpError(
      422,
      "CANONICAL_TRANSCODE_FAILED",
      "Image could not be safely transcoded",
    );
  }
  const sha256 = await deps.sha256(canonical.data);

  let terminal: { verdict: "pass" | "rejected" };
  try {
    terminal = await resolveSafeSearchVerdict({
      client,
      canonicalJpeg: canonical.data,
      sha256,
      userId,
      scope: "general",
      apiKey: config.visionKey ?? "",
      owner: deps.uuid(),
      fetchImpl: deps.fetchImpl,
      scanImpl: deps.scan,
      signal,
    });
  } catch (error) {
    if (error instanceof SafeSearchLedgerError) {
      if (error.code === "lease_busy") {
        throw new HttpError(
          429,
          "IMAGE_SCAN_IN_PROGRESS",
          "Identical bytes are already being scanned; retry shortly",
        );
      }
      if (error.code === "budget_exhausted") {
        throw new HttpError(
          429,
          "IMAGE_SCAN_BUDGET_EXHAUSTED",
          "Daily image scan budget is exhausted; retry later",
        );
      }
      throw new HttpError(
        503,
        "SCAN_LEDGER_UNAVAILABLE",
        "Image moderation is temporarily unavailable",
      );
    }
    if (error instanceof VisionSafeSearchError) {
      throw new HttpError(
        503,
        "VISION_UNAVAILABLE",
        "Image moderation is temporarily unavailable",
      );
    }
    throw error;
  }

  if (terminal.verdict === "rejected") {
    await bestEffortStageCleanup(
      client,
      deps,
      config,
      userId,
      stagingPath,
      signal,
    );
    throw new HttpError(
      403,
      "MODERATION_REJECTED",
      "This image cannot be used",
    );
  }

  // fn_begin_image_promotion rechecks the deletion tombstone under the same
  // lifecycle lock immediately before it inserts the durable promoting row.
  const promoted = await promoteCanonical(
    client,
    deps,
    config,
    userId,
    bucket,
    sha256,
    canonical.data,
    signal,
  );
  await bestEffortStageCleanup(
    client,
    deps,
    config,
    userId,
    stagingPath,
    signal,
  );
  return promoted;
}

async function moderate(
  client: SupabaseClientLike,
  userId: string,
  request: Request,
  deps: ModerateImageDeps,
  config: {
    supabaseUrl: string;
    serviceKey: string;
    visionKey: string | undefined;
  },
) {
  const deadline = timedController(deps.moderationDeadlineMs);
  try {
    const result = await moderateWithinDeadline(
      client,
      userId,
      request,
      deps,
      config,
      deadline.controller.signal,
    );
    if (deadline.controller.signal.aborted) {
      throw new HttpError(
        503,
        "MODERATION_TIMEOUT",
        "Image moderation timed out; retry",
      );
    }
    return result;
  } catch (error) {
    if (deadline.controller.signal.aborted) {
      throw new HttpError(
        503,
        "MODERATION_TIMEOUT",
        "Image moderation timed out; retry",
      );
    }
    throw error;
  } finally {
    deadline.dispose();
  }
}

async function canary(
  client: SupabaseClientLike,
  userId: string,
  deps: ModerateImageDeps,
  config: { visionKey: string | undefined },
) {
  if (!config.visionKey) {
    throw new HttpError(
      503,
      "VISION_UNAVAILABLE",
      "GOOGLE_VISION_API_KEY is not configured",
    );
  }

  const canonical = await deps.generateCanary();
  if (!canonical || canonical.width * canonical.height !== 4_000_000) {
    throw new HttpError(
      500,
      "CANARY_GENERATION_FAILED",
      "Could not generate a canonical 4MP canary",
    );
  }
  try {
    const scanned = await resolveSafeSearchVerdict({
      client,
      canonicalJpeg: canonical.data,
      userId,
      scope: "canary",
      apiKey: config.visionKey,
      owner: deps.uuid(),
      fetchImpl: deps.fetchImpl,
      scanImpl: deps.scan,
      requireProviderCall: true,
    });
    if (scanned.providerCalled !== true || scanned.cacheHit) {
      throw new HttpError(
        500,
        "CANARY_PROVIDER_NOT_CALLED",
        "Canary did not reach Vision",
      );
    }
    return {
      sha256: scanned.sha256,
      verdict: scanned.verdict,
      provider_called: true,
      cache_hit: false,
      canonical_pixels: canonical.width * canonical.height,
    };
  } catch (error) {
    if (
      error instanceof SafeSearchLedgerError &&
      error.code === "canonical_not_unique"
    ) {
      throw new HttpError(
        500,
        "CANARY_NOT_UNIQUE",
        "Post-canonical canary hash was not unique",
      );
    }
    if (
      error instanceof SafeSearchLedgerError &&
      error.code === "budget_exhausted"
    ) {
      throw new HttpError(
        429,
        "CANARY_BUDGET_EXHAUSTED",
        "Daily canary budget is exhausted",
      );
    }
    throw error;
  }
}

export function createModerateImageHandler(
  overrides: Partial<ModerateImageDeps> = {},
) {
  const deps: ModerateImageDeps = { ...defaultDeps, ...overrides };
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return errorResponse(
        new HttpError(405, "METHOD_NOT_ALLOWED", "POST only"),
      );
    }

    const action = await resolveAction(request);
    try {
      if (
        !["begin_stage", "finish_stage", "moderate", "canary"].includes(
          action ?? "",
        )
      ) {
        throw new HttpError(
          400,
          "INVALID_ACTION",
          "Unknown moderate-image action",
        );
      }

      const supabaseUrl = deps.env("SUPABASE_URL");
      const serviceKey = deps.env("SUPABASE_SERVICE_ROLE_KEY");
      if (!supabaseUrl || !serviceKey) {
        throw new HttpError(
          503,
          "SERVICE_UNAVAILABLE",
          "Image moderation is not configured",
        );
      }
      const client = deps.createSupabase(supabaseUrl, serviceKey);
      if (action === "canary") {
        const configuredToken = deps.env("MODERATION_CRON_TOKEN") ?? "";
        const suppliedToken = request.headers.get("x-moderation-cron-token") ??
          "";
        if (!configuredToken) {
          throw new HttpError(
            503,
            "CANARY_NOT_CONFIGURED",
            "Canary token is not configured",
          );
        }
        if (!constantTimeEqual(suppliedToken, configuredToken)) {
          throw new HttpError(
            403,
            "CANARY_FORBIDDEN",
            "Canary token is invalid",
          );
        }
      }
      const user = await authenticate(client, request);
      const config = {
        supabaseUrl,
        serviceKey,
        visionKey: deps.env("GOOGLE_VISION_API_KEY"),
      };

      if (action === "begin_stage") {
        return jsonResponse(await beginStage(client, user.id, request));
      }
      if (action === "finish_stage") {
        return jsonResponse(
          await finishStage(client, user.id, request, deps, config),
        );
      }
      if (action === "moderate") {
        return jsonResponse(
          await moderate(client, user.id, request, deps, config),
        );
      }
      return jsonResponse(await canary(client, user.id, deps, config));
    } catch (error) {
      const normalized = error instanceof HttpError
        ? error
        : error instanceof BodyLimitError
        ? new HttpError(413, "IMAGE_TOO_LARGE", error.message)
        : error instanceof VisionSafeSearchError
        ? new HttpError(
          503,
          "VISION_UNAVAILABLE",
          "Image moderation is temporarily unavailable",
        )
        : error instanceof StorageRequestError
        ? new HttpError(
          error.status === null ? 504 : 502,
          "STORAGE_UNAVAILABLE",
          "Image storage is temporarily unavailable",
        )
        : new HttpError(500, "INTERNAL", "Internal Server Error");

      if (normalized.status >= 500) {
        console.error("moderate-image error:", error);
        reportError(error, {
          fn: "moderate-image",
          action: action ?? undefined,
        });
      }
      return errorResponse(normalized);
    }
  };
}

if (import.meta.main) {
  serve(createModerateImageHandler());
}
