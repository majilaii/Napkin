/**
 * Cron/owner entry point for the durable restaurant-completeness pipeline.
 * Gateway JWT verification is disabled; both auth modes are verified here.
 */

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders } from "../_shared/cors.ts";
import { timingSafeSecretEqual } from "../_shared/completeness.ts";
import { reportError } from "../_shared/report.ts";
import {
  correctExhaustedCompletenessItem,
  dismissExhaustedCompletenessItem,
  listExhaustedCompletenessItems,
  parseExhaustedCursor,
  retryExhaustedCompletenessItem,
} from "./_exhausted.ts";
import { getCompletenessJobStatus } from "./_status.ts";
import {
  type CompletenessWorkerBackend,
  DefaultCompletenessBackend,
  drainCompletenessQueue,
  runCompletenessDeployGate,
} from "./_worker.ts";

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface HandlerDependencies {
  createSupabase?: (url: string, key: string) => SupabaseLike;
  env?: (name: string) => string | undefined;
  createBackend?: (supabase: SupabaseLike) => CompletenessWorkerBackend;
  drain?: typeof drainCompletenessQueue;
  deployGate?: typeof runCompletenessDeployGate;
  listExhausted?: typeof listExhaustedCompletenessItems;
  retryExhausted?: typeof retryExhaustedCompletenessItem;
  dismissExhausted?: typeof dismissExhaustedCompletenessItem;
  correctExhausted?: typeof correctExhaustedCompletenessItem;
  getStatus?: typeof getCompletenessJobStatus;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function edgeError(code: string, message: string, status: number): Response {
  return jsonResponse({ error: { code, message } }, status);
}

function enabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true" || value?.trim() === "1";
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.trim() === "") return {};
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function bearerToken(req: Request): string | null {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

function cronAuthorized(
  req: Request,
  env: (name: string) => string | undefined,
): boolean {
  // The caller key is pinned explicitly because modern sb_secret_* API keys
  // are opaque and therefore differ from the hosted runtime's legacy
  // SUPABASE_SERVICE_ROLE_KEY JWT. Cron callers send that pinned key through
  // `apikey`, as required for service-to-service Edge Function calls.
  // Evaluate both factors even when one is wrong so the response path does
  // not reveal which credential failed.
  const cronSecretMatches = timingSafeSecretEqual(
    req.headers.get("x-completeness-cron"),
    env("COMPLETENESS_CRON_SECRET")?.trim(),
  );
  const callerKeyMatches = timingSafeSecretEqual(
    req.headers.get("apikey"),
    env("COMPLETENESS_SERVICE_ROLE_KEY")?.trim(),
  );
  return cronSecretMatches && callerKeyMatches;
}

export function createRestaurantCompletenessHandler(
  dependencies: HandlerDependencies = {},
) {
  const env = dependencies.env ?? ((name: string) => Deno.env.get(name));
  const createSupabase = dependencies.createSupabase ??
    ((url, key) => createClient(url, key));
  const drain = dependencies.drain ?? drainCompletenessQueue;
  const deployGate = dependencies.deployGate ?? runCompletenessDeployGate;
  const listExhausted = dependencies.listExhausted ??
    listExhaustedCompletenessItems;
  const retryExhausted = dependencies.retryExhausted ??
    retryExhaustedCompletenessItem;
  const dismissExhausted = dependencies.dismissExhausted ??
    dismissExhaustedCompletenessItem;
  const correctExhausted = dependencies.correctExhausted ??
    correctExhaustedCompletenessItem;
  const getStatus = dependencies.getStatus ?? getCompletenessJobStatus;

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") {
      return edgeError("METHOD_NOT_ALLOWED", "POST required", 405);
    }

    let body: Record<string, unknown>;
    try {
      body = await readBody(req);
    } catch {
      return edgeError("INVALID_INPUT", "Invalid JSON body", 400);
    }
    const url = new URL(req.url);
    const queryAction = url.searchParams.get("action");
    const bodyAction = typeof body.action === "string" ? body.action : null;
    if (queryAction && bodyAction && queryAction !== bodyAction) {
      return edgeError("INVALID_INPUT", "Conflicting action values", 400);
    }
    const action = queryAction ?? bodyAction ?? "drain";

    const supabaseUrl = env("SUPABASE_URL");
    const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return edgeError(
        "MISCONFIGURED",
        "Completeness runtime is not configured",
        503,
      );
    }
    const supabase = createSupabase(supabaseUrl, serviceRoleKey);

    try {
      // Owner surfaces use a real JWT even though the data client itself is
      // service-role. p_actor is always the validated user.id.
      if (
        action === "exhausted" || action === "retry" || action === "dismiss" ||
        action === "correct" || action === "status"
      ) {
        const token = bearerToken(req);
        if (!token) {
          return edgeError("UNAUTHORIZED", "Missing bearer token", 401);
        }
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user?.id) {
          return edgeError("UNAUTHORIZED", "Unauthorized", 401);
        }

        if (action === "exhausted") {
          const cursor = parseExhaustedCursor(body.cursor);
          if (cursor === undefined) {
            return edgeError("INVALID_INPUT", "cursor is invalid", 400);
          }
          const page = await listExhausted(supabase, user.id, cursor);
          return jsonResponse({ data: page });
        }

        if (action === "status") {
          const jobId = typeof body.job_id === "string" ? body.job_id : "";
          if (!UUID_RE.test(jobId)) {
            return edgeError("INVALID_INPUT", "job_id must be a UUID", 400);
          }
          const status = await getStatus(supabase, user.id, jobId);
          if (!status) {
            return edgeError("NOT_FOUND", "Completeness job not found", 404);
          }
          return jsonResponse({ data: status });
        }

        const itemId = typeof body.item_id === "string" ? body.item_id : "";
        if (!UUID_RE.test(itemId)) {
          return edgeError("INVALID_INPUT", "item_id must be a UUID", 400);
        }
        if (action === "dismiss") {
          const dismissed = await dismissExhausted(supabase, user.id, itemId);
          if (!dismissed) {
            return edgeError("NOT_FOUND", "Exhausted item not found", 404);
          }
          return jsonResponse({
            data: { item_id: itemId, state: "exhausted", dismissed: true },
          });
        }
        if (action === "correct") {
          const resolutionId = typeof body.resolution_id === "string"
            ? body.resolution_id
            : "";
          if (!UUID_RE.test(resolutionId)) {
            return edgeError(
              "INVALID_INPUT",
              "resolution_id must be a UUID",
              400,
            );
          }
          const corrected = await correctExhausted(
            supabase,
            user.id,
            itemId,
            resolutionId,
          );
          if (!corrected) {
            return edgeError("NOT_FOUND", "Exhausted item not found", 404);
          }
          return jsonResponse({ data: corrected });
        }
        const retried = await retryExhausted(supabase, user.id, itemId);
        if (!retried) {
          return edgeError("NOT_FOUND", "Exhausted item not found", 404);
        }
        return jsonResponse({ data: { item_id: itemId, state: "pending" } });
      }

      if (action !== "drain" && action !== "deploy_gate") {
        return edgeError("INVALID_INPUT", "Unknown action", 400);
      }
      if (!cronAuthorized(req, env)) {
        return edgeError(
          "UNAUTHORIZED",
          "Invalid completeness cron credentials",
          401,
        );
      }

      const workerEnabled = enabled(env("COMPLETENESS_WORKER_ENABLED"));
      if (!workerEnabled) {
        if (action === "deploy_gate") {
          return edgeError(
            "WORKER_DISABLED",
            "Completeness worker is disabled",
            503,
          );
        }
        // Default-inert is a healthy 200 so the pre-enable empty-drain
        // deployment smoke can prove endpoint + secrets without DB work.
        return jsonResponse({
          data: {
            enabled: false,
            worker_id: null,
            claimed: 0,
            processed: [],
            swept_jobs: 0,
          },
        });
      }

      const backend = dependencies.createBackend
        ? dependencies.createBackend(supabase)
        : new DefaultCompletenessBackend(supabase, {
          googleApiKey: env("GOOGLE_PLACES_API_KEY"),
          // Redundant Edge fast path. The DB completeness_control row
          // remains authoritative inside fn_charge_sku_budget.
          spendFrozen: enabled(env("COMPLETENESS_SPEND_FROZEN")),
        });

      if (action === "deploy_gate") {
        const ownerId = typeof body.owner_id === "string" ? body.owner_id : "";
        const restaurantId = typeof body.restaurant_id === "string"
          ? body.restaurant_id
          : "";
        const importNonce = typeof body.import_nonce === "string"
          ? body.import_nonce
          : "";
        if (
          ![ownerId, restaurantId, importNonce].every((value) =>
            UUID_RE.test(value)
          )
        ) {
          return edgeError(
            "INVALID_INPUT",
            "owner_id, restaurant_id, and import_nonce must be UUIDs",
            400,
          );
        }
        const result = await deployGate(backend, {
          owner_id: ownerId,
          restaurant_id: restaurantId,
          import_nonce: importNonce,
        });
        return jsonResponse({
          data: { enabled: true, terminal: true, ...result },
        });
      }

      const result = await drain(backend, {
        batchLimit: typeof body.batch_limit === "number"
          ? body.batch_limit
          : (typeof body.limit === "number" ? body.limit : undefined),
        sweepLimit: typeof body.sweep_limit === "number"
          ? body.sweep_limit
          : undefined,
      });
      return jsonResponse({ data: { enabled: true, ...result } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("GATE_RESTAURANT_")) {
        return edgeError(
          "GATE_RESTAURANT_INCOMPLETE",
          "Gate restaurant is not complete",
          409,
        );
      }
      if (
        message.includes("correction resolution") ||
        message.includes("CORRECTION_RESOLUTION_REUSED") ||
        message.includes("cannot be rebound")
      ) {
        return edgeError(
          "INVALID_CORRECTION",
          "Correction provenance is no longer valid",
          409,
        );
      }
      reportError(error, { fn: "restaurant-completeness", action });
      console.error("restaurant-completeness error:", error);
      return edgeError("INTERNAL", "Restaurant completeness failed", 500);
    }
  };
}

if (import.meta.main) {
  serve(createRestaurantCompletenessHandler());
}
