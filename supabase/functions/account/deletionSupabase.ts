import {
  type AccountDeletion,
  type AccountDeletionState,
  type DeletionAdapter,
  type DeletionInventory,
  type StorageScope,
} from "./deletionSaga.ts";

type SupabaseLike = any;

function throwIfError(
  error: { message?: string } | null | undefined,
  context: string,
): void {
  if (error) throw new Error(`${context}: ${error.message ?? "unknown error"}`);
}

function requireRpcTrue(data: unknown, context: string): void {
  if (data !== true) {
    throw new Error(`${context}: fenced transition was not accepted`);
  }
}

export async function listAllStoragePaths(
  supabase: SupabaseLike,
  userId: string,
  scope: StorageScope,
): Promise<string[]> {
  const paths: string[] = [];
  let afterPath: string | null = null;
  for (;;) {
    const { data, error } = await supabase.rpc(
      "fn_list_account_storage_paths",
      {
        p_user_id: userId,
        p_bucket: scope.bucket,
        p_prefix: scope.prefix,
        p_after_path: afterPath,
        p_limit: 100,
      },
    );
    throwIfError(error, `storage catalog list ${scope.bucket}/${scope.prefix}`);
    const value = (data && typeof data === "object" && !Array.isArray(data))
      ? data as { paths?: unknown; next_cursor?: unknown }
      : {};
    if (!Array.isArray(value.paths)) {
      throw new Error("storage catalog returned an invalid page");
    }
    const page = value.paths.map((path) => {
      if (
        typeof path !== "string" || (
          path !== scope.prefix && !path.startsWith(`${scope.prefix}/`)
        )
      ) {
        throw new Error(
          `storage catalog returned an invalid ${scope.bucket} path`,
        );
      }
      return path;
    });
    paths.push(...page);
    if (value.next_cursor === null || value.next_cursor === undefined) {
      return paths;
    }
    if (
      typeof value.next_cursor !== "string" ||
      value.next_cursor.length === 0 ||
      value.next_cursor === afterPath ||
      value.next_cursor !== page.at(-1)
    ) {
      throw new Error("storage catalog paging did not advance");
    }
    afterPath = value.next_cursor;
  }
}

async function removeInChunks(
  supabase: SupabaseLike,
  bucket: string,
  paths: string[],
): Promise<void> {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await supabase.storage.from(bucket).remove(
      paths.slice(i, i + 100),
    );
    throwIfError(error, `storage remove ${bucket}`);
  }
}

export async function releaseOwnedTables(
  supabase: SupabaseLike,
  userId: string,
): Promise<void> {
  const { data: owned, error } = await supabase
    .from("tables")
    .select("id")
    .eq("owner_id", userId);
  throwIfError(error, "owned tables lookup");

  for (const table of owned ?? []) {
    const { data: members, error: memberError } = await supabase
      .from("table_members")
      .select("member_id, joined_at")
      .eq("table_id", table.id)
      .neq("member_id", userId)
      .order("joined_at", { ascending: true })
      .limit(1);
    throwIfError(memberError, "table heir lookup");

    const heir = members?.[0]?.member_id ?? null;
    if (heir) {
      const { error: updateError } = await supabase
        .from("tables")
        .update({ owner_id: heir })
        .eq("id", table.id);
      throwIfError(updateError, "table ownership transfer");
    } else {
      const { error: deleteError } = await supabase.from("tables").delete().eq(
        "id",
        table.id,
      );
      throwIfError(deleteError, "sole-member table delete");
    }
  }
}

export async function freezeAccountDeletion(
  supabase: SupabaseLike,
  userId: string,
): Promise<AccountDeletion> {
  const { data, error } = await supabase.rpc("fn_freeze_account_deletion", {
    p_user_id: userId,
  });
  throwIfError(error, "freeze account deletion");
  const value = Array.isArray(data) ? data[0] : data;
  if (!value?.user_id || !value?.state || !value?.quiesce_after) {
    throw new Error("freeze account deletion returned an invalid row");
  }
  return value as AccountDeletion;
}

