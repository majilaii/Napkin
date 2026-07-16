import { assertEquals } from "../_shared/test-utils.ts";
import { projectListEntryForViewer } from "./entryVisibility.ts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const VIEWER = "22222222-2222-4222-8222-222222222222";

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: "entry-1",
    restaurant: {
      id: "restaurant-1",
      name: "Ghost Cafe",
      verification: "unverified",
      created_by: OWNER,
      merged_into: null,
      completeness_version: 7,
      ...overrides,
    },
  };
}

Deno.test("list get exposes repair metadata only to the ghost creator", () => {
  assertEquals(projectListEntryForViewer(entry(), OWNER), {
    id: "entry-1",
    restaurant: {
      id: "restaurant-1",
      name: "Ghost Cafe",
      verification: "unverified",
      created_by: OWNER,
      completeness_version: 7,
    },
  });
});

Deno.test("list get omits an incomplete row from non-creator viewers", () => {
  assertEquals(projectListEntryForViewer(entry(), VIEWER), null);
});

Deno.test("list get strips repair metadata from a verified non-creator row", () => {
  assertEquals(
    projectListEntryForViewer(entry({ verification: "verified" }), VIEWER),
    {
      id: "entry-1",
      restaurant: {
        id: "restaurant-1",
        name: "Ghost Cafe",
        verification: "verified",
      },
    },
  );
});
