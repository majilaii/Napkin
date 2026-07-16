/**
 * Durable account-image deletion state machine (TICKET-196).
 *
 * The engine is deliberately storage/DB-client agnostic.  The account edge
 * function and the monitored account_cleanup worker provide the adapter; unit
 * tests can inject failures at every boundary without importing an Edge server.
 * No invocation sleeps through the writer-alive bound.  `quiesce_after` is a
 * durable database deadline established by fn_freeze_account_deletion.
 */

export const WRITER_STABLE_ZERO_POLL_MS = 1_000;

export type StorageScope = { bucket: string; prefix: string };

export type DeletionInventory = {
  storage: Array<{ bucket: string; path: string }>;
  user_image_object_ids: string[];
  image_object_ref_ids: string[];
  quarantine_ids: string[];
  reservation_ids: string[];
};

export type AccountDeletionState =
  | "freezing"
  | "draining"
  | "inventoried"
  | "purging"
  | "auth_deleted"
  | "done";

export type AccountDeletion = {
  user_id: string;
  state: AccountDeletionState;
  quiesce_after: string;
  inventory: DeletionInventory | null;
};

export type DeletionResult = {
  deleted: boolean;
  pending: boolean;
  state: AccountDeletionState;
};

export interface DeletionAdapter {
  now(): Date;
  delay(ms: number): Promise<void>;
  setState(
    state: AccountDeletionState,
    patch?: Record<string, unknown>,
  ): Promise<void>;
  cleanupKnownStagingPaths(): Promise<void>;
  /**
   * Reclaim any promotion/GC registry work which was alive at freeze, delete
   * its exact approved Storage path, and finish the fenced registry cleanup.
   * This runs only after the durable maximum-writer-alive deadline.
   */
  drainNonterminalObjects(): Promise<void>;
  listScope(scope: StorageScope): Promise<string[]>;
  recordStableZero?(
    scope: "writer" | "all_prefix",
    isEmpty: boolean,
  ): Promise<void>;
  releaseOwnedTables(): Promise<void>;
  buildInventory(scopes: StorageScope[]): Promise<DeletionInventory>;
  removeStorageObjects(objects: DeletionInventory["storage"]): Promise<void>;
  deleteAuthUser(): Promise<void>;
  cleanupPerUserRows(inventory: DeletionInventory): Promise<void>;
}

export function writerScopes(userId: string): StorageScope[] {
  return [{ bucket: "image-staging", prefix: userId }];
}

/**
 * Approved namespaces intentionally appear only in this post-inventory set.
 * Including them in the drain gate deadlocks every compliant account, because
 * an approved avatar is expected to exist until inventory/purge.
 */
export function allPerUserScopes(userId: string): StorageScope[] {
  return [
    ...writerScopes(userId),
    { bucket: "avatars", prefix: `approved/${userId}` },
    { bucket: "avatars", prefix: userId },
    { bucket: "entry-photos", prefix: `approved/${userId}` },
    { bucket: "entry-photos", prefix: userId },
  ];
}

export async function scopesAreStableZero(
  adapter: Pick<DeletionAdapter, "listScope" | "delay" | "recordStableZero">,
  scopes: StorageScope[],
  durableScope?: "writer" | "all_prefix",
): Promise<boolean> {
  const first = await Promise.all(
    scopes.map((scope) => adapter.listScope(scope)),
  );
  const firstEmpty = first.every((paths) => paths.length === 0);
  if (durableScope) await adapter.recordStableZero?.(durableScope, firstEmpty);
  if (!firstEmpty) return false;

  await adapter.delay(WRITER_STABLE_ZERO_POLL_MS);

  const second = await Promise.all(
    scopes.map((scope) => adapter.listScope(scope)),
  );
  const secondEmpty = second.every((paths) => paths.length === 0);
  if (durableScope) await adapter.recordStableZero?.(durableScope, secondEmpty);
  return secondEmpty;
}

