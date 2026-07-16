import type { JobProgress } from "./jobHarness.ts";

type LeaseCheckpoint = { checkpoint?(): Promise<void> };

export type LegacySink = {
  sinkKind: "avatar" | "entry_photo" | "entry_hero";
  sinkId: string;
  userId: string;
  url: string;
};

export type PromotedLegacy = {
  objectId: string;
  approvedUrl: string;
  storagePath: string;
  bucket: "avatars" | "entry-photos";
};

export interface GrandfatherOps extends LeaseCheckpoint {
  enabled(): Promise<boolean>;
  listLegacy(
    cursor: string | null,
  ): Promise<{ rows: LegacySink[]; nextCursor: string | null }>;
  isOwnedLocalUrl(item: LegacySink): boolean;
  quarantineForeign(item: LegacySink): Promise<void>;
  moderateLegacy(
    item: LegacySink,
  ): Promise<
    { verdict: "pass"; promoted: PromotedLegacy } | { verdict: "rejected" }
  >;
  rebindPass(item: LegacySink, promoted: PromotedLegacy): Promise<void>;
  rejectAndNotifyOnce(item: LegacySink): Promise<void>;
}

export async function runGrandfather(
  ops: GrandfatherOps,
  cursor: string | null = null,
): Promise<JobProgress> {
  if (!await ops.enabled()) return { itemsProcessed: 0, cursor };
  const page = await ops.listLegacy(cursor);
  let processed = 0;
  for (const item of page.rows) {
    await ops.checkpoint?.();
    if (!ops.isOwnedLocalUrl(item)) {
      // Foreign/unscannable values are hidden atomically BEFORE manual
      // review and are never fetched (SSRF closure).
      await ops.quarantineForeign(item);
      processed += 1;
      continue;
    }
    const result = await ops.moderateLegacy(item);
    if (result.verdict === "pass") {
      await ops.rebindPass(item, result.promoted);
    } else {
      await ops.rejectAndNotifyOnce(item);
    }
    processed += 1;
  }
  return { itemsProcessed: processed, cursor: page.nextCursor };
}

export type StagingGcClaim = { reservationId: string; path: string };
export interface StagingGcOps extends LeaseCheckpoint {
  claimBatch(): Promise<StagingGcClaim[]>;
  remove(path: string): Promise<void>;
  finish(reservationId: string): Promise<void>;
  fail(reservationId: string, error: string): Promise<void>;
}

export async function runStagingGc(ops: StagingGcOps): Promise<JobProgress> {
  const rows = await ops.claimBatch();
  let processed = 0;
  const failures: string[] = [];
  for (const row of rows) {
    await ops.checkpoint?.();
    try {
      await ops.remove(row.path);
      await ops.finish(row.reservationId);
      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ops.fail(row.reservationId, message);
      failures.push(`${row.reservationId}: ${message}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `staging GC failed for ${failures.length} item(s): ${
        failures.slice(0, 3).join("; ")
      }`,
    );
  }
  return {
    itemsProcessed: processed,
    cursor: rows.at(-1)?.reservationId ?? null,
  };
}

export type ObjectGcClaim = {
  objectId: string;
  bucket: string;
  path: string;
  worker: string;
};
export interface ObjectGcOps extends LeaseCheckpoint {
  claimBatch(): Promise<ObjectGcClaim[]>;
  remove(row: ObjectGcClaim): Promise<void>;
  finish(row: ObjectGcClaim): Promise<void>;
  fail(row: ObjectGcClaim, error: string): Promise<void>;
}

export async function runObjectGc(ops: ObjectGcOps): Promise<JobProgress> {
  const rows = await ops.claimBatch();
  let processed = 0;
  const failures: string[] = [];
  for (const row of rows) {
    await ops.checkpoint?.();
    try {
      await ops.remove(row);
      await ops.finish(row);
      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ops.fail(row, message);
      failures.push(`${row.objectId}: ${message}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `object GC failed for ${failures.length} item(s): ${
        failures.slice(0, 3).join("; ")
      }`,
    );
  }
  return { itemsProcessed: processed, cursor: rows.at(-1)?.objectId ?? null };
}

export type RefGcClaim = { queueId: string };
export interface RefGcOps extends LeaseCheckpoint {
  claimBatch(): Promise<RefGcClaim[]>;
  unlink(row: RefGcClaim): Promise<ObjectGcClaim | null>;
  removeObject(row: ObjectGcClaim): Promise<void>;
  finishObject(row: ObjectGcClaim): Promise<void>;
  failObject(row: ObjectGcClaim, error: string): Promise<void>;
  finishQueue(row: RefGcClaim): Promise<void>;
  failQueue(row: RefGcClaim, error: string): Promise<void>;
}

export async function runRefDrivenGc(ops: RefGcOps): Promise<JobProgress> {
  const rows = await ops.claimBatch();
  let processed = 0;
  const failures: string[] = [];
  for (const row of rows) {
    await ops.checkpoint?.();
    let object: ObjectGcClaim | null = null;
    let objectFinished = false;
    try {
      object = await ops.unlink(row);
      if (object) {
        await ops.removeObject(object);
        await ops.finishObject(object);
        objectFinished = true;
      }
      await ops.finishQueue(row);
      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (object && !objectFinished) await ops.failObject(object, message);
      else await ops.failQueue(row, message);
      failures.push(`${row.queueId}: ${message}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(
      `ref-driven GC failed for ${failures.length} item(s): ${
        failures.slice(0, 3).join("; ")
      }`,
    );
  }
  return { itemsProcessed: processed, cursor: rows.at(-1)?.queueId ?? null };
}

export type ReconcileFinding =
  | { kind: "promoting_object_present"; objectId: string }
  | { kind: "promoting_object_missing"; objectId: string }
  | { kind: "orphan_storage"; bucket: string; path: string }
  | { kind: "expired_delete_lease"; objectId: string }
  | { kind: "registry_storage_missing"; objectId: string };

export interface ReconcileOps extends LeaseCheckpoint {
  findings(): Promise<ReconcileFinding[]>;
  nextCursor: string | null;
  repair(finding: ReconcileFinding): Promise<void>;
  stagingUsage(): Promise<{ objects: number; bytes: number }>;
  enqueueCeilingAlarm(usage: { objects: number; bytes: number }): Promise<void>;
}

export async function runReconcile(ops: ReconcileOps): Promise<JobProgress> {
  const findings = await ops.findings();
  for (const finding of findings) {
    await ops.checkpoint?.();
    await ops.repair(finding);
  }
  await ops.checkpoint?.();
  const usage = await ops.stagingUsage();
  if (usage.objects > 10_000 || usage.bytes > 2 * 1024 * 1024 * 1024) {
    await ops.enqueueCeilingAlarm(usage);
  }
  return { itemsProcessed: findings.length, cursor: ops.nextCursor };
}
