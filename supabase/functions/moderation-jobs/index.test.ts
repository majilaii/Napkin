import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createModerationJobsHandler } from "./index.ts";
import { JOB_ACTIONS } from "./jobHarness.ts";
import {
  createJobHarnessAdapter,
  createProcessor,
  drainOutbox,
  loadModerationJobsConfig,
  normalizeProjectQueuePath,
  preflightModerationJobs,
} from "./runtime.ts";

const ENV: Record<string, string> = {
  MODERATION_CRON_TOKEN: "dedicated-cron-token",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  GOOGLE_VISION_API_KEY: "dedicated-vision-key",
  OPS_ALERT_EMAIL: "ops@example.com",
  RESEND_API_KEY: "re_test",
  RESEND_FROM_EMAIL: "Napkin Ops <ops@example.com>",
};
for (const action of JOB_ACTIONS) {
  ENV[`MODERATION_HEARTBEAT_${action.replaceAll("-", "_").toUpperCase()}_URL`] =
    `https://heartbeat.example/${action}`;
}

function request(body: unknown, token = "dedicated-cron-token") {
  return new Request("http://localhost/moderation-jobs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-moderation-cron-token": token,
    },
    body: JSON.stringify(body),
  });
}

Deno.test("moderation-jobs rejects wrong token and every non-allowlisted action", async () => {
  const handler = createModerationJobsHandler({ env: (name) => ENV[name] });
  assertEquals(
    (await handler(request({ action: "ops-alarm" }, "wrong"))).status,
    401,
  );
  const response = await handler(request({ action: "ninth-job" }));
  assertEquals(response.status, 400);
  assertEquals((await response.json()).allowed, JOB_ACTIONS);
});

Deno.test("activation preflight contacts Resend and all eight independent heartbeat URLs", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  await preflightModerationJobs(
    loadModerationJobsConfig((name) => ENV[name]),
    async (input, init) => {
      calls.push({ url: String(input), method: String(init?.method ?? "GET") });
      return new Response(null, { status: 200 });
    },
    JOB_ACTIONS,
  );
  assertEquals(calls[0], {
    url: "https://api.resend.com/domains",
    method: "GET",
  });
  assertEquals(calls.slice(1).length, 8);
  assertEquals(calls.slice(1).every((call) => call.method === "HEAD"), true);
});

Deno.test("activation preflight never exposes a secret-bearing heartbeat URL", async () => {
  const secret = "heartbeat-secret-that-must-not-leak";
  const config = loadModerationJobsConfig((name) => ENV[name]);
  config.heartbeatUrl = (action) =>
    `https://heartbeat.example/${action}?key=${secret}`;
  const error = await assertRejects(
    () =>
      preflightModerationJobs(
        config,
        async (input) => {
          if (String(input) === "https://api.resend.com/domains") {
            return new Response(null, { status: 200 });
          }
          throw new TypeError(`network failure for ${String(input)}`);
        },
        JOB_ACTIONS,
      ),
    Error,
  );
  assertEquals(
    error.message,
    "MODERATION_HEARTBEAT_GRANDFATHER_URL request failed",
  );
  assertEquals(error.message.includes(secret), false);
  assertEquals(error.message.includes("?key="), false);
});

Deno.test("scheduled heartbeat never exposes a secret-bearing URL", async () => {
  const secret = "heartbeat-secret-that-must-not-leak";
  const config = loadModerationJobsConfig((name) => ENV[name]);
  config.heartbeatUrl = (action) =>
    `https://heartbeat.example/${action}?key=${secret}`;
  const harness = createJobHarnessAdapter(
    {},
    config,
    (input) => {
      throw new TypeError(`network failure for ${String(input)}`);
    },
  );
  const error = await assertRejects(
    () => harness.pingHeartbeat("gc_staging"),
    Error,
  );
  assertEquals(
    error.message,
    "MODERATION_HEARTBEAT_GC_STAGING_URL request failed",
  );
  assertEquals(error.message.includes(secret), false);
  assertEquals(error.message.includes("?key="), false);
});

