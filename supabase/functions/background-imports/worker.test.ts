import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type BackgroundImportJob, drainBackgroundImports } from "./worker.ts";

const JOB = "1f4cd3fb-5da8-4de6-8a09-b891d1f73b82";
const OWNER = "bb0a2f2e-7887-401d-9360-a068c23f5d73";
const NONCE = "ed4e7559-8910-43d1-805a-f5b42fdbd489";
const LEASE = "2c3a1afd-0f89-4373-9040-d1d71169770b";

function fixture() {
  const job: BackgroundImportJob = {
    id: JOB, user_id: OWNER, import_nonce: NONCE,
    request: { url: "https://www.tiktok.com/@chef/video/123", protocol_generation: "v2" },
    status: "processing", attempts: 1, lease_token: LEASE,
  };
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const options = {
    supabase: {
      rpc: async (name: string, args: Record<string, unknown>) => {
        rpcCalls.push({ name, args });
        return { data: name === "fn_claim_background_imports" ? [job] : true, error: null as { message: string } | null };
      },
    },
  };
  return { job, rpcCalls, options, run: (jobId?: string) => drainBackgroundImports({ ...options, jobId }) };
}

Deno.test("TICKET-248: a claimed job is handed to its device, never resolved on the server", async () => {
  const f = fixture();
  assertEquals(await f.run(), { processed: 1 });
  assertEquals(f.rpcCalls[0], { name: "fn_claim_background_imports", args: { p_job_id: null, p_limit: 5 } });
  assertEquals(f.rpcCalls[1], {
    name: "fn_finish_background_import",
    args: { p_job_id: JOB, p_lease_token: LEASE, p_status: "needs_device", p_response: null,
      p_reason: "device_owns_import", p_retry_seconds: 30 },
  });
  assertEquals(f.rpcCalls.length, 2);
});

Deno.test("an immediate kick claims only its own job", async () => {
  const f = fixture();
  await f.run(JOB);
  assertEquals(f.rpcCalls[0].args, { p_job_id: JOB, p_limit: 1 });
});

Deno.test("background worker claim failure hands nothing off", async () => {
  const f = fixture();
  f.options.supabase.rpc = async () => ({ data: null, error: { message: "test database outage" } });
  await assertRejects(() => f.run(), Error, "claim failed");
});

Deno.test("background worker with no due jobs makes no completion call", async () => {
  const f = fixture();
  const original = f.options.supabase.rpc;
  f.options.supabase.rpc = async (name, args) => name === "fn_claim_background_imports"
    ? { data: [], error: null }
    : await original(name, args);
  assertEquals(await f.run(), { processed: 0 });
  assertEquals(f.rpcCalls, []);
});

Deno.test("background worker reports a failed handoff instead of claiming success", async () => {
  const f = fixture();
  const original = f.options.supabase.rpc;
  f.options.supabase.rpc = async (name, args) => name === "fn_finish_background_import"
    ? { data: null, error: { message: "test persistence failure" } }
    : await original(name, args);
  await assertRejects(() => f.run(), Error, "completion failed");
});
