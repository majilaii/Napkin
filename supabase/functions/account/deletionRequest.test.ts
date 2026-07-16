import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { AccountDeletion, DeletionResult } from "./deletionSaga.ts";
import { requestAccountDeletion } from "./deletionRequest.ts";

const deletion: AccountDeletion = {
  user_id: "11111111-1111-4111-8111-111111111111",
  state: "freezing",
  quiesce_after: "2026-07-16T12:30:00.000Z",
  inventory: null,
};

Deno.test("account deletion request acceptance seam", async (t) => {
  await t.step(
    "returns the synchronous cleanup result when advance succeeds",
    async () => {
      const expected: DeletionResult = {
        deleted: false,
        pending: true,
        state: "draining",
      };

      const result = await requestAccountDeletion({
        freeze: async () => deletion,
        advance: async (frozen) => {
          assertStrictEquals(frozen, deletion);
          return expected;
        },
        reportDeferredError: () => {
          throw new Error("must not report a successful advance");
        },
      });

      assertStrictEquals(result, expected);
    },
  );

  await t.step(
    "acknowledges post-freeze failures as pending durable cleanup",
    async () => {
      const failure = new Error("storage temporarily unavailable");
      let reported: { error: unknown; deletion: AccountDeletion } | null = null;

      const result = await requestAccountDeletion({
        freeze: async () => deletion,
        advance: async () => {
          throw failure;
        },
        reportDeferredError: (error, frozen) => {
          reported = { error, deletion: frozen };
        },
      });

      assertEquals(result, {
        deleted: false,
        pending: true,
        state: "freezing",
      });
      assertStrictEquals(reported?.error, failure);
      assertStrictEquals(reported?.deletion, deletion);
    },
  );

  await t.step(
    "still rejects when the freeze linearization point fails",
    async () => {
      let advanced = false;
      let reported = false;

      await assertRejects(
        () =>
          requestAccountDeletion({
            freeze: async () => {
              throw new Error("freeze failed");
            },
            advance: async () => {
              advanced = true;
              return { deleted: false, pending: true, state: "freezing" };
            },
            reportDeferredError: () => {
              reported = true;
            },
          }),
        Error,
        "freeze failed",
      );

      assertEquals(advanced, false);
      assertEquals(reported, false);
    },
  );
});
