import { moderateOwnedStorageObject } from "../moderate-image/index.ts";
import {
  type AccountDeletion,
  advanceAccountDeletion,
} from "../account/deletionSaga.ts";
import { createSupabaseDeletionAdapter } from "../account/deletionSupabase.ts";
import {
  drainOneOutboxRow,
  type JobAction,
  type JobHarnessAdapter,
  type JobLease,
  type JobProcessor,
  type OutboxAdapter,
  SCHEDULED_JOB_ACTIONS,
} from "./jobHarness.ts";
import {
  type LegacySink,
  type ObjectGcClaim,
  type ReconcileFinding,
  runGrandfather,
  runObjectGc,
  runReconcile,
  runRefDrivenGc,
  runStagingGc,
} from "./processors.ts";

type SupabaseLike = any;
type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface ModerationJobsConfig {
  supabaseUrl: string;
  serviceKey: string;
  visionKey: string;
  opsAlertEmail: string;
  resendApiKey: string;
  resendFromEmail: string;
  heartbeatUrl: (job: JobAction) => string;
}

function dataRows(value: unknown): Array<Record<string, any>> {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, any> =>
      !!row && typeof row === "object"
    )
    : [];
}

function dataObject(value: unknown): Record<string, any> {
  const unwrapped = Array.isArray(value) && value.length === 1
    ? value[0]
    : value;
  return unwrapped && typeof unwrapped === "object"
    ? unwrapped as Record<string, any>
    : {};
}

async function rpc(
  client: SupabaseLike,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await client.rpc(name, args);
  if (error) {
    throw new Error(
      `${name}: ${
        typeof error.message === "string" ? error.message : "RPC failed"
      }`,
    );
  }
  return data;
}

function requireTrue(value: unknown, context: string): void {
  if (value !== true) {
    throw new Error(`${context}: fenced write was not accepted`);
  }
}

function numericFence(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("job lease omitted a valid fence token");
  }
  return parsed;
}

function heartbeatEnvName(job: JobAction): string {
  return `MODERATION_HEARTBEAT_${job.replaceAll("-", "_").toUpperCase()}_URL`;
}

export function loadModerationJobsConfig(
  env: (name: string) => string | undefined,
): ModerationJobsConfig {
  return {
    supabaseUrl: env("SUPABASE_URL") ?? "",
    serviceKey: env("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    visionKey: env("GOOGLE_VISION_API_KEY") ?? "",
    opsAlertEmail: env("OPS_ALERT_EMAIL") ?? "",
    resendApiKey: env("RESEND_API_KEY") ?? "",
    resendFromEmail: env("RESEND_FROM_EMAIL") ?? "",
    heartbeatUrl: (job) => env(heartbeatEnvName(job)) ?? "",
  };
}

function requireHttpsUrl(raw: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} is not a URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(`${label} must be a credential-free HTTPS URL`);
  }
  return url;
}

function timeoutSignal(
  milliseconds: number,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  return { signal: controller.signal, dispose: () => clearTimeout(timer) };
}

async function fetchHeartbeat(
  fetchImpl: FetchLike,
  url: URL,
  init: RequestInit,
  label: string,
): Promise<Response> {
  try {
    return await fetchImpl(url, init);
  } catch {
    // Deno's fetch errors can include the full URL. Heartbeat URLs commonly
    // carry their authentication token in the path or query string.
    throw new Error(`${label} request failed`);
  }
}

