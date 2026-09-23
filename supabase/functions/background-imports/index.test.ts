import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createBackgroundImportsHandler, EXTENSION_WAKE_DELAY_MS, hashCredential } from "./index.ts";

const OWNER = "bb0a2f2e-7887-401d-9360-a068c23f5d73";
const OTHER = "7cd1d9af-2766-43b2-992f-6167d5f90e67";
const SESSION = "288a9ce3-f329-478b-bdd8-c42f07f0f39a";
const JOB = "1f4cd3fb-5da8-4de6-8a09-b891d1f73b82";
const NONCE = "ed4e7559-8910-43d1-805a-f5b42fdbd489";
const CREDENTIAL = "2c3a1afd-0f89-4373-9040-d1d71169770b";
const INSTALLATION = "0aec3bdd-b0d0-4910-a4fc-29e5a2c74d8f";
const OPAQUE = "nbi_" + "ab".repeat(32);
const JWT = `${btoa('{}')}.${btoa(JSON.stringify({ sub: OWNER, session_id: SESSION }))}.verified-by-test-auth-client`;

type Operation = { name: string; args: unknown[] };
function fixture() {
  const queries: Array<{ table: string; operations: Operation[] }> = [];
  const rpcs: Operation[] = [];
  const userChecks: string[] = [];
  const sleeps: number[] = [];
  const job = { id: JOB, user_id: OWNER, import_nonce: NONCE, request: { url: "https://www.tiktok.com/@chef/video/123", protocol_generation: "v2" }, status: "pending" };
  let queryData: unknown = { id: CREDENTIAL, user_id: OWNER };
  let authError = false;
  let updateError = false;
  const supabase = {
    auth: { getUser: async (token: string) => {
      userChecks.push(token);
      return authError ? { data: { user: null }, error: { message: "expired" } } : { data: { user: { id: OWNER } }, error: null };
    } },
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args: [args] });
      return { data: name === "check_and_increment_rate_limit" ? [{ allowed: true }]
        : name === "fn_dismiss_background_import" ? true : job, error: null };
    },
    from: (table: string) => {
      const query = { table, operations: [] as Operation[] };
      queries.push(query);
      // Match the PostgREST fluent/thenable surface without a network client.
      const builder: Record<string, unknown> = {};
      const result = () => updateError && query.operations.some(op => op.name === "update")
        ? { data: null, error: { message: "test outage" } }
        : { data: queryData, error: null };
      for (const name of ["select", "insert", "update", "eq", "is", "gt", "not", "order", "limit", "in"]) {
        builder[name] = (...args: unknown[]) => { query.operations.push({ name, args }); return builder; };
      }
      builder.maybeSingle = builder.single = () => Promise.resolve(result());
      builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(result()));
      return builder;
    },
  };
  const config: Record<string, string> = {
    SUPABASE_URL: "https://backend.example", SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
    INTERNAL_CALL_SECRET: "test-internal-secret", COMPLETENESS_CRON_SECRET: "test-cron-secret",
    COMPLETENESS_SERVICE_ROLE_KEY: "test-cron-key",
  };
  const handler = createBackgroundImportsHandler({
    supabase, env: name => config[name],
    sleep: async ms => { sleeps.push(ms); },
  });
  return {
    queries, rpcs, userChecks, sleeps, job, config, handler,
    setQueryData: (value: unknown) => queryData = value,
    setAuthError: () => authError = true,
    setUpdateError: () => updateError = true,
    call: (action: string, body: Record<string, unknown> = {}, token = JWT, headers: Record<string, string> = {}) => handler(new Request(`https://backend.example/background-imports?action=${action}`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
    })),
  };
}

Deno.test("background intake opaque credential cannot list, read, mutate or mint credentials", async () => {
  for (const action of ["list", "status", "dismiss", "acknowledge", "retry", "drain", "register_intake"]) {
    const f = fixture();
    assertEquals((await f.call(action, { job_id: JOB }, OPAQUE)).status, 403);
    assertEquals(f.queries, []);
    assertEquals(f.rpcs, []);
    assertEquals(f.userChecks, []);
  }
});

Deno.test("background intake validates scoped token hash/revocation/expiry and binds immutable URL-only input", async () => {
  const f = fixture();
  const res = await f.call("enqueue", {
    job_id: JOB, import_nonce: NONCE, url: f.job.request.url, expected_owner_id: OWNER, protocol_generation: "v2",
    extracted_text: "forged", perception_complete: true, user_id: OTHER,
  }, OPAQUE);
  assertEquals(res.status, 202);
  assertEquals(f.userChecks, []);
  const ops = f.queries[0].operations;
  assertEquals(ops.find(op => op.name === "eq")?.args, ["token_hash", await hashCredential(OPAQUE)]);
  assertEquals(ops.find(op => op.name === "is")?.args, ["revoked_at", null]);
  assertEquals(ops.some(op => op.name === "gt" && op.args[0] === "expires_at"), true);
  assertEquals(f.rpcs[0], { name: "fn_enqueue_background_import", args: [{
    p_owner: OWNER, p_job_id: JOB, p_import_nonce: NONCE,
    p_request: f.job.request, p_credential_id: CREDENTIAL, p_installation_id: null,
  }] });
  assertEquals((await res.json()).data, { job_id: JOB, status: "needs_device" });
  // TICKET-248: the device owns the share.
  const handoff = f.queries.find(query => query.table === "background_import_jobs");
  assertEquals(handoff?.operations, [
    { name: "update", args: [{ status: "needs_device", reason: "device_owns_import", updated_at: (handoff!.operations[0].args[0] as { updated_at: string }).updated_at }] },
    { name: "eq", args: ["id", JOB] },
    { name: "eq", args: ["user_id", OWNER] },
    { name: "eq", args: ["status", "pending"] },
  ]);
  // An installed build's extension upload is answered late so iOS wakes the app.
  assertEquals(f.sleeps, [EXTENSION_WAKE_DELAY_MS]);
});

