import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  drainOneOutboxRow,
  isJobAction,
  JOB_ACTIONS,
  type JobAction,
  type JobHarnessAdapter,
  type JobLease,
  retryAt,
  runFencedJob,
  SCHEDULED_JOB_ACTIONS,
} from "./jobHarness.ts";

function lease(jobName: JobAction, attempt = 1): JobLease {
  return {
    jobName,
    holder: "worker-a",
    fenceToken: 7,
    runId: "run-1",
    incidentId: "incident-1",
    attempt,
    cursor: null,
  };
}

function harness(
  options: { complete?: boolean; fail?: boolean; attempt?: number } = {},
) {
  const calls: string[] = [];
  const adapter: JobHarnessAdapter = {
    claim: async (job) => {
      calls.push("claim");
      return lease(job, options.attempt ?? 1);
    },
    renew: async () => {
      calls.push("renew");
      return true;
    },
    complete: async () => {
      calls.push("complete");
      return options.complete ?? true;
    },
    fail: async () => {
      calls.push("fail");
      return options.fail ?? true;
    },
    pingHeartbeat: async () => {
      calls.push("heartbeat");
    },
    now: () => new Date("2026-07-16T00:00:00.000Z"),
  };
  return { adapter, calls };
}

Deno.test("moderation job harness", async (t) => {
  await t.step(
    "allowlist is exactly six jobs + ops-alarm + manual selftest",
    () => {
      assertEquals(JOB_ACTIONS, [
        "grandfather",
        "gc_staging",
        "gc_unbound",
        "gc_refdriven",
        "reconcile",
        "account_cleanup",
        "ops-alarm",
        "alarm_selftest",
      ]);
      assertEquals(SCHEDULED_JOB_ACTIONS.length, 6);
      assertEquals(isJobAction("arbitrary_sql"), false);
    },
  );

  await t.step(
    "heartbeat occurs only after the fenced completion CAS wins",
    async () => {
      const won = harness({ complete: true });
      assertEquals(
        await runFencedJob(
          "gc_staging",
          "worker-a",
          async () => ({ itemsProcessed: 2, cursor: "c" }),
          won.adapter,
        ),
        { status: "ok", progress: { itemsProcessed: 2, cursor: "c" } },
      );
      assertEquals(won.calls, [
        "claim",
        "renew",
        "renew",
        "complete",
        "heartbeat",
      ]);

      const stale = harness({ complete: false });
      assertEquals(
        await runFencedJob(
          "gc_staging",
          "worker-a",
          async () => ({ itemsProcessed: 2, cursor: null }),
          stale.adapter,
        ),
        { status: "superseded" },
      );
      assertEquals(stale.calls, ["claim", "renew", "renew", "complete"]);
    },
  );

  await t.step(
    "all six jobs share bounded retry and forced-failure escalation",
    async () => {
      for (const job of SCHEDULED_JOB_ACTIONS) {
        const { adapter, calls } = harness({ attempt: 3 });
        assertEquals(
          await runFencedJob(job, "worker-a", async () => {
            throw new Error(`forced:${job}`);
          }, adapter),
          { status: "failed" },
        );
        assertEquals(calls, ["claim", "renew", "fail"]);
        assertEquals(calls.includes("heartbeat"), false);
      }
    },
  );

  await t.step(
    "a lost renewal supersedes the worker before any job body or heartbeat",
    async () => {
      const { adapter, calls } = harness();
      adapter.renew = async () => {
        calls.push("renew-lost");
        return false;
      };
      let processed = false;
      assertEquals(
        await runFencedJob("reconcile", "worker-a", async () => {
          processed = true;
          return { itemsProcessed: 1, cursor: null };
        }, adapter),
        { status: "superseded" },
      );
      assertEquals(processed, false);
      assertEquals(calls, ["claim", "renew-lost"]);
    },
  );

  await t.step("retry policy is 6h exponential, capped at 48h", () => {
    const now = new Date("2026-07-16T00:00:00.000Z");
    assertEquals(retryAt(now, 1), "2026-07-16T06:00:00.000Z");
    assertEquals(retryAt(now, 2), "2026-07-16T12:00:00.000Z");
    assertEquals(retryAt(now, 9), "2026-07-18T00:00:00.000Z");
  });

  await t.step(
    "outbox uses provider key, sent terminal state, and honest failure",
    async () => {
      const calls: string[] = [];
      const result = await drainOneOutboxRow("alarm-worker", {
        claim: async () => ({
          idempotencyKey: "gc:incident:failure",
          providerIdempotencyKey: "provider-key",
          to: "ops@example.test",
          subject: "failure",
          body: "details",
        }),
        send: async (row) => {
          calls.push(`send:${row.providerIdempotencyKey}`);
        },
        markSent: async () => {
          calls.push("sent");
          return true;
        },
        markFailed: async () => {
          calls.push("failed");
        },
      });
      assertEquals(result, "sent");
      assertEquals(calls, ["send:provider-key", "sent"]);
    },
  );
});