/** One-time activation preflight. Never run this on the recurring schedule. */
export async function preflightModerationJobs(
  config: ModerationJobsConfig,
  fetchImpl: FetchLike,
  actions: readonly JobAction[],
): Promise<void> {
  if (!config.resendApiKey) throw new Error("RESEND_API_KEY is missing");
  if (!config.resendFromEmail) throw new Error("RESEND_FROM_EMAIL is missing");
  if (!config.opsAlertEmail || !config.opsAlertEmail.includes("@")) {
    throw new Error("OPS_ALERT_EMAIL is missing or invalid");
  }

  const resendDeadline = timeoutSignal(8_000);
  try {
    const response = await fetchImpl("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${config.resendApiKey}` },
      signal: resendDeadline.signal,
    });
    await response.body?.cancel().catch(() => {});
    if (!response.ok) {
      throw new Error(
        `Resend credential preflight returned HTTP ${response.status}`,
      );
    }
  } finally {
    resendDeadline.dispose();
  }

  for (const action of actions) {
    const url = requireHttpsUrl(
      config.heartbeatUrl(action),
      heartbeatEnvName(action),
    );
    const deadline = timeoutSignal(8_000);
    try {
      const label = heartbeatEnvName(action);
      let response = await fetchHeartbeat(
        fetchImpl,
        url,
        { method: "HEAD", signal: deadline.signal },
        label,
      );
      if (response.status === 405) {
        await response.body?.cancel().catch(() => {});
        response = await fetchHeartbeat(
          fetchImpl,
          url,
          { method: "GET", signal: deadline.signal },
          label,
        );
      }
      await response.body?.cancel().catch(() => {});
      if (!response.ok) {
        throw new Error(`${label} returned HTTP ${response.status}`);
      }
    } finally {
      deadline.dispose();
    }
  }
}

export function createJobHarnessAdapter(
  client: SupabaseLike,
  config: ModerationJobsConfig,
  fetchImpl: FetchLike,
): JobHarnessAdapter {
  return {
    now: () => new Date(),
    claim: async (jobName, holder) => {
      if (!config.opsAlertEmail || !config.opsAlertEmail.includes("@")) {
        throw new Error("OPS_ALERT_EMAIL is missing or invalid");
      }
      const value = dataObject(
        await rpc(client, "fn_claim_moderation_job", {
          p_job_name: jobName,
          p_holder: holder,
          p_lease_seconds: 600,
          p_to_addr: config.opsAlertEmail,
        }),
      );
      if (!value.run_id) return null;
      return {
        jobName,
        holder,
        fenceToken: numericFence(value.fence_token),
        runId: String(value.run_id),
        incidentId: String(value.incident_id),
        attempt: Number(value.attempt),
        cursor: typeof value.cursor === "string" && value.cursor.length > 0
          ? value.cursor
          : null,
      };
    },
    renew: async (lease) => {
      const value = await rpc(client, "fn_renew_moderation_job", {
        p_job_name: lease.jobName,
        p_holder: lease.holder,
        p_fence_token: lease.fenceToken,
        p_run_id: lease.runId,
        p_lease_seconds: 600,
      });
      return value === true;
    },
    complete: async (lease, progress) => {
      if (
        (SCHEDULED_JOB_ACTIONS as readonly JobAction[]).includes(lease.jobName)
      ) {
        if (!config.opsAlertEmail || !config.opsAlertEmail.includes("@")) {
          throw new Error("OPS_ALERT_EMAIL is missing or invalid");
        }
        const backlog = dataObject(
          await rpc(
            client,
            "fn_moderation_job_backlog",
            { p_job_name: lease.jobName },
          ),
        );
        await rpc(client, "fn_evaluate_moderation_job_alarms", {
          p_job_name: lease.jobName,
          p_run_id: lease.runId,
          p_items_processed: progress.itemsProcessed,
          p_backlog_count: backlog.backlog_count ?? 0,
          p_oldest_pending_at: backlog.oldest_pending_at ?? null,
          p_to_addr: config.opsAlertEmail,
        });
      }
      const value = await rpc(client, "fn_complete_moderation_job", {
        p_job_name: lease.jobName,
        p_holder: lease.holder,
        p_fence_token: lease.fenceToken,
        p_run_id: lease.runId,
        p_items_processed: progress.itemsProcessed,
        p_cursor: progress.cursor,
      });
      return value === true;
    },
    fail: async (lease, error, nextAttemptAt) => {
      const value = await rpc(client, "fn_fail_moderation_job", {
        p_job_name: lease.jobName,
        p_holder: lease.holder,
        p_fence_token: lease.fenceToken,
        p_run_id: lease.runId,
        p_error: error,
        p_next_attempt_at: nextAttemptAt,
        p_to_addr: config.opsAlertEmail,
      });
      return value === true;
    },
    pingHeartbeat: async (jobName) => {
      const url = requireHttpsUrl(
        config.heartbeatUrl(jobName),
        heartbeatEnvName(jobName),
      );
      const deadline = timeoutSignal(8_000);
      try {
        const response = await fetchHeartbeat(
          fetchImpl,
          url,
          { method: "POST", signal: deadline.signal },
          heartbeatEnvName(jobName),
        );
        await response.body?.cancel().catch(() => {});
        if (!response.ok) {
          throw new Error(`heartbeat returned HTTP ${response.status}`);
        }
      } finally {
        deadline.dispose();
      }
    },
  };
}

