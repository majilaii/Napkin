/** Owner-bound, read/review-only resolution for leased background import jobs. */
import { corsHeaders } from "../_shared/cors.ts";
import { timingSafeSecretEqual } from "../_shared/completeness.ts";
import { isUuid } from "../_shared/uuid.ts";
import { validateUrl } from "../_shared/urlValidation.ts";
import { isInstagramUrl } from "../_shared/socialHost.ts";
import type { PhotoExtractionContext } from "../_shared/visionExtract.ts";
import type { SourceType } from "./_helpers.ts";
import { evaluateFastPath, type FastPathCandidate } from "./backgroundFastPath.ts";
import { isCanonicalTikTokVideo, isDirectBackgroundMapsPlace, isTrustedTikTokUrl } from "./backgroundSourceUrl.ts";

export interface BackgroundImportJob {
  id: string;
  user_id: string;
  import_nonce: string;
  request: Record<string, unknown>;
  status: string;
  lease_token: string | null;
  lease_until: string | null;
}

export interface BackgroundResolveContext {
  ownerId: string;
  importNonce: string;
  internalSecret: string;
}

interface TikTokMetadata {
  title: string;
  author_unique_id?: string;
  author_name?: string;
  thumbnail_url?: string;
  embed_product_id?: string;
}

export interface BackgroundResolveDependencies {
  internalSecret: string | undefined;
  now?: () => number;
  loadJob(id: string): Promise<BackgroundImportJob | null>;
  rateAllowed(ownerId: string): Promise<boolean>;
  detectSource(url: URL): SourceType;
  expandTikTokVideo(url: URL): Promise<URL | null>;
  fetchTikTok(url: string): Promise<TikTokMetadata | null>;
  resolveVideo(
    context: BackgroundResolveContext,
    text: string,
    caption: string | null,
    photoContext?: PhotoExtractionContext,
  ): Promise<Response>;
  resolveUrl(context: BackgroundResolveContext, url: URL, source: SourceType): Promise<Response>;
  attachProvenance(context: BackgroundResolveContext, response: Response): Promise<Response>;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function error(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}

function needsDevice(reason: string): Response {
  return json({ data: { state: "needs_device", reason } });
}

/** Never accept caller-supplied owner/input or a stale lease as server authority. */
export async function resolveBackgroundImport(
  req: Request,
  body: Record<string, unknown>,
  dependencies: BackgroundResolveDependencies,
): Promise<Response> {
  if (!timingSafeSecretEqual(req.headers.get("x-internal-secret"), dependencies.internalSecret)) {
    return error("UNAUTHORIZED", "Invalid or missing internal secret", 401);
  }
  if (!isUuid(body.job_id) || !isUuid(body.lease_token)) {
    return error("INVALID_INPUT", "job_id and lease_token must be UUIDs", 400);
  }
  const job = await dependencies.loadJob(body.job_id);
  const now = dependencies.now ?? Date.now;
  const liveLease = (row: BackgroundImportJob | null) => !!row &&
    row.id === body.job_id && row.status === "processing" &&
    row.lease_token === body.lease_token && !!row.lease_until &&
    Date.parse(row.lease_until) > now();
  if (!liveLease(job)) return error("STALE_LEASE", "Import lease is no longer active", 409);
  if (!job || !isUuid(job.user_id) || !isUuid(job.import_nonce) ||
    !job.request || typeof job.request !== "object" || Array.isArray(job.request)) {
    return error("INVALID_JOB", "Import job is invalid", 400);
  }

  const input = job.request;
  const rawUrl = typeof input.url === "string" ? input.url.trim() : "";
  let url: URL | null = null;
  if (rawUrl) {
    const checked = validateUrl(rawUrl);
    if (!checked.ok) return error("INVALID_URL", "Import URL is invalid", 400);
    url = checked.url;
  }
  // Short/mobile aliases must never fall into the less restrictive web tier.
  const source = url
    ? isInstagramUrl(url.href) ? "instagram"
    : url.hostname === "tiktok.com" || url.hostname.endsWith(".tiktok.com") ? "tiktok"
    : dependencies.detectSource(url)
    : input.source_type;
  const text = typeof input.extracted_text === "string" ? input.extracted_text.trim() : "";
  let caption = typeof input.caption === "string" ? input.caption.trim() : "";
  if (text.length > 32_000 || caption.length > 8_000) {
    return error("INVALID_INPUT", "Import evidence is too long", 400);
  }
  const perceptionComplete = input.perception_complete === true && text.length > 0;
  if (!url && !perceptionComplete) return needsDevice("perception_required");
  if (!perceptionComplete && source === "tiktok" && url) {
    // Even an alias with a good caption may hide a photo carousel. Only a
    // confirmed video URL can earn readiness from caption evidence alone.
    if (!isTrustedTikTokUrl(url) || url.pathname.includes("/photo/")) {
      return needsDevice("perception_required");
    }
    if (!isCanonicalTikTokVideo(url)) {
      url = await dependencies.expandTikTokVideo(url);
      if (!url || !isCanonicalTikTokVideo(url)) return needsDevice("perception_required");
    }
  }
  if (source === "instagram" && !caption && !text) return needsDevice("perception_required");
  if (!perceptionComplete && source !== "tiktok" && source !== "instagram") {
    // General webpage unfurls and Maps short/list expansion are deliberately
    // left to the existing device path. Direct named Maps links need no fetch
    // of the supplied URL, so they can use the pinned Places services safely.
    if (source !== "google_maps" || !url || !isDirectBackgroundMapsPlace(url)) {
      return needsDevice("url_requires_device");
    }
  }
  if (!await dependencies.rateAllowed(job.user_id)) {
    return error("RATE_LIMITED", "Too many import requests", 429);
  }

  const context: BackgroundResolveContext = {
    ownerId: job.user_id,
    importNonce: job.import_nonce,
    internalSecret: dependencies.internalSecret!,
  };
  let response: Response;
  let metadata: TikTokMetadata | null = null;
  if (perceptionComplete || source === "tiktok" || source === "instagram") {
    if (source === "tiktok" && !caption && !perceptionComplete && url) {
      metadata = await dependencies.fetchTikTok(url.href);
      caption = metadata?.title.trim().slice(0, 8_000) ?? "";
    }
    if (!text && !caption) return needsDevice("perception_required");
    const photo = input.photo_context;
    const photoContext = photo && typeof photo === "object" && !Array.isArray(photo) &&
        (photo as Record<string, unknown>).sourceKind === "photo" &&
        Number.isInteger((photo as Record<string, unknown>).slideCount) &&
        Number((photo as Record<string, unknown>).slideCount) > 0 &&
        Number((photo as Record<string, unknown>).slideCount) <= 12
      ? photo as PhotoExtractionContext
      : undefined;
    response = await dependencies.resolveVideo(context, text, caption || null, photoContext);
  } else if (url) {
    response = await dependencies.resolveUrl(context, url, source as SourceType);
  } else {
    return needsDevice("perception_required");
  }
  if (!response.ok) return response;
  const envelope = await response.json();
  const result = envelope?.data;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return error("INVALID_RESPONSE", "Import resolver returned invalid data", 503);
  }
  // Large Maps imports require their existing explicit kickoff and chunked path.
  if (result.mode === "large_list") return needsDevice("large_list");
  const candidates: Array<FastPathCandidate & { resolution_decision?: string }> =
    Array.isArray(result.candidates) ? result.candidates : [];
  if (candidates.some(candidate =>
    ["transient", "unattempted_budget"].includes(candidate.resolution_decision ?? "")
  )) {
    return error("UPSTREAM_UNAVAILABLE", "Import matching needs another attempt", 503);
  }
  if (candidates.length === 0) return needsDevice("no_candidates");
  if (!perceptionComplete && (source === "tiktok" || source === "instagram")) {
    const gate = evaluateFastPath({
      provider: source,
      candidates,
      listCountRaw: result.list_count_raw,
      transcriptChars: text.length,
      caption,
    });
    if (gate !== "pass") return needsDevice("insufficient_evidence");
  }
  // Preserve the original clipping provider and oEmbed attribution in review.
  if (source === "tiktok" || source === "instagram") result.source_type = source;
  if (metadata) {
    result.partial_source = {
      ...result.partial_source,
      ...(metadata.author_unique_id ? { author_handle: metadata.author_unique_id } : {}),
      ...(metadata.author_name ? { author_name: metadata.author_name } : {}),
      ...(metadata.thumbnail_url ? { thumbnail_url: metadata.thumbnail_url } : {}),
      ...(metadata.embed_product_id ? { embed_product_id: metadata.embed_product_id } : {}),
    };
  }
  // A cancelled/timed-out/reclaimed job cannot mint new usable evidence.
  if (!liveLease(await dependencies.loadJob(job.id))) {
    return error("STALE_LEASE", "Import lease is no longer active", 409);
  }
  const bound = await dependencies.attachProvenance(context, json({ data: result }));
  if (!bound.ok) return bound;
  const boundEnvelope = await bound.json();
  return json({ data: { state: "ready", result: boundEnvelope.data } });
}
