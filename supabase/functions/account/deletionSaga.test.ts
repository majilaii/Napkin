import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AccountDeletion,
  type AccountDeletionState,
  advanceAccountDeletion,
  allPerUserScopes,
  type DeletionAdapter,
  type DeletionInventory,
  scopesAreStableZero,
} from "./deletionSaga.ts";

const UID = "11111111-1111-4111-8111-111111111111";

function fixtureAdapter(options: {
  now?: string;
  lists?: string[][];
  failAt?: string;
} = {}) {
  const calls: string[] = [];
  const lists = [...(options.lists ?? [])];
  const inventory: DeletionInventory = {
    storage: [{ bucket: "avatars", path: `approved/${UID}/abc.jpg` }],
    user_image_object_ids: ["object-1"],
    image_object_ref_ids: ["ref-1"],
    quarantine_ids: ["quarantine-1"],
    reservation_ids: ["reservation-1"],
  };
  const boundary = async (name: string) => {
    calls.push(name);
    if (options.failAt === name) throw new Error(`injected:${name}`);
  };
  const adapter: DeletionAdapter = {
    now: () => new Date(options.now ?? "2026-07-16T12:30:00.000Z"),
    delay: async () => boundary("delay"),
    setState: async (state: AccountDeletionState) => boundary(`state:${state}`),
    cleanupKnownStagingPaths: async () => boundary("cleanup-staging"),
    drainNonterminalObjects: async () => boundary("drain-nonterminal"),
    listScope: async ({ bucket, prefix }) => {
      calls.push(`list:${bucket}:${prefix}`);
      return lists.shift() ?? [];
    },
    recordStableZero: async (scope, isEmpty) =>
      boundary(`zero:${scope}:${isEmpty}`),
    releaseOwnedTables: async () => boundary("release-tables"),
    buildInventory: async () => {
      await boundary("inventory");
      return inventory;
    },
    removeStorageObjects: async () => boundary("remove-storage"),
    deleteAuthUser: async () => boundary("delete-auth"),
    cleanupPerUserRows: async () => boundary("cleanup-rows"),
  };
  return { adapter, calls, inventory };
}

function row(overrides: Partial<AccountDeletion> = {}): AccountDeletion {
  return {
    user_id: UID,
    state: "freezing",
    quiesce_after: "2026-07-16T12:00:00.000Z",
    inventory: null,
    ...overrides,
  };
}