function normalizeLegacySource(
  raw: string,
  bucket: string,
  userId: string,
  supabaseUrl: string,
): string | null {
  if (bucket !== "avatars" && bucket !== "entry-photos") return null;
  let path = raw;
  if (raw.includes("://")) {
    let candidate: URL;
    let project: URL;
    try {
      candidate = new URL(raw);
      project = new URL(supabaseUrl);
    } catch {
      return null;
    }
    if (
      candidate.origin !== project.origin || candidate.search || candidate.hash
    ) return null;
    const marker = `/storage/v1/object/public/${bucket}/`;
    if (!candidate.pathname.startsWith(marker)) return null;
    try {
      path = candidate.pathname.slice(marker.length)
        .split("/")
        .map((segment) => decodeURIComponent(segment))
        .join("/");
    } catch {
      return null;
    }
  }
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("://") ||
    path.split("/").some((segment) =>
      !segment || segment === "." || segment === ".."
    ) ||
    path.split("/")[0] !== userId
  ) return null;
  return path;
}

function normalizeProjectQueuePath(
  raw: string,
  bucket: string,
  supabaseUrl: string,
): string | null {
  if (!["avatars", "entry-photos", "image-staging"].includes(bucket)) {
    return null;
  }
  let path = raw;
  if (raw.includes("://")) {
    let candidate: URL;
    let project: URL;
    try {
      candidate = new URL(raw);
      project = new URL(supabaseUrl);
    } catch {
      return null;
    }
    if (
      candidate.origin !== project.origin || candidate.search || candidate.hash
    ) return null;
    const marker = `/storage/v1/object/public/${bucket}/`;
    if (!candidate.pathname.startsWith(marker)) return null;
    try {
      path = candidate.pathname.slice(marker.length)
        .split("/")
        .map((segment) => decodeURIComponent(segment))
        .join("/");
    } catch {
      return null;
    }
  }
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("://") ||
    path.split("/").some((segment) =>
      !segment || segment === "." || segment === ".."
    )
  ) return null;
  return path;
}

async function removeStoragePath(
  client: SupabaseLike,
  bucket: string,
  path: string,
): Promise<void> {
  const { error } = await client.storage.from(bucket).remove([path]);
  if (error) {
    throw new Error(
      `Storage remove ${bucket}/${path}: ${error.message ?? "failed"}`,
    );
  }
}

function objectClaim(row: Record<string, any>, worker: string): ObjectGcClaim {
  return {
    objectId: String(row.object_id),
    bucket: String(row.bucket),
    path: String(row.storage_path),
    worker,
  };
}