Deno.test("an enqueue whose handoff fails answers pending and starts nothing (TICKET-249)", async () => {
  const f = fixture();
  f.setUpdateError();
  const res = await f.call("enqueue", {
    job_id: JOB, import_nonce: NONCE, url: f.job.request.url, expected_owner_id: OWNER, protocol_generation: "v2",
  }, OPAQUE);
  assertEquals(res.status, 202);
  assertEquals((await res.json()).data, { job_id: JOB, status: "pending" });
  // No worker and no second RPC: the owner's next status read hands it over.
  assertEquals(f.rpcs.map(rpc => rpc.name), ["fn_enqueue_background_import"]);
});

Deno.test("the app's own (JWT) enqueue is never delayed", async () => {
  const f = fixture();
  const res = await f.call("enqueue", {
    job_id: JOB, import_nonce: NONCE, url: f.job.request.url, expected_owner_id: OWNER, protocol_generation: "v2",
  });
  assertEquals(res.status, 202);
  assertEquals(f.sleeps, []);
});

Deno.test("a share wake authenticates the scoped credential and stores nothing (TICKET-248)", async () => {
  const f = fixture();
  const res = await f.call("wake", { job_id: JOB, expected_owner_id: OWNER }, OPAQUE);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).data, { job_id: JOB, status: "wake" });
  assertEquals(f.sleeps, [EXTENSION_WAKE_DELAY_MS]);
  assertEquals(f.rpcs, []);
  assertEquals(f.queries.map(query => query.table), ["background_import_credentials"]);
});

Deno.test("a share wake refuses a missing owner fence, a bad job id and a dead credential", async () => {
  for (const body of [{ job_id: JOB }, { job_id: "not-a-uuid", expected_owner_id: OWNER }]) {
    const f = fixture();
    assertEquals((await f.call("wake", body, OPAQUE)).status, 400);
  }
  const mismatch = fixture();
  assertEquals((await mismatch.call("wake", { job_id: JOB, expected_owner_id: OTHER }, OPAQUE)).status, 403);
  const revoked = fixture();
  revoked.setQueryData(null);
  assertEquals((await revoked.call("wake", { job_id: JOB, expected_owner_id: OWNER }, OPAQUE)).status, 401);
});

Deno.test("every extension upload answer is held, failures included, so it cannot land in the extension", async () => {
  const revoked = fixture();
  revoked.setQueryData(null);
  assertEquals((await revoked.call("wake", { job_id: JOB, expected_owner_id: OWNER }, OPAQUE)).status, 401);
  assertEquals(revoked.sleeps, [EXTENSION_WAKE_DELAY_MS]);
  const invalid = fixture();
  assertEquals((await invalid.call("enqueue", { job_id: "bad" }, OPAQUE)).status, 400);
  assertEquals(invalid.sleeps, [EXTENSION_WAKE_DELAY_MS]);
  // The app's own calls and other token actions are never held.
  const app = fixture();
  app.setQueryData([app.job]);
  assertEquals((await app.call("list", {})).status, 200);
  assertEquals(app.sleeps, []);
  const revoke = fixture();
  await revoke.call("revoke_intake", {}, OPAQUE);
  assertEquals(revoke.sleeps, []);
});

Deno.test("background intake refuses revoked or expired scoped credentials before enqueue", async () => {
  const f = fixture();
  f.setQueryData(null);
  assertEquals((await f.call("enqueue", {}, OPAQUE)).status, 401);
  assertEquals(f.rpcs, []);
});

Deno.test("background intake refuses account mismatch and missing owner fence", async () => {
  for (const expected of [OTHER, undefined]) {
    const f = fixture();
    const res = await f.call("enqueue", { job_id: JOB, import_nonce: NONCE, url: f.job.request.url, protocol_generation: "v2", expected_owner_id: expected });
    assertEquals(res.status, expected ? 403 : 400);
    assertEquals(f.rpcs, []);
  }
});

