import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { encodeCursor } from "../_shared/pagination.ts";
import {
  EXHAUSTED_PAGE_LIMIT,
  listExhaustedCompletenessItems,
  parseExhaustedCursor,
} from "./_exhausted.ts";

const OWNER = "00000000-0000-4000-8000-000000000001";

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

Deno.test("exhausted items use owner-scoped stable keyset pagination", async () => {
  const rows = Array.from(
    { length: EXHAUSTED_PAGE_LIMIT + 1 },
    (_, index) => ({
      id: uuid(EXHAUSTED_PAGE_LIMIT + 1 - index),
      job_id: uuid(100 + index),
      item_nonce: uuid(200 + index),
      restaurant_id: null,
      resolution_id: index === 0 ? uuid(300) : null,
      external_id: index === 0 ? "ChIJ-test-place" : null,
      client_facts: { name: `Spot ${index}`, city: "London" },
      last_error: "ambiguous",
      created_at: "2026-07-16T12:00:00.000Z",
    }),
  );
  const equalities: Array<[string, unknown]> = [];
  const nullFilters: Array<[string, unknown]> = [];
  const orders: Array<[string, unknown]> = [];
  const orFilters: string[] = [];
  const queueSelections: string[] = [];
  const jobSelections: string[] = [];
  const jobInFilters: Array<[string, unknown]> = [];
  const jobEqualities: Array<[string, unknown]> = [];
  let observedLimit = 0;
  const supabase = {
    from: (table: string) => {
      if (table === "import_jobs") {
        const chain: Record<string, unknown> = {};
        chain.select = (columns: string) => {
          jobSelections.push(columns);
          return chain;
        };
        chain.in = (column: string, value: unknown) => {
          jobInFilters.push([column, value]);
          return chain;
        };
        chain.eq = (column: string, value: unknown) => {
          jobEqualities.push([column, value]);
          return Promise.resolve({
            data: rows.slice(0, EXHAUSTED_PAGE_LIMIT).map((row, index) => ({
              job_id: row.job_id,
              import_nonce: index === 0 ? null : uuid(400 + index),
            })),
            error: null,
          });
        };
        return chain;
      }
      if (table !== "restaurant_completeness_queue") {
        throw new Error(`unexpected table ${table}`);
      }
      const chain: Record<string, unknown> = {};
      chain.select = (columns: string) => {
        queueSelections.push(columns);
        return chain;
      };
      chain.eq = (column: string, value: unknown) => {
        equalities.push([column, value]);
        return chain;
      };
      chain.is = (column: string, value: unknown) => {
        nullFilters.push([column, value]);
        return chain;
      };
      chain.order = (column: string, options: unknown) => {
        orders.push([column, options]);
        return chain;
      };
      chain.or = (filter: string) => {
        orFilters.push(filter);
        return chain;
      };
      chain.limit = (limit: number) => {
        observedLimit = limit;
        return Promise.resolve({ data: rows.slice(0, limit), error: null });
      };
      return chain;
    },
  };

  const first = await listExhaustedCompletenessItems(supabase, OWNER);
  assertEquals(first.items.length, EXHAUSTED_PAGE_LIMIT);
  assertEquals(first.has_more, true);
  assertEquals(observedLimit, EXHAUSTED_PAGE_LIMIT + 1);
  assertEquals(queueSelections, [
    "id,job_id,item_nonce,restaurant_id,resolution_id,external_id,client_facts,last_error,created_at",
  ]);
  assertEquals(jobSelections, ["job_id,import_nonce"]);
  assertEquals(equalities, [["owner_id", OWNER], ["state", "exhausted"]]);
  assertEquals(jobEqualities, [["user_id", OWNER]]);
  assertEquals(jobInFilters, [[
    "job_id",
    rows.slice(0, EXHAUSTED_PAGE_LIMIT).map((row) => row.job_id),
  ]]);
  assertEquals(nullFilters, [["dismissed_at", null]]);
  assertEquals(orders, [
    ["created_at", { ascending: false }],
    ["id", { ascending: false }],
  ]);
  assertEquals(orFilters, []);
  assertEquals(first.items[0].import_nonce, null);
  assertEquals(first.items[0].resolution_id, uuid(300));
  assertEquals(first.items[0].external_id, "ChIJ-test-place");
  assertEquals(first.items[1].import_nonce, uuid(401));

  const cursor = parseExhaustedCursor(first.next_cursor);
  if (!cursor) throw new Error("expected a valid next cursor");
  assertEquals(cursor, {
    sort_date: rows[EXHAUSTED_PAGE_LIMIT - 1].created_at,
    id: rows[EXHAUSTED_PAGE_LIMIT - 1].id,
  });

  await listExhaustedCompletenessItems(supabase, OWNER, cursor);
  assertEquals(orFilters, [
    `created_at.lt.${cursor.sort_date},and(created_at.eq.${cursor.sort_date},id.lt.${cursor.id})`,
  ]);
});

Deno.test("exhausted cursor parser rejects non-keyset and filter-injection values", () => {
  assertEquals(parseExhaustedCursor(null), null);
  assertEquals(parseExhaustedCursor(42), undefined);
  assertEquals(
    parseExhaustedCursor(
      encodeCursor({
        sort_date: "2026-07-16T12:00:00.000Z,owner_id.eq.attacker",
        id: uuid(1),
      }),
    ),
    undefined,
  );
  assertEquals(
    parseExhaustedCursor(
      encodeCursor({
        sort_date: "2026-07-16T12:00:00.000Z",
        id: "not-a-uuid",
      }),
    ),
    undefined,
  );
});