function createOutboxAdapter(
  client: SupabaseLike,
  config: ModerationJobsConfig,
  fetchImpl: FetchLike,
): OutboxAdapter {
  return {
    claim: async (holder) => {
      const row = dataRows(
        await rpc(client, "fn_claim_email_outbox", {
          p_worker: holder,
          p_batch: 1,
        }),
      )[0];
      if (!row) return null;
      return {
        idempotencyKey: String(row.idempotency_key),
        providerIdempotencyKey: String(row.provider_idem_key),
        to: String(row.to_addr),
        subject: String(row.subject),
        body: String(row.body),
      };
    },
    send: async (row) => {
      if (!config.resendApiKey || !config.resendFromEmail) {
        throw new Error("Resend is not configured");
      }
      const deadline = timeoutSignal(10_000);
      try {
        const response = await fetchImpl("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.resendApiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": row.providerIdempotencyKey,
          },
          body: JSON.stringify({
            from: config.resendFromEmail,
            to: [row.to],
            subject: row.subject,
            text: row.body,
          }),
          signal: deadline.signal,
        });
        const responseBody = await response.text();
        if (!response.ok) {
          throw new Error(
            `Resend returned HTTP ${response.status}: ${
              responseBody.slice(0, 300)
            }`,
          );
        }
      } finally {
        deadline.dispose();
      }
    },
    markSent: async (holder, idempotencyKey) => {
      const value = await rpc(client, "fn_finish_email_outbox", {
        p_idempotency_key: idempotencyKey,
        p_worker: holder,
        p_success: true,
        p_error: null,
      });
      return value === true;
    },
    markFailed: async (holder, idempotencyKey, error) => {
      await rpc(client, "fn_finish_email_outbox", {
        p_idempotency_key: idempotencyKey,
        p_worker: holder,
        p_success: false,
        p_error: error.slice(0, 2_000),
      });
    },
  };
}

export async function drainOutbox(
  client: SupabaseLike,
  config: ModerationJobsConfig,
  fetchImpl: FetchLike,
  holder: string,
  checkpoint?: () => Promise<void>,
): Promise<{ sent: number; failed: number }> {
  const adapter = createOutboxAdapter(client, config, fetchImpl);
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < 100; i += 1) {
    await checkpoint?.();
    const result = await drainOneOutboxRow(holder, adapter);
    if (result === "empty") return { sent, failed };
    if (result === "sent") sent += 1;
    else if (result === "failed") failed += 1;
  }
  return { sent, failed };
}

async function enqueueStagingCeilingAlarm(
  client: SupabaseLike,
  config: ModerationJobsConfig,
  lease: JobLease,
  usage: { objects: number; bytes: number },
): Promise<void> {
  const key = `${lease.jobName}:${lease.incidentId}:staging_ceiling`;
  const { error } = await client.from("email_outbox").upsert({
    idempotency_key: key,
    incident_id: lease.incidentId,
    job_name: lease.jobName,
    alarm_kind: "staging_ceiling",
    to_addr: config.opsAlertEmail,
    subject: "Napkin image staging ceiling exceeded",
    body:
      `image-staging contains ${usage.objects} objects / ${usage.bytes} bytes.`,
    provider_idem_key: key,
  }, { onConflict: "idempotency_key", ignoreDuplicates: true });
  if (error) {
    throw new Error(
      `enqueue staging ceiling alarm: ${error.message ?? "failed"}`,
    );
  }
}

