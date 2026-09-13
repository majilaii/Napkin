import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type BackgroundImportJob, drainBackgroundImports } from "./worker.ts";

const JOB = "1f4cd3fb-5da8-4de6-8a09-b891d1f73b82";
const OWNER = "bb0a2f2e-7887-401d-9360-a068c23f5d73";
const NONCE = "ed4e7559-8910-43d1-805a-f5b42fdbd489";
const LEASE = "2c3a1afd-0f89-4373-9040-d1d71169770b";
const ready = { source_type: "tiktok", candidates: [{ resolution_id: "proof-a" }] };

function fixture() {
  const job: BackgroundImportJob = {
    id: JOB, user_id: OWNER, import_nonce: NONCE,
    request: { url: "https://www.tiktok.com/@chef/video/123", protocol_generation: "v2" },
    status: "processing", attempts: 1, lease_token: LEASE,
  };
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const requests: Request[] = [];
  const notifications: Array<{ job: BackgroundImportJob; count: number }> = [];
  const options = {
    supabase: {
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        return { data: name === "fn_claim_background_imports" ? [job] : true, error: null as { message: string } | null };
      },
    },
    url: "https://backend.example", serviceKey: "test-service-key", internalSecret: "test-internal-secret",
    fetcher: (async (input, init) => {
      requests.push(new Request(input, init));
      return new Response(JSON.stringify({ data: { state: "ready", result: ready } }));
    }) as typeof fetch,
    notifyReady: async (claimed: BackgroundImportJob, count: number) => { notifications.push({ job: claimed, count }); },
  };
  return { job, rpcCalls, requests, notifications, options, run: () => drainBackgroundImports(options) };
}

Deno.test("background worker sends only leased identity to the internal resolver and commits before notifying", async () => {
  const f = fixture();
  assertEquals(await f.run(), { processed: 1 });
  assertEquals(f.rpcCalls[0], { name: "fn_claim_background_imports", args: { p_job_id: null, p_limit: 2 } });
  const request = f.requests[0];
  assertEquals(request.headers.get("x-internal-secret"), "test-internal-secret");
  assertEquals(request.headers.get("apikey"), "test-service-key");
  assertEquals(await request.json(), { action: "resolve_background", job_id: JOB, lease_token: LEASE });
  assertEquals(f.rpcCalls[1], {
    name: "fn_finish_background_import",
    args: { p_job_id: JOB, p_lease_token: LEASE, p_status: "ready", p_response: ready, p_reason: null, p_retry_seconds: 30 },
  });
  assertEquals(f.notifications.length, 1);
  assertEquals(f.notifications[0].job.user_id, OWNER);
  assertEquals(f.notifications[0].count, 1);
});

Deno.test("background worker cannot claim work without internal credentials", async () => {
  for (const key of ["serviceKey", "internalSecret"] as const) {
    const f = fixture();
    f.options[key] = "";
    await assertRejects(f.run, Error, "not configured");
    assertEquals(f.rpcCalls, []);
    assertEquals(f.requests, []);
  }
});

Deno.test("background worker claim failure never spends on extraction", async () => {
  const f = fixture();
  f.options.supabase.rpc = async () => ({ data: null, error: { message: "test database outage" } });
  await assertRejects(f.run, Error, "claim failed");
  assertEquals(f.requests, []);
});

Deno.test("background worker with no due jobs makes no provider request", async () => {
  const f = fixture();
  f.options.supabase.rpc = async () => ({ data: [], error: null });
  assertEquals(await f.run(), { processed: 0 });
  assertEquals(f.requests, []);
  assertEquals(f.notifications, []);
});

Deno.test("background worker persists needs-device without notifying ready", async () => {
  const f = fixture();
  f.options.fetcher = async () => new Response(JSON.stringify({ data: { state: "needs_device", reason: "perception_required" } }));
  await f.run();
  assertEquals(f.rpcCalls[1].args.p_status, "needs_device");
  assertEquals(f.rpcCalls[1].args.p_response, null);
  assertEquals(f.rpcCalls[1].args.p_reason, "perception_required");
  assertEquals(f.notifications, []);
});

Deno.test("background worker refuses empty, oversized and malformed ready results", async () => {
  for (const result of [null, {}, { candidates: [] }, { candidates: Array.from({ length: 21 }, () => ({})) }]) {
    const f = fixture();
    f.options.fetcher = async () => new Response(JSON.stringify({ data: { state: "ready", result } }));
    await f.run();
    assertEquals(f.rpcCalls[1].args.p_status, "pending");
    assertEquals(f.rpcCalls[1].args.p_response, null);
    assertEquals(f.notifications, []);
  }
});

Deno.test("background worker retries HTTP/provider failures with bounded attempts and increasing backoff", async () => {
  for (const [attempts, expectedStatus, delay] of [[1, "pending", 30], [2, "pending", 60], [3, "failed", 120]] as const) {
    for (const status of [401, 409, 429, 500, 503]) {
      const f = fixture();
      f.job.attempts = attempts;
      f.options.fetcher = async () => new Response("upstream failure", { status });
      await f.run();
      assertEquals(f.rpcCalls[1].args.p_status, expectedStatus);
      assertEquals(f.rpcCalls[1].args.p_retry_seconds, delay);
      assertEquals(f.notifications, []);
    }
  }
});

Deno.test("background worker leaves invalid or disappeared sources recoverable on-device", async () => {
  for (const status of [400, 404, 422]) {
    const f = fixture();
    f.options.fetcher = async () => new Response("invalid source", { status });
    await f.run();
    assertEquals(f.rpcCalls[1].args.p_status, "needs_device");
    assertEquals(f.notifications, []);
  }
});

Deno.test("background worker finishes network crashes as a bounded retry", async () => {
  const f = fixture();
  f.options.fetcher = () => Promise.reject(new Error("simulated network disconnect"));
  await f.run();
  assertEquals(f.rpcCalls[1].args.p_status, "pending");
  assertEquals(f.notifications, []);
});

Deno.test("background worker cannot notify from stale or cancelled work", async () => {
  const f = fixture();
  const original = f.options.supabase.rpc;
  f.options.supabase.rpc = async (name, args) => name === "fn_finish_background_import"
    ? { data: false, error: null }
    : await original(name, args);
  await f.run();
  assertEquals(f.notifications, []);
});

Deno.test("background worker cannot report completion or notify when result persistence failed", async () => {
  const f = fixture();
  const original = f.options.supabase.rpc;
  f.options.supabase.rpc = async (name, args) => name === "fn_finish_background_import"
    ? { data: null, error: { message: "test persistence failure" } }
    : await original(name, args);
  await assertRejects(f.run, Error, "completion failed");
  assertEquals(f.notifications, []);
});