Deno.test("account deletion saga", async (t) => {
  await t.step(
    "pre-inventory stable-zero lists writer surfaces only",
    async () => {
      const { adapter, calls } = fixtureAdapter();
      await advanceAccountDeletion(row(), adapter);
      const inventoryIndex = calls.indexOf("inventory");
      const beforeInventory = calls.slice(0, inventoryIndex).filter((call) =>
        call.startsWith("list:")
      );
      assertEquals(beforeInventory, [
        `list:image-staging:${UID}`,
        `list:image-staging:${UID}`,
      ]);
    },
  );

  await t.step(
    "approved/legacy namespaces are inventoried, purged, then all-prefix stable-zero gates auth delete",
    async () => {
      const { adapter, calls } = fixtureAdapter();
      const result = await advanceAccountDeletion(row(), adapter);
      assertEquals(result, { deleted: true, pending: false, state: "done" });
      const remove = calls.indexOf("remove-storage");
      const auth = calls.indexOf("delete-auth");
      const finalRelease = calls.lastIndexOf("release-tables");
      assertEquals(remove < auth, true);
      assertEquals(remove < finalRelease, true);
      assertEquals(finalRelease < auth, true);
      const expectedScopes = allPerUserScopes(UID);
      const between = calls.slice(remove + 1, auth).filter((call) =>
        call.startsWith("list:")
      );
      assertEquals(between.length, expectedScopes.length * 2);
    },
  );

  await t.step(
    "durable quiesce deadline returns pending without sleeping",
    async () => {
      const { adapter, calls } = fixtureAdapter({
        now: "2026-07-16T11:59:59.000Z",
      });
      const result = await advanceAccountDeletion(row(), adapter);
      assertEquals(result, {
        deleted: false,
        pending: true,
        state: "draining",
      });
      assertEquals(calls.includes("delay"), false);
      assertEquals(calls.includes("inventory"), false);
    },
  );

  await t.step(
    "post-fence late write observed by the second list prevents finalization",
    async () => {
      // Writer drain: empty, then a resumed write appears. Inventory/auth must
      // not run; the next job invocation removes it and repeats stable-zero.
      const { adapter, calls } = fixtureAdapter({
        lists: [[], ["late-write.jpg"]],
      });
      const result = await advanceAccountDeletion(row(), adapter);
      assertEquals(result, {
        deleted: false,
        pending: true,
        state: "draining",
      });
      assertEquals(calls.includes("inventory"), false);
      assertEquals(calls.includes("delete-auth"), false);
    },
  );

  await t.step(
    "post-fence paused PUT is caught, removed, and only then permits Auth delete",
    async () => {
      // Exact round-5 interleaving model: generation 1 is consumed by the
      // byte-arrival claim, freeze bumps it again + deletes the known path,
      // then the already-claimed handler resumes its PUT. The first stable-
      // zero pass must hold deletion; the retry deletes the known path again
      // and only two empty lists may unlock Auth deletion.
      let generation = 1;
      let reservationState = "writing";
      const claimedGeneration = ++generation;
      reservationState = "putting";
      generation += 1;
      reservationState = "cleanup_required";

      const latePath = `${UID}/late-after-claim.jpg`;
      const storage = new Set<string>();
      const calls: string[] = [
        `claim:${claimedGeneration}`,
        `freeze:${generation}:${reservationState}`,
        "known-path-delete",
      ];
      let resumed = false;
      const inventory: DeletionInventory = {
        storage: [],
        user_image_object_ids: [],
        image_object_ref_ids: [],
        quarantine_ids: [],
        reservation_ids: ["reservation-1"],
      };
      const adapter: DeletionAdapter = {
        now: () => new Date("2026-07-16T12:30:00.000Z"),
        delay: async () => {
          calls.push("poll");
        },
        setState: async (state) => {
          calls.push(`state:${state}`);
        },
        cleanupKnownStagingPaths: async () => {
          storage.delete(latePath);
          calls.push("known-path-delete");
          if (!resumed) {
            resumed = true;
            storage.add(latePath);
            calls.push("paused-put-resumes");
          }
        },
        drainNonterminalObjects: async () => {
          calls.push("drain-nonterminal");
        },
        listScope: async () => {
          calls.push(`list:${storage.size}`);
          return [...storage];
        },
        recordStableZero: async () => {},
        releaseOwnedTables: async () => {
          calls.push("release-tables");
        },
        buildInventory: async () => inventory,
        removeStorageObjects: async () => {
          storage.clear();
        },
        deleteAuthUser: async () => {
          calls.push("delete-auth");
        },
        cleanupPerUserRows: async () => {},
      };

      const first = await advanceAccountDeletion(row(), adapter);
      assertEquals(first, { deleted: false, pending: true, state: "draining" });
      assertEquals(storage.has(latePath), true);
      assertEquals(calls.includes("delete-auth"), false);

      const second = await advanceAccountDeletion(
        row({ state: "draining" }),
        adapter,
      );
      assertEquals(second, { deleted: true, pending: false, state: "done" });
      assertEquals(storage.size, 0);
      assertEquals(calls.filter((call) => call === "delete-auth").length, 1);
      assertEquals(
        calls.indexOf("paused-put-resumes") < calls.indexOf("delete-auth"),
        true,
      );
    },
  );

  await t.step(
    "a resumed purge re-inventories residual late bytes before Auth delete",
    async () => {
      const { adapter, calls, inventory } = fixtureAdapter();
      const result = await advanceAccountDeletion(
        row({
          state: "purging",
          inventory,
        }),
        adapter,
      );
      assertEquals(result.deleted, true);
      assertEquals(
        calls.indexOf("inventory") < calls.indexOf("remove-storage"),
        true,
      );
      assertEquals(
        calls.indexOf("state:inventoried") < calls.indexOf("state:purging"),
        true,
      );
    },
  );

  await t.step(
    "a resumed purge repeats Table release and stops before Auth on failure",
    async () => {
      const { adapter, calls, inventory } = fixtureAdapter({
        failAt: "release-tables",
      });
      await assertRejects(
        () =>
          advanceAccountDeletion(
            row({ state: "purging", inventory }),
            adapter,
          ),
        Error,
        "injected:release-tables",
      );
      assertEquals(calls.includes("remove-storage"), true);
      assertEquals(calls.filter((call) => call === "release-tables").length, 1);
      assertEquals(calls.includes("delete-auth"), false);
    },
  );

  await t.step(
    "every persisted/external boundary fails before later destructive steps",
    async () => {
      for (
        const failAt of [
          "state:draining",
          "cleanup-staging",
          "drain-nonterminal",
          "release-tables",
          "inventory",
          "state:inventoried",
          "state:purging",
          "remove-storage",
          "delete-auth",
          "state:auth_deleted",
          "cleanup-rows",
          "state:done",
        ]
      ) {
        const { adapter, calls } = fixtureAdapter({ failAt });
        await assertRejects(
          () => advanceAccountDeletion(row(), adapter),
          Error,
          `injected:${failAt}`,
        );
        if (calls.includes(failAt)) {
          const failIndex = calls.indexOf(failAt);
          assertEquals(
            calls.slice(failIndex + 1).length,
            0,
            `${failAt} must stop the saga`,
          );
        }
      }
    },
  );

  await t.step(
    "global hash verdicts are not part of the per-user inventory",
    () => {
      const { inventory } = fixtureAdapter();
      assertEquals("image_hash_verdict_ids" in inventory, false);
      assertEquals(Object.keys(inventory).sort(), [
        "image_object_ref_ids",
        "quarantine_ids",
        "reservation_ids",
        "storage",
        "user_image_object_ids",
      ]);
    },
  );

  await t.step(
    "stable-zero helper always performs the second list after a poll",
    async () => {
      const calls: string[] = [];
      const ok = await scopesAreStableZero({
        listScope: async () => {
          calls.push("list");
          return [];
        },
        delay: async () => {
          calls.push("delay");
        },
      }, [{ bucket: "image-staging", prefix: UID }]);
      assertEquals(ok, true);
      assertEquals(calls, ["list", "delay", "list"]);
    },
  );
});
