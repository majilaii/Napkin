/** Owner-scoped live status used to reconcile durable v2 client manifests. */

export interface CompletenessDestinationStatus {
  destination_nonce: string;
  destination_kind: "wishlist" | "table" | "list" | "new_list";
  target_list_id: string | null;
  target_list_title: string | null;
  outcome: "pending" | "fulfilled" | "rejected";
  result: Record<string, unknown> | null;
}

export interface CompletenessItemStatus {
  id: string;
  item_nonce: string;
  state: string;
  restaurant_id: string | null;
  last_error: string | null;
  destinations: CompletenessDestinationStatus[];
}

export interface CompletenessJobStatus {
  job_id: string;
  sealed: boolean;
  done_emitted: boolean;
  items: CompletenessItemStatus[];
}

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

const STATUS_PAGE_SIZE = 500;
// fn_enqueue_completeness bounds a sealed job to 2,000 destinations. Every
// queued item must own at least one destination, so 2,000 also bounds items and
// route-ledger rows. Page below the PostgREST row cap instead of truncating.
const STATUS_MAX_ROWS = 2_000;

async function readStatusPages(
  buildQuery: () => SupabaseLike,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  while (rows.length < STATUS_MAX_ROWS) {
    const from = rows.length;
    const to = Math.min(from + STATUS_PAGE_SIZE, STATUS_MAX_ROWS) - 1;
    const { data, error } = await buildQuery().range(from, to);
    if (error) throw error;
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < to - from + 1) break;
  }
  return rows.slice(0, STATUS_MAX_ROWS);
}

function resultRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function getCompletenessJobStatus(
  supabase: SupabaseLike,
  ownerId: string,
  jobId: string,
): Promise<CompletenessJobStatus | null> {
  // Every service-role read carries BOTH owner and job. The request can choose
  // a job id, but never an owner id.
  const { data: job, error: jobError } = await supabase
    .from("import_jobs")
    .select("job_id,sealed_at,done_emitted_at")
    .eq("job_id", jobId)
    .eq("user_id", ownerId)
    .maybeSingle();
  if (jobError) throw jobError;
  if (!job) return null;

  const [items, destinations, ledger] = await Promise.all([
    readStatusPages(() =>
      supabase
        .from("restaurant_completeness_queue")
        .select("id,item_nonce,state,restaurant_id,last_error,created_at")
        .eq("owner_id", ownerId)
        .eq("job_id", jobId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
    ),
    readStatusPages(() =>
      supabase
        .from("completeness_destinations")
        .select(
          "id,item_nonce,destination_nonce,destination_kind,target_list_id,target_list_title,outcome,created_at",
        )
        .eq("owner_id", ownerId)
        .eq("job_id", jobId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
    ),
    readStatusPages(() =>
      supabase
        .from("destination_nonce_ledger")
        .select("ledger_key,result")
        .eq("owner_id", ownerId)
        .eq("job_id", jobId)
        .like("ledger_key", "route:%")
        .order("ledger_key", { ascending: true })
    ),
  ]);

  const resultByKey = new Map<string, Record<string, unknown> | null>();
  for (const row of ledger) {
    resultByKey.set(row.ledger_key as string, resultRecord(row.result));
  }
  const destinationsByItem = new Map<string, CompletenessDestinationStatus[]>();
  for (const destination of destinations) {
    const key =
      `route:${ownerId}:${jobId}:${destination.item_nonce}:${destination.destination_nonce}`;
    const itemNonce = destination.item_nonce as string;
    const statuses = destinationsByItem.get(itemNonce) ?? [];
    statuses.push({
      destination_nonce: destination.destination_nonce as string,
      destination_kind: destination
        .destination_kind as CompletenessDestinationStatus["destination_kind"],
      target_list_id: typeof destination.target_list_id === "string"
        ? destination.target_list_id
        : null,
      target_list_title: typeof destination.target_list_title === "string"
        ? destination.target_list_title
        : null,
      outcome: destination.outcome as CompletenessDestinationStatus["outcome"],
      result: resultByKey.get(key) ?? null,
    });
    destinationsByItem.set(itemNonce, statuses);
  }

  return {
    job_id: job.job_id,
    sealed: job.sealed_at != null,
    done_emitted: job.done_emitted_at != null,
    items: items.map((item: Record<string, unknown>) => ({
      id: item.id as string,
      item_nonce: item.item_nonce as string,
      state: item.state as string,
      restaurant_id: typeof item.restaurant_id === "string"
        ? item.restaurant_id
        : null,
      last_error: typeof item.last_error === "string" ? item.last_error : null,
      destinations: destinationsByItem.get(item.item_nonce as string) ?? [],
    })),
  };
}