export function createProcessor(
  action: JobAction,
  client: SupabaseLike,
  config: ModerationJobsConfig,
  fetchImpl: FetchLike,
): JobProcessor {
  return async (lease, checkpoint) => {
    const worker = `${lease.holder}:${lease.fenceToken}`;

    if (action === "grandfather") {
      const sources = new Map<string, string>();
      return await runGrandfather({
        checkpoint,
        enabled: async () => {
          const { data, error } = await client.from("moderation_config")
            .select("enforce")
            .eq("key", "grandfather_sweep")
            .maybeSingle();
          if (error) {
            throw new Error(`grandfather gate: ${error.message ?? "failed"}`);
          }
          return data?.enforce === true;
        },
        listLegacy: async (cursor) => {
          const rows = dataRows(
            await rpc(client, "fn_claim_grandfather_candidates", {
              p_after_cursor: cursor,
              p_limit: 50,
            }),
          );
          const mapped = rows.map((row) => {
            const item: LegacySink = {
              sinkKind: row.sink_kind,
              sinkId: String(row.sink_id),
              userId: String(row.user_id),
              url: String(row.original_url),
            };
            const source = normalizeLegacySource(
              item.url,
              String(row.bucket),
              item.userId,
              config.supabaseUrl,
            );
            if (source) sources.set(`${item.sinkKind}:${item.sinkId}`, source);
            return item;
          });
          return {
            rows: mapped,
            nextCursor: rows.length === 50 ? String(rows.at(-1)?.cursor) : null,
          };
        },
        isOwnedLocalUrl: (item) =>
          sources.has(`${item.sinkKind}:${item.sinkId}`),
        quarantineForeign: async (item) => {
          await rpc(client, "fn_quarantine_legacy_image", {
            p_sink_kind: item.sinkKind,
            p_sink_id: item.sinkId,
            p_user_id: item.userId,
            p_original_url: item.url,
            p_reason: "foreign_or_unscannable_url",
          });
        },
        moderateLegacy: async (item) => {
          const sourcePath = sources.get(`${item.sinkKind}:${item.sinkId}`);
          if (!sourcePath) throw new Error("owned legacy source path was lost");
          const bucket = item.sinkKind === "avatar"
            ? "avatars"
            : "entry-photos";
          const result = await moderateOwnedStorageObject({
            client,
            supabaseUrl: config.supabaseUrl,
            serviceKey: config.serviceKey,
            visionApiKey: config.visionKey,
            userId: item.userId,
            sourceBucket: bucket,
            sourcePath,
            kind: item.sinkKind === "avatar" ? "avatar" : "entry_photo",
            fetchImpl,
          });
          if (result.verdict === "rejected") {
            return { verdict: "rejected" as const };
          }
          return {
            verdict: "pass" as const,
            promoted: {
              objectId: result.sha256,
              approvedUrl: result.approved_url,
              storagePath: result.storage_path,
              bucket: result.bucket,
            },
          };
        },
        rebindPass: async (item, promoted) => {
          await rpc(client, "fn_rebind_legacy_image", {
            p_sink_kind: item.sinkKind,
            p_sink_id: item.sinkId,
            p_user_id: item.userId,
            p_original_url: item.url,
            p_approved_url: promoted.approvedUrl,
          });
        },
        rejectAndNotifyOnce: async (item) => {
          await rpc(client, "fn_reject_legacy_image", {
            p_sink_kind: item.sinkKind,
            p_sink_id: item.sinkId,
            p_user_id: item.userId,
            p_original_url: item.url,
            p_reason: "moderation_rejected",
          });
        },
      }, lease.cursor);
    }

    if (action === "gc_staging") {
      return await runStagingGc({
        checkpoint,
        claimBatch: async () =>
          dataRows(
            await rpc(client, "fn_claim_staging_gc", {
              p_worker: worker,
              p_batch: 50,
            }),
          ).map((row) => ({
            reservationId: String(row.id),
            path: String(row.staging_path),
          })),
        remove: (path) => removeStoragePath(client, "image-staging", path),
        finish: async (reservationId) =>
          requireTrue(
            await rpc(client, "fn_finish_staging_gc", {
              p_reservation_id: reservationId,
              p_worker: worker,
              p_success: true,
              p_error: null,
            }),
            "finish staging GC",
          ),
        fail: async (reservationId, error) => {
          requireTrue(
            await rpc(client, "fn_finish_staging_gc", {
              p_reservation_id: reservationId,
              p_worker: worker,
              p_success: false,
              p_error: error,
            }),
            "fail staging GC",
          );
        },
      });
    }

    if (action === "gc_unbound") {
      return await runObjectGc({
        checkpoint,
        claimBatch: async () =>
          dataRows(
            await rpc(client, "fn_claim_unbound_image_gc", {
              p_worker: worker,
              p_batch: 50,
            }),
          ).map((row) => objectClaim(row, worker)),
        remove: (row) => removeStoragePath(client, row.bucket, row.path),
        finish: async (row) =>
          requireTrue(
            await rpc(client, "fn_finish_image_object_gc", {
              p_object_id: row.objectId,
              p_worker: row.worker,
              p_success: true,
              p_error: null,
            }),
            "finish unbound object GC",
          ),
        fail: async (row, error) => {
          requireTrue(
            await rpc(client, "fn_finish_image_object_gc", {
              p_object_id: row.objectId,
              p_worker: row.worker,
              p_success: false,
              p_error: error,
            }),
            "fail unbound object GC",
          );
        },
      });
    }

    if (action === "gc_refdriven") {
      const claimed = new Map<string, Record<string, any>>();
      const alreadySettled = new Set<string>();
      return await runRefDrivenGc({
        checkpoint,
        claimBatch: async () => {
          const rows = dataRows(
            await rpc(client, "fn_claim_gc_queue", {
              p_worker: worker,
              p_batch: 25,
            }),
          );
          for (const row of rows) claimed.set(String(row.id), row);
          return rows.map((row) => ({ queueId: String(row.id) }));
        },
        unlink: async (row) => {
          const result = dataObject(
            await rpc(client, "fn_unlink_gc_ref", {
              p_queue_id: row.queueId,
              p_worker: worker,
            }),
          );
          if (result.legacy_path) {
            const queue = claimed.get(row.queueId);
            const bucket = String(queue?.bucket ?? "");
            const path = normalizeProjectQueuePath(
              String(result.legacy_path),
              bucket,
              config.supabaseUrl,
            );
            // Foreign quarantined URLs have no project-owned bytes.
            if (path) await removeStoragePath(client, bucket, path);
            return null;
          }
          if (result.claimable !== true) {
            // fn_unlink_gc_ref already made the queue terminal (or
            // durably deferred it) when refs/storage were restored.
            // There is no deleting claim left for finishQueue.
            alreadySettled.add(row.queueId);
            return null;
          }
          if (!result.object_id) {
            throw new Error("claimable GC ref omitted object_id");
          }
          const object = dataObject(
            await rpc(client, "fn_claim_image_object_gc", {
              p_object_id: result.object_id,
              p_worker: worker,
              p_reason: "ref_unlinked",
            }),
          );
          return object.claimed === true ? objectClaim(object, worker) : null;
        },
        removeObject: (row) => removeStoragePath(client, row.bucket, row.path),
        finishObject: async (row) =>
          requireTrue(
            await rpc(client, "fn_finish_image_object_gc", {
              p_object_id: row.objectId,
              p_worker: row.worker,
              p_success: true,
              p_error: null,
            }),
            "finish ref-driven object GC",
          ),
        failObject: async (row, error) => {
          requireTrue(
            await rpc(client, "fn_finish_image_object_gc", {
              p_object_id: row.objectId,
              p_worker: row.worker,
              p_success: false,
              p_error: error,
            }),
            "fail ref-driven object GC",
          );
        },
        finishQueue: async (row) => {
          if (alreadySettled.delete(row.queueId)) return;
          requireTrue(
            await rpc(client, "fn_finish_gc_queue", {
              p_queue_id: row.queueId,
              p_worker: worker,
              p_success: true,
              p_error: null,
            }),
            "finish ref-driven queue GC",
          );
        },
        failQueue: async (row, error) => {
          requireTrue(
            await rpc(client, "fn_finish_gc_queue", {
              p_queue_id: row.queueId,
              p_worker: worker,
              p_success: false,
              p_error: error,
            }),
            "fail ref-driven queue GC",
          );
        },
      });
    }

    if (action === "reconcile") {
      const page = dataObject(
        await rpc(client, "fn_list_reconcile_findings", {
          p_after_cursor: lease.cursor,
          p_limit: 100,
        }),
      );
      const findings: ReconcileFinding[] = dataRows(page.rows).map((row) => {
        const kind = String(row.kind);
        if (kind === "orphan_storage") {
          return {
            kind,
            bucket: String(row.bucket),
            path: String(row.path),
          };
        }
        if (
          ![
            "promoting_object_present",
            "promoting_object_missing",
            "expired_delete_lease",
            "registry_storage_missing",
          ].includes(kind) || !row.object_id
        ) {
          throw new Error("fn_list_reconcile_findings returned an invalid row");
        }
        return { kind, objectId: String(row.object_id) } as ReconcileFinding;
      });
      const nextCursor =
        typeof page.next_cursor === "string" && page.next_cursor.length > 0
          ? page.next_cursor
          : null;
      return await runReconcile({
        checkpoint,
        nextCursor,
        findings: async () => findings,
        repair: async (finding) => {
          if (finding.kind === "orphan_storage") {
            await rpc(client, "fn_enqueue_orphan_storage_object", {
              p_bucket: finding.bucket,
              p_storage_path: finding.path,
            });
            return;
          }
          await rpc(client, "fn_reconcile_registry_object", {
            p_object_id: finding.objectId,
            p_storage_exists: finding.kind === "promoting_object_present",
          });
        },
        stagingUsage: async () => {
          const usage = dataObject(
            await rpc(client, "fn_reconcile_staging_usage", {}),
          );
          const objects = Number(usage.objects ?? 0);
          const bytes = Number(usage.bytes ?? 0);
          if (
            !Number.isSafeInteger(objects) || objects < 0 ||
            !Number.isFinite(bytes) || bytes < 0
          ) {
            throw new Error(
              "fn_reconcile_staging_usage returned invalid metrics",
            );
          }
          return {
            objects,
            bytes,
          };
        },
        enqueueCeilingAlarm: (usage) =>
          enqueueStagingCeilingAlarm(client, config, lease, usage),
      });
    }

    if (action === "account_cleanup") {
      const rows = dataRows(
        await rpc(client, "fn_claim_account_cleanup", { p_batch: 25 }),
      );
      let processed = 0;
      for (const row of rows) {
        await checkpoint();
        const deletion = row as AccountDeletion;
        const result = await advanceAccountDeletion(
          deletion,
          createSupabaseDeletionAdapter(client, String(row.user_id)),
        );
        if (result.deleted) processed += 1;
      }
      return {
        itemsProcessed: processed,
        cursor: rows.at(-1)?.user_id ?? null,
      };
    }

    if (action === "ops-alarm") {
      const result = await drainOutbox(
        client,
        config,
        fetchImpl,
        worker,
        checkpoint,
      );
      if (result.failed > 0) {
        throw new Error(`${result.failed} alert email(s) failed to send`);
      }
      return { itemsProcessed: result.sent, cursor: null };
    }

    throw new Error(`No scheduled processor for ${action}`);
  };
}

export async function runAlarmSelftest(
  client: SupabaseLike,
  config: ModerationJobsConfig,
  fetchImpl: FetchLike,
  lease: JobLease,
): Promise<
  { idempotencyKey: string; sent: true; heartbeatIntentionallyMissed: true }
> {
  const created = dataObject(
    await rpc(client, "fn_enqueue_alarm_selftest", {
      p_to_addr: config.opsAlertEmail,
    }),
  );
  const idempotencyKey = String(created.idempotency_key ?? "");
  if (!idempotencyKey) {
    throw new Error("alarm self-test did not enqueue an outbox row");
  }
  const result = await drainOutbox(
    client,
    config,
    fetchImpl,
    `${lease.holder}:${lease.fenceToken}:selftest`,
  );
  if (result.failed > 0) throw new Error("alarm self-test email failed");
  const { data, error } = await client.from("email_outbox")
    .select("state")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error || data?.state !== "sent") {
    throw new Error("alarm self-test email was not durably sent");
  }
  return { idempotencyKey, sent: true, heartbeatIntentionallyMissed: true };
}
