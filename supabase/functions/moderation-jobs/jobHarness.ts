/** Shared fenced job harness for all TICKET-196 background work. */

export const JOB_ACTIONS = [
  "grandfather",
  "gc_staging",
  "gc_unbound",
  "gc_refdriven",
  "reconcile",
  "account_cleanup",
  "ops-alarm",
  "alarm_selftest",
] as const;

export const SCHEDULED_JOB_ACTIONS = JOB_ACTIONS.slice(0, 6);
export type JobAction = typeof JOB_ACTIONS[number];

export type JobLease = {
  jobName: JobAction;
  holder: string;
  fenceToken: number;
  runId: string;
  incidentId: string;
  attempt: number;
  cursor: string | null;
};

export type JobProgress = { itemsProcessed: number; cursor: string | null };

export interface JobHarnessAdapter {
  claim(jobName: JobAction, holder: string): Promise<JobLease | null>;
  renew(lease: JobLease): Promise<boolean>;
  complete(lease: JobLease, progress: JobProgress): Promise<boolean>;
  fail(lease: JobLease, error: string, nextAttemptAt: string): Promise<boolean>;
  pingHeartbeat(jobName: JobAction): Promise<void>;
  now(): Date;
}

export type LeaseCheckpoint = () => Promise<void>;
export type JobProcessor = (
  lease: JobLease,
  checkpoint: LeaseCheckpoint,
) => Promise<JobProgress>;

class JobLeaseSupersededError extends Error {}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const MAX_BACKOFF_MS = 48 * 60 * 60 * 1000;

export function retryAt(now: Date, failedAttempt: number): string {
  const multiplier = 2 ** Math.max(0, failedAttempt - 1);
  const delay = Math.min(SIX_HOURS_MS * multiplier, MAX_BACKOFF_MS);
  return new Date(now.getTime() + delay).toISOString();
}

export function isJobAction(value: string): value is JobAction {
  return (JOB_ACTIONS as readonly string[]).includes(value);
}

export async function runFencedJob(
  jobName: JobAction,
  holder: string,
  processor: JobProcessor,
  adapter: JobHarnessAdapter,
): Promise<
  { status: "busy" | "ok" | "failed" | "superseded"; progress?: JobProgress }
> {
  const lease = await adapter.claim(jobName, holder);
  if (!lease) return { status: "busy" };

  const checkpoint: LeaseCheckpoint = async () => {
    if (!await adapter.renew(lease)) throw new JobLeaseSupersededError();
  };

  try {
    // Renew immediately after claim, between every bounded processor item,
    // and once more before alarm evaluation/completion. With a 600s lease
    // (longer than Edge's wall clock), no live invocation expires normally.
    await checkpoint();
    const progress = await processor(lease, checkpoint);
    await checkpoint();
    const wonCompletionCas = await adapter.complete(lease, progress);
    if (!wonCompletionCas) return { status: "superseded" };

    // The heartbeat is intentionally reachable only from the branch that
    // won the token-conditioned terminal-completion CAS. A stale worker
    // cannot produce a false-success ping after lease takeover.
    await adapter.pingHeartbeat(jobName);
    return { status: "ok", progress };
  } catch (error) {
    if (error instanceof JobLeaseSupersededError) {
      return { status: "superseded" };
    }
    const message = error instanceof Error ? error.message : String(error);
    const accepted = await adapter.fail(
      lease,
      message.slice(0, 2_000),
      retryAt(adapter.now(), lease.attempt),
    );
    // On attempt three, fn_fail_moderation_job inserts retry_exhausted in
    // this same transaction. There is deliberately no crash-gapped second
    // enqueue call here.
    return { status: accepted ? "failed" : "superseded" };
  }
}

export type OutboxClaim = {
  idempotencyKey: string;
  providerIdempotencyKey: string;
  to: string;
  subject: string;
  body: string;
};

export interface OutboxAdapter {
  claim(holder: string): Promise<OutboxClaim | null>;
  send(row: OutboxClaim): Promise<void>;
  markSent(holder: string, idempotencyKey: string): Promise<boolean>;
  markFailed(
    holder: string,
    idempotencyKey: string,
    error: string,
  ): Promise<void>;
}

/**
 * At-least-once delivery. The durable sent state is primary; the provider key
 * covers Resend's 24h window, but a >24h claimed-row crash may rarely duplicate.
 */
export async function drainOneOutboxRow(
  holder: string,
  adapter: OutboxAdapter,
): Promise<"empty" | "sent" | "failed" | "superseded"> {
  const row = await adapter.claim(holder);
  if (!row) return "empty";
  try {
    await adapter.send(row);
    return await adapter.markSent(holder, row.idempotencyKey)
      ? "sent"
      : "superseded";
  } catch (error) {
    await adapter.markFailed(
      holder,
      row.idempotencyKey,
      error instanceof Error ? error.message : String(error),
    );
    return "failed";
  }
}
