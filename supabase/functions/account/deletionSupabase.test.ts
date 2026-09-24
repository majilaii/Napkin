import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createSupabaseDeletionAdapter,
  listAllStoragePaths,
} from "./deletionSupabase.ts";
import { allPerUserScopes } from "./deletionSaga.ts";

const UID = "11111111-1111-4111-8111-111111111111";

Deno.test("account staging cleanup drains known, orphan, and recursively nested prefix bytes", async () => {
  const removed: string[][] = [];
  const supabase = {
    from: (table: string) => {
      assertEquals(table, "staging_reservations");
      return {
        select: () => ({
          eq: async () => ({
            data: [
              { staging_path: `${UID}/staged.jpg` },
              { staging_path: `${UID}/known-but-unlisted.jpg` },
            ],
            error: null,
          }),
        }),
      };
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      assertEquals(name, "fn_list_account_storage_paths");
      assertEquals(args, {
        p_user_id: UID,
        p_bucket: "image-staging",
        p_prefix: UID,
        p_after_path: null,
        p_limit: 100,
      });
      return {
        data: {
          paths: [
            `${UID}/staged.jpg`,
            `${UID}/orphan-without-reservation.jpg`,
            `${UID}/nested/deep/orphan.jpg`,
          ],
          next_cursor: null,
        },
        error: null,
      };
    },
    storage: {
      from: (bucket: string) => {
        assertEquals(bucket, "image-staging");
        return {
          remove: async (paths: string[]) => {
            removed.push(paths);
            return { error: null };
          },
        };
      },
    },
  };

  await createSupabaseDeletionAdapter(supabase, UID).cleanupKnownStagingPaths();
  assertEquals(removed, [[
    `${UID}/staged.jpg`,
    `${UID}/known-but-unlisted.jpg`,
    `${UID}/orphan-without-reservation.jpg`,
    `${UID}/nested/deep/orphan.jpg`,
  ]]);
});

Deno.test("account deletion drains fenced nonterminal registry paths before inventory", async () => {
  const removed: Array<{ bucket: string; paths: string[] }> = [];
  const calls: string[] = [];
  const objectIds = [
    "22222222-2222-4222-8222-222222222221",
    "22222222-2222-4222-8222-222222222222",
  ];
  let claimCount = 0;
  const supabase = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push(name);
      if (name === "fn_claim_account_image_drain") {
        assertEquals(args, {
          p_user_id: UID,
          p_worker: `account-delete:${UID}`,
          p_batch: 100,
        });
        claimCount += 1;
        return {
          data: claimCount === 1
            ? [
              {
                object_id: objectIds[0],
                bucket: "avatars",
                storage_path: `approved/${UID}/a.jpg`,
              },
              {
                object_id: objectIds[1],
                bucket: "entry-photos",
                storage_path: `approved/${UID}/b.jpg`,
              },
            ]
            : [],
          error: null,
        };
      }
      assertEquals(name, "fn_finish_account_image_drain");
      assertEquals(args.p_user_id, UID);
      assertEquals(args.p_worker, `account-delete:${UID}`);
      assertEquals(objectIds.includes(String(args.p_object_id)), true);
      assertEquals(args.p_success, true);
      assertEquals(args.p_error, null);
      return { data: true, error: null };
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          removed.push({ bucket, paths });
          return { error: null };
        },
      }),
    },
  };

  await createSupabaseDeletionAdapter(supabase, UID).drainNonterminalObjects();
  assertEquals(calls, [
    "fn_claim_account_image_drain",
    "fn_finish_account_image_drain",
    "fn_finish_account_image_drain",
    "fn_claim_account_image_drain",
  ]);
  assertEquals(removed, [
    { bucket: "avatars", paths: [`approved/${UID}/a.jpg`] },
    { bucket: "entry-photos", paths: [`approved/${UID}/b.jpg`] },
  ]);
});

Deno.test("account inventory lists import screenshots through the allowlisted scope and removes them", async () => {
  const listed: Array<Record<string, unknown>> = [];
  const removed: Array<{ bucket: string; paths: string[] }> = [];
  const screenshots = [
    `${UID}/1727000000000-abc123.jpg`,
    `${UID}/1727000000001-def456.jpg`,
  ];
  const supabase = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      assertEquals(name, "fn_list_account_storage_paths");
      listed.push(args);
      return {
        data: {
          paths: args.p_bucket === "import-uploads" ? screenshots : [],
          next_cursor: null,
        },
        error: null,
      };
    },
    from: (_table: string) => ({
      select: () => ({
        eq: async () => ({ data: [], error: null }),
      }),
    }),
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          removed.push({ bucket, paths });
          return { error: null };
        },
      }),
    },
  };

  const adapter = createSupabaseDeletionAdapter(supabase, UID);
  const inventory = await adapter.buildInventory(allPerUserScopes(UID));

  // The catalog is asked for the user's own import-uploads prefix, exactly.
  assertEquals(
    listed.filter((args) => args.p_bucket === "import-uploads").map((args) => args.p_prefix),
    [UID],
  );
  assertEquals(
    inventory.storage.filter((object) => object.bucket === "import-uploads"),
    screenshots.map((path) => ({ bucket: "import-uploads", path })),
  );

  await adapter.removeStorageObjects(inventory.storage);
  assertEquals(removed, [{ bucket: "import-uploads", paths: screenshots }]);
});

Deno.test("account inventory rejects an import screenshot path outside the user's own prefix", async () => {
  const supabase = {
    rpc: async () => ({
      data: {
        paths: ["22222222-2222-4222-8222-222222222222/1727000000000-zzz999.jpg"],
        next_cursor: null,
      },
      error: null,
    }),
  };
  await assertRejects(
    () => listAllStoragePaths(supabase, UID, { bucket: "import-uploads", prefix: UID }),
    Error,
    "storage catalog returned an invalid import-uploads path",
  );
});
