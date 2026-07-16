import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createSupabaseDeletionAdapter } from "./deletionSupabase.ts";

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