Deno.test("ops-alarm uses the fenced harness and heartbeats only after terminal CAS", async () => {
  const events: string[] = [];
  const client = {
    rpc: async (name: string) => {
      events.push(name);
      if (name === "fn_claim_moderation_job") {
        return {
          data: {
            fence_token: 7,
            run_id: "10000000-0000-4000-8000-000000000001",
            incident_id: "10000000-0000-4000-8000-000000000002",
            attempt: 1,
            cursor: null,
          },
          error: null,
        };
      }
      if (name === "fn_claim_email_outbox") return { data: [], error: null };
      if (name === "fn_renew_moderation_job") {
        return { data: true, error: null };
      }
      if (name === "fn_complete_moderation_job") {
        return { data: true, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  };
  const handler = createModerationJobsHandler({
    env: (name) => ENV[name],
    createSupabase: () => client,
    uuid: () => "worker",
    fetchImpl: async (input) => {
      events.push(`heartbeat:${String(input)}`);
      return new Response(null, { status: 200 });
    },
  });
  const response = await handler(request({ action: "ops-alarm" }));
  assertEquals(response.status, 200);
  assertEquals(events.at(-2), "fn_complete_moderation_job");
  assertEquals(events.at(-1), "heartbeat:https://heartbeat.example/ops-alarm");
  assertEquals(
    events.filter((event) => event === "fn_renew_moderation_job").length,
    3,
  );
});

Deno.test("scheduled completion evaluates authoritative backlog before fenced completion", async () => {
  const events: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      events.push({ name, args });
      if (name === "fn_moderation_job_backlog") {
        return {
          data: {
            backlog_count: 3,
            oldest_pending_at: "2026-07-14T00:00:00.000Z",
          },
          error: null,
        };
      }
      if (name === "fn_evaluate_moderation_job_alarms") {
        return { data: { backlog_age_enqueued: true }, error: null };
      }
      if (name === "fn_complete_moderation_job") {
        return { data: true, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  };
  const harness = createJobHarnessAdapter(
    client,
    loadModerationJobsConfig((name) => ENV[name]),
    async () => new Response(null, { status: 200 }),
  );
  assertEquals(
    await harness.complete({
      jobName: "gc_staging",
      holder: "worker",
      fenceToken: 8,
      runId: "10000000-0000-4000-8000-000000000003",
      incidentId: "10000000-0000-4000-8000-000000000004",
      attempt: 1,
      cursor: null,
    }, { itemsProcessed: 2, cursor: "next" }),
    true,
  );
  assertEquals(events.map((event) => event.name), [
    "fn_moderation_job_backlog",
    "fn_evaluate_moderation_job_alarms",
    "fn_complete_moderation_job",
  ]);
  assertEquals(events[1].args, {
    p_job_name: "gc_staging",
    p_run_id: "10000000-0000-4000-8000-000000000003",
    p_items_processed: 2,
    p_backlog_count: 3,
    p_oldest_pending_at: "2026-07-14T00:00:00.000Z",
    p_to_addr: "ops@example.com",
  });
});

Deno.test("Resend outbox drain passes provider key then durably marks sent", async () => {
  const events: string[] = [];
  let claimed = false;
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      events.push(name);
      if (name === "fn_claim_email_outbox") {
        if (claimed) return { data: [], error: null };
        claimed = true;
        return {
          data: [{
            idempotency_key: "job:incident:kind",
            provider_idem_key: "provider-key",
            to_addr: "ops@example.com",
            subject: "Alarm",
            body: "Body",
          }],
          error: null,
        };
      }
      if (name === "fn_finish_email_outbox") {
        assertEquals(args.p_success, true);
        return { data: true, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  };
  const result = await drainOutbox(
    client,
    loadModerationJobsConfig((name) => ENV[name]),
    async (_input, init) => {
      assertEquals(
        new Headers(init?.headers).get("Idempotency-Key"),
        "provider-key",
      );
      events.push("resend");
      return new Response("{}", { status: 200 });
    },
    "worker",
  );
  assertEquals(result, { sent: 1, failed: 0 });
  assertEquals(events, [
    "fn_claim_email_outbox",
    "resend",
    "fn_finish_email_outbox",
    "fn_claim_email_outbox",
  ]);
});

Deno.test("outbox drain stops cleanly at 100 rows and leaves overflow for the next invocation", async () => {
  for (const initialCount of [100, 101]) {
    let remaining = initialCount;
    let claimed = 0;
    const client = {
      rpc: async (name: string) => {
        if (name === "fn_claim_email_outbox") {
          if (remaining === 0) return { data: [], error: null };
          remaining -= 1;
          claimed += 1;
          return {
            data: [{
              idempotency_key: `job:incident:${claimed}`,
              provider_idem_key: `provider-${claimed}`,
              to_addr: "ops@example.com",
              subject: "Alarm",
              body: "Body",
            }],
            error: null,
          };
        }
        if (name === "fn_finish_email_outbox") {
          return { data: true, error: null };
        }
        throw new Error(`unexpected RPC ${name}`);
      },
    };
    const config = loadModerationJobsConfig((name) => ENV[name]);
    const send = async () => new Response("{}", { status: 200 });

    assertEquals(await drainOutbox(client, config, send, "worker"), {
      sent: 100,
      failed: 0,
    });
    assertEquals(remaining, initialCount - 100);
    if (initialCount === 101) {
      assertEquals(await drainOutbox(client, config, send, "worker"), {
        sent: 1,
        failed: 0,
      });
      assertEquals(remaining, 0);
    }
  }
});

Deno.test("ref GC distinguishes already-settled queues from rejected terminal CAS writes", async () => {
  const config = loadModerationJobsConfig((name) => ENV[name]);
  const lease = {
    jobName: "gc_refdriven" as const,
    holder: "worker",
    fenceToken: 1,
    runId: "10000000-0000-4000-8000-000000000001",
    incidentId: "10000000-0000-4000-8000-000000000002",
    attempt: 1,
    cursor: null,
  };

  const settledCalls: string[] = [];
  const settledClient = {
    rpc: async (name: string) => {
      settledCalls.push(name);
      if (name === "fn_claim_gc_queue") {
        return {
          data: [{ id: "q-settled", bucket: "entry-photos" }],
          error: null,
        };
      }
      if (name === "fn_unlink_gc_ref") {
        return { data: { claimable: false, remaining_refs: 1 }, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  };
  assertEquals(
    await createProcessor(
      "gc_refdriven",
      settledClient,
      config,
      async () => new Response(),
    )(
      lease,
      async () => {},
    ),
    { itemsProcessed: 1, cursor: "q-settled" },
  );
  assertEquals(settledCalls, ["fn_claim_gc_queue", "fn_unlink_gc_ref"]);

  const fencedCalls: Array<{ name: string; success?: unknown }> = [];
  const fencedClient = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      fencedCalls.push({ name, success: args.p_success });
      if (name === "fn_claim_gc_queue") {
        return {
          data: [{ id: "q-fenced", bucket: "entry-photos" }],
          error: null,
        };
      }
      if (name === "fn_unlink_gc_ref") {
        return {
          data: {
            claimable: false,
            legacy_path:
              "https://project.supabase.co/storage/v1/object/public/entry-photos/user/legacy.jpg",
          },
          error: null,
        };
      }
      if (name === "fn_finish_gc_queue") {
        return { data: args.p_success === false, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
    storage: {
      from: () => ({ remove: async () => ({ error: null }) }),
    },
  };
  await assertRejects(
    () =>
      createProcessor(
        "gc_refdriven",
        fencedClient,
        config,
        async () => new Response(),
      )(
        lease,
        async () => {},
      ),
    Error,
    "ref-driven GC failed for 1 item(s)",
  );
  assertEquals(
    fencedCalls.filter((call) => call.name === "fn_finish_gc_queue"),
    [
      { name: "fn_finish_gc_queue", success: true },
      { name: "fn_finish_gc_queue", success: false },
    ],
  );
});

Deno.test("legacy Storage deletion is owner-bound and canonical-live fenced", async () => {
  const project = "https://project.supabase.co";
  const user = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  const publicPrefix = `${project}/storage/v1/object/public/avatars/`;

  assertEquals(
    normalizeProjectQueuePath(
      `${publicPrefix}${user}/safe%20avatar.jpg`,
      "avatars",
      project,
    ),
    `${user}/safe avatar.jpg`,
  );
  for (
    const unsafe of [
      `${publicPrefix}${user}%2Fencoded-slash.jpg`,
      `${publicPrefix}${user}/encoded%5Cbackslash.jpg`,
      `${publicPrefix}${user}/%2E%2E/traversal.jpg`,
      `https://attacker.example/storage/v1/object/public/avatars/${user}/foreign.jpg`,
    ]
  ) {
    assertEquals(
      normalizeProjectQueuePath(unsafe, "avatars", project),
      null,
    );
  }

  const lease = {
    jobName: "gc_refdriven" as const,
    holder: "worker",
    fenceToken: 1,
    runId: "10000000-0000-4000-8000-000000000011",
    incidentId: "10000000-0000-4000-8000-000000000012",
    attempt: 1,
    cursor: null,
  };
  const run = async (
    queueUser: string,
    legacyPath: string,
    liveAvatar: string | null = null,
  ) => {
    const removed: string[] = [];
    const client = {
      rpc: async (name: string) => {
        if (name === "fn_claim_gc_queue") {
          return {
            data: [{
              id: "queue",
              user_id: queueUser,
              bucket: "avatars",
              path: legacyPath,
            }],
            error: null,
          };
        }
        if (name === "fn_unlink_gc_ref") {
          return {
            data: { claimable: false, legacy_path: legacyPath },
            error: null,
          };
        }
        if (name === "fn_finish_gc_queue") {
          return { data: true, error: null };
        }
        throw new Error(`unexpected RPC ${name}`);
      },
      from: (table: string) => ({
        select: () => ({
          eq: async () => ({
            data: table === "profiles" && liveAvatar
              ? [{ avatar_url: liveAvatar }]
              : [],
            error: null,
          }),
        }),
      }),
      storage: {
        from: (bucket: string) => ({
          remove: async (paths: string[]) => {
            removed.push(`${bucket}:${paths[0]}`);
            return { error: null };
          },
        }),
      },
    };
    assertEquals(
      await createProcessor(
        "gc_refdriven",
        client,
        loadModerationJobsConfig((name) => ENV[name]),
        async () => new Response(),
      )(lease, async () => {}),
      { itemsProcessed: 1, cursor: "queue" },
    );
    return removed;
  };

  // Cross-owner, ambiguous, traversal, and foreign spellings are no-ops.
  for (
    const unsafe of [
      `${other}/victim.jpg`,
      `${publicPrefix}${user}%2Fencoded-slash.jpg`,
      `${publicPrefix}${user}/encoded%5Cbackslash.jpg`,
      `${publicPrefix}${user}/%2E%2E/traversal.jpg`,
      `https://attacker.example/storage/v1/object/public/avatars/${user}/foreign.jpg`,
    ]
  ) {
    assertEquals(await run(user, unsafe), []);
  }

  // A different but safe URL spelling of a live sink resolves to the same
  // physical key and must fence deletion.
  assertEquals(
    await run(
      user,
      `${user}/avatar.jpg`,
      `${publicPrefix}${user}/%61vatar.jpg`,
    ),
    [],
  );
  assertEquals(await run(user, `${user}/orphan.jpg`), [
    `avatars:${user}/orphan.jpg`,
  ]);
});

Deno.test("alarm_selftest is manual-only and requires explicit live confirmation", async () => {
  const handler = createModerationJobsHandler({
    env: (name) => ENV[name],
    createSupabase: () => ({}),
  });
  const response = await handler(request({ action: "alarm_selftest" }));
  assertEquals(response.status, 400);
});