/** Advance as far as is safe in this invocation. */
export async function advanceAccountDeletion(
  row: AccountDeletion,
  adapter: DeletionAdapter,
): Promise<DeletionResult> {
  let state = row.state;
  let inventory = row.inventory;
  let inventoriedThisInvocation = false;

  if (state === "done") return { deleted: true, pending: false, state };

  if (state === "freezing" || state === "draining") {
    // Freeze RPC already consumed every live writing generation.  Removing
    // its predetermined path is idempotent and happens before the deadline.
    await adapter.setState("draining");
    state = "draining";
    await adapter.cleanupKnownStagingPaths();

    if (adapter.now().getTime() < new Date(row.quiesce_after).getTime()) {
      return { deleted: false, pending: true, state };
    }

    if (
      !await scopesAreStableZero(adapter, writerScopes(row.user_id), "writer")
    ) {
      return { deleted: false, pending: true, state };
    }

    // A moderation handler may have crossed fn_begin_image_promotion just
    // before freeze and then paused during the approved Storage POST.  The
    // 730-second bound plus writer stable-zero guarantees that handler can
    // no longer be alive; reclaim its durable promoting/GC row and delete
    // its exact path before inventory can assert no writer work remains.
    await adapter.drainNonterminalObjects();

    // tables.owner_id is NO ACTION.  This stays after the freeze/drain and
    // before auth deletion, preserving the compliance-pack invariant.
    await adapter.releaseOwnedTables();

    inventory = await adapter.buildInventory(allPerUserScopes(row.user_id));
    await adapter.setState("inventoried", { inventory });
    state = "inventoried";
    inventoriedThisInvocation = true;
  }

  if (state === "inventoried" || state === "purging") {
    if (!inventory) throw new Error("account deletion inventory is missing");

    // A crash, partial Storage delete, or defense-in-depth late byte can
    // leave the persisted purge inventory stale. Every resumed purge first
    // re-inventories and persists the union, so stable-zero cannot become a
    // permanent deadlock on an object that was observed but never deleted.
    if (!inventoriedThisInvocation) {
      const residual = await adapter.buildInventory(
        allPerUserScopes(row.user_id),
      );
      const storage = new Map<string, { bucket: string; path: string }>();
      for (const object of [...inventory.storage, ...residual.storage]) {
        storage.set(`${object.bucket}:${object.path}`, object);
      }
      inventory = {
        storage: [...storage.values()],
        user_image_object_ids: [
          ...new Set([
            ...inventory.user_image_object_ids,
            ...residual.user_image_object_ids,
          ]),
        ],
        image_object_ref_ids: [
          ...new Set([
            ...inventory.image_object_ref_ids,
            ...residual.image_object_ref_ids,
          ]),
        ],
        quarantine_ids: [
          ...new Set([
            ...inventory.quarantine_ids,
            ...residual.quarantine_ids,
          ]),
        ],
        reservation_ids: [
          ...new Set([
            ...inventory.reservation_ids,
            ...residual.reservation_ids,
          ]),
        ],
      };
      await adapter.setState("inventoried", { inventory });
    }

    // Persist purging BEFORE the external Storage calls. A crash at any
    // remove boundary is therefore resumable by job six.
    await adapter.setState("purging");
    state = "purging";
    await adapter.removeStorageObjects(inventory.storage);

    // Round-5 ordering: approved/legacy prefixes are purged, then every
    // prefix (including staging) must be empty twice before auth deletion.
    if (
      !await scopesAreStableZero(
        adapter,
        allPerUserScopes(row.user_id),
        "all_prefix",
      )
    ) {
      return { deleted: false, pending: true, state };
    }

    // Repeat the ownership release on every purging attempt.  The first pass
    // handles the normal graph before inventory; this pass repairs a crash or
    // a pre-guard late Table and ensures its NO ACTION owner FK cannot strand
    // Auth deletion after Storage has reached stable zero.
    await adapter.releaseOwnedTables();
    await adapter.deleteAuthUser();
    await adapter.setState("auth_deleted");
    state = "auth_deleted";
  }

  if (state === "auth_deleted") {
    if (!inventory) throw new Error("account deletion inventory is missing");
    await adapter.cleanupPerUserRows(inventory);
    await adapter.setState("done");
    state = "done";
  }

  return { deleted: state === "done", pending: state !== "done", state };
}