Deno.test("background owner reads always carry the authenticated owner", async () => {
  for (const action of ["list", "status"]) {
    const f = fixture();
    f.setQueryData(action === "list" ? [f.job] : f.job);
    assertEquals((await f.call(action, { job_id: JOB })).status, 200);
    for (const query of f.queries) {
      assertEquals(query.operations.some(op => op.name === "eq" && op.args[0] === "user_id" && op.args[1] === OWNER), true);
      if (action !== "list") assertEquals(query.operations.some(op => op.name === "eq" && op.args[0] === "id" && op.args[1] === JOB), true);
    }
  }
});

Deno.test("status hands a pending or processing job of its owner to the device before reading (TICKET-249)", async () => {
  const f = fixture();
  f.setQueryData({ ...f.job, status: "needs_device", reason: "device_owns_import" });
  const res = await f.call("status", { job_id: JOB });
  assertEquals(res.status, 200);
  assertEquals((await res.json()).data.status, "needs_device");
  assertEquals(f.queries.map(query => query.table), ["background_import_jobs", "background_import_jobs"]);
  const [handoff, read] = f.queries;
  assertEquals(handoff.operations, [
    { name: "update", args: [{ status: "needs_device", reason: "device_owns_import", lease_token: null,
      lease_until: null, updated_at: (handoff.operations[0].args[0] as { updated_at: string }).updated_at }] },
    { name: "eq", args: ["id", JOB] },
    { name: "eq", args: ["user_id", OWNER] },
    { name: "in", args: ["status", ["pending", "processing"]] },
  ]);
  assertEquals(read.operations[0].name, "select");
});

Deno.test("a failed status handoff is a 503, never a stale pending job", async () => {
  const f = fixture();
  f.setQueryData(f.job);
  f.setUpdateError();
  assertEquals((await f.call("status", { job_id: JOB })).status, 503);
  // The read never ran, so the old app sees an error and polls again.
  assertEquals(f.queries.length, 1);
});

Deno.test("retired server-lane actions are refused without touching jobs (TICKET-249)", async () => {
  for (const action of ["acknowledge", "retry", "drain"]) {
    const f = fixture();
    assertEquals((await f.call(action, { job_id: JOB })).status, 400);
    assertEquals(f.queries, []);
    assertEquals(f.rpcs, []);
  }
  // The removed cron sent no Authorization header, so its request now stops at auth.
  const cron = fixture();
  const res = await cron.handler(new Request("https://backend.example/background-imports", {
    method: "POST", body: JSON.stringify({ action: "drain" }),
    headers: { "apikey": "test-cron-key", "Content-Type": "application/json", "x-completeness-cron": "test-cron-secret" },
  }));
  assertEquals(res.status, 401);
  assertEquals(cron.userChecks, []);
  assertEquals(cron.queries, []);
  assertEquals(cron.rpcs, []);
});

Deno.test("dismiss persists the original identity before a delayed native upload arrives", async () => {
  const f = fixture();
  assertEquals((await f.call('dismiss', { job_id: JOB, import_nonce: NONCE, url: f.job.request.url })).status, 200);
  assertEquals(f.rpcs[0], { name: 'fn_dismiss_background_import', args: [{
    p_owner: OWNER, p_job_id: JOB, p_import_nonce: NONCE, p_request: f.job.request,
  }] });
  assertEquals(f.rpcs.length, 1);
});

Deno.test('dismiss can retire a permanently rejected oversized source without fetching it', async () => {
  const f = fixture();
  const url = `https://example.com/${'x'.repeat(2049)}`;
  assertEquals((await f.call('dismiss', { job_id: JOB, import_nonce: NONCE, url })).status, 200);
  assertEquals(f.rpcs[0].args, [{ p_owner: OWNER, p_job_id: JOB, p_import_nonce: NONCE,
    p_request: { url, protocol_generation: 'v2' } }]);
});

Deno.test("background intake registration binds verified auth session and stores only the credential hash", async () => {
  const f = fixture();
  const res = await f.call("register_intake", { installation_id: INSTALLATION });
  const data = (await res.json()).data;
  assertEquals(res.status, 200);
  assertMatch(data.token, /^nbi_[0-9a-f]{64}$/);
  const record = f.queries[0].operations.find(op => op.name === "insert")?.args[0] as Record<string, unknown>;
  assertEquals(record.session_id, SESSION);
  assertEquals(record.user_id, OWNER);
  assertEquals(record.token_hash, await hashCredential(data.token));
  assertEquals(record.token, undefined);
  assertEquals(record.refresh_token, undefined);
});

Deno.test("background intake registration requires both valid auth and a signed session claim", async () => {
  const f = fixture();
  f.setAuthError();
  assertEquals((await f.call("register_intake", { installation_id: INSTALLATION })).status, 401);
  assertEquals(f.queries, []);
  const noSession = fixture();
  assertEquals((await noSession.call("register_intake", { installation_id: INSTALLATION }, "test-without-session")).status, 401);
  assertEquals(noSession.queries, []);
});

Deno.test("background intake rejects conflicting action and oversized body before auth", async () => {
  const f = fixture();
  assertEquals((await f.call("enqueue", { action: "list" })).status, 400);
  assertEquals((await f.call("enqueue", { excess: "a".repeat(65536) })).status, 400);
  assertEquals(f.userChecks, []);
  assertEquals(f.queries, []);
});