export async function loadAccountDeletion(
  supabase: SupabaseLike,
  userId: string,
): Promise<AccountDeletion | null> {
  const { data, error } = await supabase
    .from("account_deletions")
    .select("user_id, state, quiesce_after, inventory")
    .eq("user_id", userId)
    .maybeSingle();
  throwIfError(error, "load account deletion");
  return (data as AccountDeletion | null) ?? null;
}

export function createSupabaseDeletionAdapter(
  supabase: SupabaseLike,
  userId: string,
): DeletionAdapter {
  return {
    now: () => new Date(),
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    setState: async (state: AccountDeletionState, patch = {}) => {
      if (state === "inventoried") {
        const { error } = await supabase.rpc(
          "fn_finalize_account_image_inventory",
          {
            p_user_id: userId,
            p_storage_inventory: patch.inventory ?? {},
          },
        );
        throwIfError(error, "finalize account image inventory");
        return;
      }
      if (state === "purging") {
        const { data, error } = await supabase.rpc(
          "fn_mark_account_images_purging",
          {
            p_user_id: userId,
          },
        );
        throwIfError(error, "mark account images purging");
        requireRpcTrue(data, "mark account images purging");
        return;
      }
      if (state === "auth_deleted") {
        const { data, error } = await supabase.rpc(
          "fn_mark_account_auth_deleted",
          {
            p_user_id: userId,
          },
        );
        throwIfError(error, "mark account auth deleted");
        requireRpcTrue(data, "mark account auth deleted");
        return;
      }
      if (state === "done") {
        const { data, error } = await supabase.rpc(
          "fn_finish_account_image_cleanup",
          {
            p_user_id: userId,
          },
        );
        throwIfError(error, "finish account image cleanup");
        requireRpcTrue(data, "finish account image cleanup");
        return;
      }
      const { error } = await supabase
        .from("account_deletions")
        .update({ state, updated_at: new Date().toISOString(), ...patch })
        .eq("user_id", userId);
      throwIfError(error, `set account deletion state ${state}`);
    },
    cleanupKnownStagingPaths: async () => {
      const { data, error } = await supabase
        .from("staging_reservations")
        .select("staging_path")
        .eq("user_id", userId);
      throwIfError(error, "load account staging paths");
      const knownPaths = (data ?? [])
        .map((row: { staging_path?: string }) => row.staging_path)
        .filter((path: unknown): path is string =>
          typeof path === "string" && path.length > 0
        );
      // The Storage prefix is authoritative and also catches crash-created
      // orphan bytes with no reservation. Unioning the DB paths handles a
      // catalog/list lag without narrowing cleanup to particular states.
      const listedPaths = await listAllStoragePaths(supabase, userId, {
        bucket: "image-staging",
        prefix: userId,
      });
      await removeInChunks(
        supabase,
        "image-staging",
        [...new Set([...knownPaths, ...listedPaths])],
      );
    },
    drainNonterminalObjects: async () => {
      const worker = `account-delete:${userId}`;
      for (;;) {
        const { data, error } = await supabase.rpc(
          "fn_claim_account_image_drain",
          {
            p_user_id: userId,
            p_worker: worker,
            p_batch: 100,
          },
        );
        throwIfError(error, "claim account image drain");
        const rows = (Array.isArray(data) ? data : []) as Array<{
          object_id?: unknown;
          bucket?: unknown;
          storage_path?: unknown;
        }>;
        if (rows.length === 0) return;
        for (const row of rows) {
          if (
            typeof row.object_id !== "string" ||
            (row.bucket !== "avatars" && row.bucket !== "entry-photos") ||
            typeof row.storage_path !== "string"
          ) {
            throw new Error(
              "claim account image drain returned an invalid object",
            );
          }
          try {
            await removeInChunks(supabase, row.bucket, [row.storage_path]);
          } catch (removeError) {
            await supabase.rpc("fn_finish_account_image_drain", {
              p_user_id: userId,
              p_object_id: row.object_id,
              p_worker: worker,
              p_success: false,
              p_error: removeError instanceof Error
                ? removeError.message
                : String(removeError),
            });
            throw removeError;
          }
          const { data: finished, error: finishError } = await supabase.rpc(
            "fn_finish_account_image_drain",
            {
              p_user_id: userId,
              p_object_id: row.object_id,
              p_worker: worker,
              p_success: true,
              p_error: null,
            },
          );
          throwIfError(finishError, "finish account image drain");
          requireRpcTrue(finished, "finish account image drain");
        }
      }
    },
    listScope: (scope) => listAllStoragePaths(supabase, userId, scope),
    recordStableZero: async (scope, isEmpty) => {
      const { error } = await supabase.rpc("fn_record_account_deletion_zero", {
        p_user_id: userId,
        p_scope: scope,
        p_is_empty: isEmpty,
        p_poll_interval_seconds: 1,
      });
      throwIfError(error, `record ${scope} stable-zero`);
    },
    releaseOwnedTables: () => releaseOwnedTables(supabase, userId),
    buildInventory: async (scopes) => {
      const listed = await Promise.all(scopes.map(async (scope) => ({
        scope,
        paths: await listAllStoragePaths(supabase, userId, scope),
      })));

      const { data: objects, error: objectError } = await supabase
        .from("user_image_objects")
        .select("id")
        .eq("user_id", userId);
      throwIfError(objectError, "inventory image objects");
      const objectIds = (objects ?? []).map((row: { id: string }) => row.id);

      let refIds: string[] = [];
      if (objectIds.length > 0) {
        const { data: refs, error: refError } = await supabase
          .from("image_object_refs")
          .select("id")
          .in("object_id", objectIds);
        throwIfError(refError, "inventory image refs");
        refIds = (refs ?? []).map((row: { id: string }) => row.id);
      }

      const [quarantineResult, reservationResult] = await Promise.all([
        supabase.from("image_quarantine").select("id").eq("user_id", userId),
        supabase.from("staging_reservations").select("id").eq(
          "user_id",
          userId,
        ),
      ]);
      throwIfError(quarantineResult.error, "inventory quarantine");
      throwIfError(reservationResult.error, "inventory staging reservations");

      return {
        storage: listed.flatMap(({ scope, paths }) =>
          paths.map((path) => ({
            bucket: scope.bucket,
            path,
          }))
        ),
        user_image_object_ids: objectIds,
        image_object_ref_ids: refIds,
        quarantine_ids: (quarantineResult.data ?? []).map((
          row: { id: string },
        ) => row.id),
        reservation_ids: (reservationResult.data ?? []).map(
          (row: { id: string }) => row.id,
        ),
      } satisfies DeletionInventory;
    },
    removeStorageObjects: async (objects) => {
      const byBucket = new Map<string, string[]>();
      for (const object of objects) {
        const paths = byBucket.get(object.bucket) ?? [];
        paths.push(object.path);
        byBucket.set(object.bucket, paths);
      }
      for (const [bucket, paths] of byBucket) {
        await removeInChunks(supabase, bucket, paths);
      }
    },
    deleteAuthUser: async () => {
      const { error } = await supabase.auth.admin.deleteUser(userId);
      const status = Number((error as { status?: unknown } | null)?.status);
      const message = String(
        (error as { message?: unknown } | null)?.message ?? "",
      );
      // A crash after Auth accepted the delete but before the durable
      // auth_deleted transition must resume idempotently.
      if (error && status !== 404 && !/user.*not found/i.test(message)) {
        throwIfError(error, "auth delete");
      }
    },
    cleanupPerUserRows: async (inventory) => {
      // Explicit cleanup is idempotent and survives whichever auth FKs do
      // or do not cascade. Global image_hash_verdicts are intentionally
      // absent: hashes are shared moderation evidence across users.
      if (inventory.image_object_ref_ids.length > 0) {
        const { error } = await supabase
          .from("image_object_refs")
          .delete()
          .in("id", inventory.image_object_ref_ids);
        throwIfError(error, "delete image refs");
      }
      for (
        const table of [
          "image_quarantine",
          "image_moderation_notifications",
          "image_moderation_ledger",
          "user_image_objects",
          "staging_reservations",
          "image_stage_budget",
        ]
      ) {
        const { error } = await supabase.from(table).delete().eq(
          "user_id",
          userId,
        );
        throwIfError(error, `delete ${table} rows`);
      }
      for (const table of ["image_compute_budget", "image_scan_budget"]) {
        const { error } = await supabase
          .from(table)
          .delete()
          .eq("scope", "user")
          .eq("subject_id", userId);
        throwIfError(error, `delete ${table} rows`);
      }
    },
  };
}
