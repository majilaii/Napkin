import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type JobAction,
  type JobHarnessAdapter,
  type JobProcessor,
  runFencedJob,
} from "./jobHarness.ts";
import {
  type LegacySink,
  runGrandfather,
  runObjectGc,
  runReconcile,
  runRefDrivenGc,
  runStagingGc,
} from "./processors.ts";

const legacy = (sinkKind: LegacySink["sinkKind"], url: string): LegacySink => ({
  sinkKind,
  sinkId: `${sinkKind}-id`,
  userId: "11111111-1111-4111-8111-111111111111",
  url,
});

Deno.test("moderation job processors", async (t) => {
  await t.step(
    "grandfather PASS rebinds, rejected cleans/notifies once, foreign quarantines before any fetch",
    async () => {
      const calls: string[] = [];
      const rows = [
        legacy(
          "avatar",
          "https://project.test/storage/v1/object/public/avatars/user/a.jpg",
        ),
        legacy(
          "entry_photo",
          "https://project.test/storage/v1/object/public/entry-photos/user/b.jpg",
        ),
        legacy("entry_hero", "https://attacker.test/tracker.jpg"),
      ];
      const progress = await runGrandfather({
        enabled: async () => true,
        listLegacy: async () => ({ rows, nextCursor: "next" }),
        isOwnedLocalUrl: (item) => item.url.includes("project.test"),
        quarantineForeign: async (item) => {
          calls.push(`quarantine:${item.sinkKind}`);
        },
        moderateLegacy: async (item) => {
          calls.push(`moderate:${item.sinkKind}`);
          return item.sinkKind === "avatar"
            ? {
              verdict: "pass",
              promoted: {
                objectId: "o",
                approvedUrl: "approved",
                storagePath: "p",
                bucket: "avatars",
              },
            }
            : { verdict: "rejected" };
        },
        rebindPass: async (item) => {
          calls.push(`rebind:${item.sinkKind}`);
        },
        rejectAndNotifyOnce: async (item) => {
          calls.push(`reject:${item.sinkKind}`);
        },
      });
      assertEquals(progress, { itemsProcessed: 3, cursor: "next" });
      assertEquals(calls, [
        "moderate:avatar",
        "rebind:avatar",
        "moderate:entry_photo",
        "reject:entry_photo",
        "quarantine:entry_hero",
      ]);
    },
  );

  await t.step(
    "grandfather is inert until B-2 opens its config gate",
    async () => {
      let listed = false;
      assertEquals(
        await runGrandfather({
          enabled: async () => false,
          listLegacy: async () => {
            listed = true;
            return { rows: [], nextCursor: null };
          },
          isOwnedLocalUrl: () => false,
          quarantineForeign: async () => {},
          moderateLegacy: async () => ({ verdict: "rejected" }),
          rebindPass: async () => {},
          rejectAndNotifyOnce: async () => {},
        }),
        { itemsProcessed: 0, cursor: null },
      );
      assertEquals(listed, false);
    },
  );

  await t.step(
    "staging/object/ref GC external-call failures persist retries and reject the job",
    async () => {
      const staging: string[] = [];
      await assertRejects(
        () =>
          runStagingGc({
            claimBatch: async () => [{ reservationId: "r", path: "u/r" }],
            remove: async () => {
              throw new Error("storage down");
            },
            finish: async () => {
              staging.push("done");
            },
            fail: async () => {
              staging.push("retry");
            },
          }),
        Error,
        "staging GC failed for 1 item(s)",
      );
      assertEquals(staging, ["retry"]);

      const object: string[] = [];
      await assertRejects(
        () =>
          runObjectGc({
            claimBatch: async () => [{
              objectId: "o",
              bucket: "avatars",
              path: "p",
              worker: "w",
            }],
            remove: async () => {
              throw new Error("storage down");
            },
            finish: async () => {
              object.push("done");
            },
            fail: async () => {
              object.push("retry");
            },
          }),
        Error,
        "object GC failed for 1 item(s)",
      );
      assertEquals(object, ["retry"]);

      const ref: string[] = [];
      let refAttempt = 0;
      const refOps = {
        claimBatch: async () => [{ queueId: "q" }],
        unlink: async () => ({
          objectId: "o",
          bucket: "entry-photos",
          path: "p",
          worker: "w",
        }),
        removeObject: async () => {
          if (refAttempt++ === 0) throw new Error("storage down");
          ref.push("storage-removed");
        },
        finishObject: async () => {
          ref.push("object-done");
        },
        failObject: async () => {
          ref.push("object-retry");
        },
        finishQueue: async () => {
          ref.push("queue-done");
        },
        failQueue: async () => {
          ref.push("queue-retry");
        },
      };
      await assertRejects(
        () => runRefDrivenGc(refOps),
        Error,
        "ref-driven GC failed for 1 item(s)",
      );
      assertEquals(ref, ["object-retry"]);
      assertEquals((await runRefDrivenGc(refOps)).itemsProcessed, 1);
      assertEquals(ref, [
        "object-retry",
        "storage-removed",
        "object-done",
        "queue-done",
      ]);
    },
  );

  await t.step(
    "ref GC retries the queue when its object already reached terminal state",
    async () => {
      const calls: string[] = [];
      await assertRejects(
        () =>
          runRefDrivenGc({
            claimBatch: async () => [{ queueId: "q" }],
            unlink: async () => ({
              objectId: "o",
              bucket: "entry-photos",
              path: "p",
              worker: "w",
            }),
            removeObject: async () => {
              calls.push("storage-removed");
            },
            finishObject: async () => {
              calls.push("object-done");
            },
            failObject: async () => {
              calls.push("object-retry");
            },
            finishQueue: async () => {
              throw new Error("queue finish unavailable");
            },
            failQueue: async () => {
              calls.push("queue-retry");
            },
          }),
        Error,
        "ref-driven GC failed for 1 item(s)",
      );
      assertEquals(calls, ["storage-removed", "object-done", "queue-retry"]);
    },
  );

  await t.step(
    "all three GC processors reach one attempt-three outbox and never heartbeat",
    async () => {
      const cases: Array<{
        job: Extract<JobAction, "gc_staging" | "gc_unbound" | "gc_refdriven">;
        processor: (recordRowFailure: () => void) => JobProcessor;
      }> = [
        {
          job: "gc_staging",
          processor: (recordRowFailure) => async (_lease, checkpoint) =>
            await runStagingGc({
              checkpoint,
              claimBatch: async () => [{ reservationId: "r", path: "u/r" }],
              remove: async () => {
                throw new Error("storage down");
              },
              finish: async () => {},
              fail: async () => {
                recordRowFailure();
              },
            }),
        },
        {
          job: "gc_unbound",
          processor: (recordRowFailure) => async (_lease, checkpoint) =>
            await runObjectGc({
              checkpoint,
              claimBatch: async () => [{
                objectId: "o",
                bucket: "avatars",
                path: "p",
                worker: "w",
              }],
              remove: async () => {
                throw new Error("storage down");
              },
              finish: async () => {},
              fail: async () => {
                recordRowFailure();
              },
            }),
        },
        {
          job: "gc_refdriven",
          processor: (recordRowFailure) => async (_lease, checkpoint) =>
            await runRefDrivenGc({
              checkpoint,
              claimBatch: async () => [{ queueId: "q" }],
              unlink: async () => ({
                objectId: "o",
                bucket: "entry-photos",
                path: "p",
                worker: "w",
              }),
              removeObject: async () => {
                throw new Error("storage down");
              },
              finishObject: async () => {},
              failObject: async () => {
                recordRowFailure();
              },
              finishQueue: async () => {},
              failQueue: async () => {
                recordRowFailure();
              },
            }),
        },
      ];

      for (const testCase of cases) {
        let attempt = 0;
        let rowFailures = 0;
        let completions = 0;
        let heartbeats = 0;
        const outbox = new Set<string>();
        const adapter: JobHarnessAdapter = {
          claim: async (jobName, holder) => ({
            jobName,
            holder,
            fenceToken: attempt + 1,
            runId: `run-${attempt + 1}`,
            incidentId: "incident-1",
            attempt: ++attempt,
            cursor: null,
          }),
          renew: async () => true,
          complete: async () => {
            completions += 1;
            return true;
          },
          fail: async (lease) => {
            if (lease.attempt === 3) {
              outbox.add(
                `${lease.jobName}:${lease.incidentId}:retry_exhausted`,
              );
            }
            return true;
          },
          pingHeartbeat: async () => {
            heartbeats += 1;
          },
          now: () => new Date("2026-07-16T00:00:00.000Z"),
        };
        const processor = testCase.processor(() => {
          rowFailures += 1;
        });

        for (
          let expectedAttempt = 1;
          expectedAttempt <= 3;
          expectedAttempt += 1
        ) {
          assertEquals(
            await runFencedJob(testCase.job, "worker", processor, adapter),
            { status: "failed" },
          );
          assertEquals(attempt, expectedAttempt);
        }
        assertEquals(rowFailures, 3);
        assertEquals(outbox.size, 1);
        assertEquals(completions, 0);
        assertEquals(heartbeats, 0);
      }
    },
  );

  await t.step(
    "reconcile repairs every promotion/registry boundary and alarms staging ceiling",
    async () => {
      const repaired: string[] = [];
      let alarmed = false;
      const progress = await runReconcile({
        nextCursor: "registry:next",
        findings: async () => [
          { kind: "promoting_object_present", objectId: "a" },
          { kind: "promoting_object_missing", objectId: "b" },
          {
            kind: "orphan_storage",
            bucket: "avatars",
            path: "approved/u/c.jpg",
          },
          { kind: "expired_delete_lease", objectId: "d" },
          { kind: "registry_storage_missing", objectId: "e" },
        ],
        repair: async (finding) => {
          repaired.push(finding.kind);
        },
        stagingUsage: async () => ({ objects: 10_001, bytes: 1 }),
        enqueueCeilingAlarm: async () => {
          alarmed = true;
        },
      });
      assertEquals(progress.itemsProcessed, 5);
      assertEquals(progress.cursor, "registry:next");
      assertEquals(repaired.length, 5);
      assertEquals(alarmed, true);
    },
  );

  await t.step(
    "reconcile alarms when staging bytes alone exceed the 2 GiB ceiling",
    async () => {
      let alarmed = false;
      const progress = await runReconcile({
        nextCursor: null,
        findings: async () => [],
        repair: async () => {},
        stagingUsage: async () => ({
          objects: 1,
          bytes: 2 * 1024 * 1024 * 1024 + 1,
        }),
        enqueueCeilingAlarm: async () => {
          alarmed = true;
        },
      });

      assertEquals(progress.itemsProcessed, 0);
      assertEquals(alarmed, true);
    },
  );
});
