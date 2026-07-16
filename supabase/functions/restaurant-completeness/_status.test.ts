import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getCompletenessJobStatus } from "./_status.ts";

const OWNER = "00000000-0000-4000-8000-000000000001";
const JOB = "00000000-0000-4000-8000-000000000002";
const ITEM = "00000000-0000-4000-8000-000000000003";
const DESTINATION = "00000000-0000-4000-8000-000000000004";

Deno.test("job status scopes every service read and joins route ledger results", async () => {
  const observed = new Map<string, Array<[string, unknown]>>();
  const rows: Record<string, unknown[]> = {
    restaurant_completeness_queue: [{
      id: ITEM,
      item_nonce: ITEM,
      state: "resolved",
      restaurant_id: ITEM,
      last_error: null,
      created_at: "2026-07-16T12:00:00Z",
    }],
    completeness_destinations: [{
      item_nonce: ITEM,
      destination_nonce: DESTINATION,
      destination_kind: "wishlist",
      target_list_id: null,
      target_list_title: null,
      outcome: "fulfilled",
      created_at: "2026-07-16T12:00:00Z",
    }],
    destination_nonce_ledger: [{
      ledger_key: `route:${OWNER}:${JOB}:${ITEM}:${DESTINATION}`,
      result: {
        outcome: "fulfilled",
        wishlist_id: DESTINATION,
        restaurant_id: ITEM,
      },
    }],
  };
  const supabase = {
    from: (table: string) => {
      const filters: Array<[string, unknown]> = [];
      let selectedRange: [number, number] | null = null;
      observed.set(table, filters);
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (column: string, value: unknown) => {
        filters.push([column, value]);
        return chain;
      };
      chain.like = () => chain;
      chain.order = () => chain;
      chain.range = (from: number, to: number) => {
        selectedRange = [from, to];
        return chain;
      };
      chain.maybeSingle = async () => ({
        data: table === "import_jobs"
          ? {
            job_id: JOB,
            sealed_at: "2026-07-16T12:00:00Z",
            done_emitted_at: null,
          }
          : null,
        error: null,
      });
      chain.then = (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown,
      ) =>
        Promise.resolve({
          data: selectedRange
            ? (rows[table] ?? []).slice(selectedRange[0], selectedRange[1] + 1)
            : (rows[table] ?? []),
          error: null,
        }).then(
          resolve,
          reject,
        );
      return chain;
    },
  };

  const status = await getCompletenessJobStatus(supabase, OWNER, JOB);
  assertEquals(status?.sealed, true);
  assertEquals(status?.done_emitted, false);
  assertEquals(
    status?.items[0].destinations[0].result?.wishlist_id,
    DESTINATION,
  );
  assertEquals(observed.get("import_jobs"), [["job_id", JOB], [
    "user_id",
    OWNER,
  ]]);
  for (
    const table of [
      "restaurant_completeness_queue",
      "completeness_destinations",
      "destination_nonce_ledger",
    ]
  ) {
    assertEquals(observed.get(table), [["owner_id", OWNER], ["job_id", JOB]]);
  }
});

Deno.test("job status pages past 500 without dropping legal items or route results", async () => {
  const itemNonce = (index: number) =>
    `item-${index.toString().padStart(4, "0")}`;
  const destinationNonce = (index: number) =>
    `destination-${index.toString().padStart(4, "0")}`;
  const rows: Record<string, Record<string, unknown>[]> = {
    restaurant_completeness_queue: Array.from({ length: 501 }, (_, index) => ({
      id: `queue-${index.toString().padStart(4, "0")}`,
      item_nonce: itemNonce(index),
      state: "resolved",
      restaurant_id: `restaurant-${index}`,
      last_error: null,
      created_at: "2026-07-16T12:00:00Z",
    })),
    completeness_destinations: Array.from({ length: 501 }, (_, index) => ({
      id: `route-${index.toString().padStart(4, "0")}`,
      item_nonce: itemNonce(index),
      destination_nonce: destinationNonce(index),
      destination_kind: "wishlist",
      target_list_id: null,
      target_list_title: null,
      outcome: "fulfilled",
      created_at: "2026-07-16T12:00:00Z",
    })),
    destination_nonce_ledger: Array.from({ length: 501 }, (_, index) => ({
      ledger_key: `route:${OWNER}:${JOB}:${itemNonce(index)}:${
        destinationNonce(index)
      }`,
      result: { wishlist_id: `wishlist-${index}` },
    })),
  };
  const ranges = new Map<string, Array<[number, number]>>();
  const supabase = {
    from: (table: string) => {
      let selectedRange: [number, number] | null = null;
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.like = () => chain;
      chain.order = () => chain;
      chain.range = (from: number, to: number) => {
        selectedRange = [from, to];
        ranges.set(table, [...(ranges.get(table) ?? []), selectedRange]);
        return chain;
      };
      chain.maybeSingle = async () => ({
        data: table === "import_jobs"
          ? {
            job_id: JOB,
            sealed_at: "2026-07-16T12:00:00Z",
            done_emitted_at: null,
          }
          : null,
        error: null,
      });
      chain.then = (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown,
      ) => {
        const data = selectedRange
          ? (rows[table] ?? []).slice(selectedRange[0], selectedRange[1] + 1)
          : (rows[table] ?? []);
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      };
      return chain;
    },
  };

  const status = await getCompletenessJobStatus(supabase, OWNER, JOB);

  assertEquals(status?.items.length, 501);
  assertEquals(status?.items[500].item_nonce, itemNonce(500));
  assertEquals(
    status?.items[500].destinations[0].result?.wishlist_id,
    "wishlist-500",
  );
  for (
    const table of [
      "restaurant_completeness_queue",
      "completeness_destinations",
      "destination_nonce_ledger",
    ]
  ) {
    assertEquals(ranges.get(table), [[0, 499], [500, 999]]);
  }
});
