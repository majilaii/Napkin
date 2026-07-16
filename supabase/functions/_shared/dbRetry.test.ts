import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { retryTransactionRpc } from "./dbRetry.ts";

Deno.test("transaction RPC retry recovers from deadlock and serialization victims", async () => {
  const codes = ["40P01", "40001", null] as const;
  const delays: number[] = [];
  let calls = 0;
  const result = await retryTransactionRpc(async () => {
    const code = codes[calls++];
    return code
      ? { data: null, error: { code } }
      : { data: { ok: true }, error: null };
  }, {
    delay: async (milliseconds) => {
      delays.push(milliseconds);
    },
  });

  assertEquals(result, { data: { ok: true }, error: null });
  assertEquals(calls, 3);
  assertEquals(delays, [15, 30]);
});

Deno.test("transaction RPC retry is bounded and never retries application failures", async () => {
  let deadlockCalls = 0;
  const deadlock = await retryTransactionRpc(async () => {
    deadlockCalls += 1;
    return { data: null, error: { code: "40P01" } };
  }, { maxAttempts: 3, delay: async () => {} });
  assertEquals(deadlock.error?.code, "40P01");
  assertEquals(deadlockCalls, 3);

  let authorityCalls = 0;
  const authority = await retryTransactionRpc(async () => {
    authorityCalls += 1;
    return { data: null, error: { code: "42501" } };
  }, { delay: async () => {} });
  assertEquals(authority.error?.code, "42501");
  assertEquals(authorityCalls, 1);
});
