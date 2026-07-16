import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders } from "../_shared/cors.ts";
import { reportError } from "../_shared/report.ts";
import { isJobAction, JOB_ACTIONS, runFencedJob } from "./jobHarness.ts";
import {
  createJobHarnessAdapter,
  createProcessor,
  loadModerationJobsConfig,
  preflightModerationJobs,
  runAlarmSelftest,
} from "./runtime.ts";

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface ModerationJobsDeps {
  createSupabase: (url: string, key: string) => any;
  fetchImpl: FetchLike;
  env: (name: string) => string | undefined;
  uuid: () => string;
}

const defaultDeps: ModerationJobsDeps = {
  createSupabase: (url, key) => createClient(url, key),
  fetchImpl: fetch,
  env: (name) => Deno.env.get(name),
  uuid: () => crypto.randomUUID(),
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

async function requestBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function createModerationJobsHandler(
  overrides: Partial<ModerationJobsDeps> = {},
) {
  const deps = { ...defaultDeps, ...overrides };
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (request.method !== "POST") return json({ error: "POST only" }, 405);

    const configuredToken = deps.env("MODERATION_CRON_TOKEN") ?? "";
    const suppliedToken = request.headers.get("x-moderation-cron-token") ?? "";
    if (!configuredToken) {
      return json({ error: "moderation jobs are not configured" }, 503);
    }
    if (!constantTimeEqual(suppliedToken, configuredToken)) {
      return json({ error: "unauthorized" }, 401);
    }

    const body = await requestBody(request);
    const rawAction = typeof body.action === "string" ? body.action : "";
    if (!isJobAction(rawAction)) {
      return json({ error: "invalid action", allowed: JOB_ACTIONS }, 400);
    }

    const config = loadModerationJobsConfig(deps.env);
    if (!config.supabaseUrl || !config.serviceKey) {
      return json({ error: "Supabase service configuration is missing" }, 503);
    }
    const client = deps.createSupabase(config.supabaseUrl, config.serviceKey);

    try {
      if (body.preflight === true) {
        if (rawAction !== "ops-alarm") {
          return json({
            error: "preflight is only available through ops-alarm",
          }, 400);
        }
        await preflightModerationJobs(config, deps.fetchImpl, JOB_ACTIONS);
        return json({ data: { preflight: "ok", actions: JOB_ACTIONS } });
      }

      const holder = `edge:${deps.uuid()}`;
      const harness = createJobHarnessAdapter(client, config, deps.fetchImpl);

      if (rawAction === "alarm_selftest") {
        // Manual/live-runbook only. A deliberate confirmation string
        // prevents a generic workflow dispatch or probe from training
        // alert fatigue and intentionally missing a heartbeat.
        if (body.confirm !== "LIVE_ALARM_SELFTEST") {
          return json({ error: "manual confirmation required" }, 400);
        }
        const lease = await harness.claim(rawAction, holder);
        if (!lease) return json({ data: { status: "busy" } }, 202);
        try {
          if (!await harness.renew(lease)) {
            return json({ error: "self-test lease was superseded" }, 409);
          }
          const selftest = await runAlarmSelftest(
            client,
            config,
            deps.fetchImpl,
            lease,
          );
          if (!await harness.renew(lease)) {
            return json({ error: "self-test lease was superseded" }, 409);
          }
          const completed = await harness.complete(lease, {
            itemsProcessed: 1,
            cursor: selftest.idempotencyKey,
          });
          if (!completed) {
            return json({ error: "self-test lease was superseded" }, 409);
          }
          // Intentionally no harness.pingHeartbeat here. The external
          // service's missed-heartbeat email is half of this live test.
          return json({ data: { status: "ok", ...selftest } });
        } catch (error) {
          const message = error instanceof Error
            ? error.message
            : String(error);
          await harness.fail(
            lease,
            message,
            new Date(Date.now() + 6 * 60 * 60 * 1_000).toISOString(),
          );
          throw error;
        }
      }

      const result = await runFencedJob(
        rawAction,
        holder,
        createProcessor(rawAction, client, config, deps.fetchImpl),
        harness,
      );
      if (result.status === "failed") return json({ error: "job failed" }, 500);
      if (result.status === "superseded") {
        return json({ error: "job lease superseded" }, 409);
      }
      return json({ data: result }, result.status === "busy" ? 202 : 200);
    } catch (error) {
      console.error("moderation-jobs error:", error);
      reportError(error, { fn: "moderation-jobs", action: rawAction });
      return json({ error: "moderation job failed" }, 500);
    }
  };
}

if (import.meta.main) {
  serve(createModerationJobsHandler());
}
