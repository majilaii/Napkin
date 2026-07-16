/** Owner-scoped exhausted-item read/retry/correct/dismiss surface. */

import {
  buildPage,
  type CursorTuple,
  decodeCursor,
} from "../_shared/pagination.ts";

export const EXHAUSTED_PAGE_LIMIT = 50;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

export interface ExhaustedCompletenessItem {
  id: string;
  job_id: string;
  item_nonce: string;
  restaurant_id: string | null;
  restaurant_name: string | null;
  restaurant_city: string | null;
  last_error: string | null;
  created_at: string;
}

export interface ExhaustedCompletenessPage {
  items: ExhaustedCompletenessItem[];
  next_cursor: string | null;
  has_more: boolean;
}

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function factString(value: unknown, key: string): string | null {
  const facts = asRecord(value);
  const direct = facts?.[key];
  if (typeof direct === "string" && direct.trim() !== "") return direct.trim();
  const extracted = asRecord(facts?.extracted);
  const nested = extracted?.[key];
  return typeof nested === "string" && nested.trim() !== ""
    ? nested.trim()
    : null;
}

/**
 * Parse the opaque keyset cursor without allowing request text to be interpolated
 * into a PostgREST `.or()` expression. `undefined` means invalid; `null` is the
 * legitimate first page.
 */
export function parseExhaustedCursor(
  value: unknown,
): CursorTuple | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value === "") return undefined;
  const decoded = decodeCursor(value);
  if (
    !decoded ||
    !TIMESTAMP_RE.test(decoded.sort_date) ||
    Number.isNaN(Date.parse(decoded.sort_date)) ||
    !UUID_RE.test(decoded.id)
  ) {
    return undefined;
  }
  return decoded;
}

export async function listExhaustedCompletenessItems(
  supabase: SupabaseLike,
  ownerId: string,
  cursor: CursorTuple | null = null,
): Promise<ExhaustedCompletenessPage> {
  // The service-role client bypasses RLS, so owner_id MUST remain in this
  // query. The endpoint never accepts a target owner id from the request.
  let query = supabase
    .from("restaurant_completeness_queue")
    .select(
      "id,job_id,item_nonce,restaurant_id,client_facts,last_error,created_at",
    )
    .eq("owner_id", ownerId)
    .eq("state", "exhausted")
    .is("dismissed_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.sort_date},and(created_at.eq.${cursor.sort_date},id.lt.${cursor.id})`,
    );
  }
  const { data: rows, error } = await query.limit(EXHAUSTED_PAGE_LIMIT + 1);
  if (error) throw error;
  const rawPage = buildPage(
    Array.isArray(rows) ? rows : [],
    EXHAUSTED_PAGE_LIMIT,
    (row) => ({ sort_date: row.created_at, id: row.id }),
  );
  if (rawPage.rows.length === 0) {
    return {
      items: [],
      next_cursor: rawPage.next_cursor,
      has_more: rawPage.has_more,
    };
  }

  const restaurantIds = [
    ...new Set(
      rawPage.rows
        .map((row) => row.restaurant_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  const restaurantById = new Map<
    string,
    { name: string | null; city: string | null }
  >();
  if (restaurantIds.length > 0) {
    const { data: restaurants, error: restaurantError } = await supabase
      .from("restaurants")
      .select("id,name,city")
      .in("id", restaurantIds);
    if (restaurantError) throw restaurantError;
    for (const restaurant of restaurants ?? []) {
      restaurantById.set(restaurant.id, {
        name: typeof restaurant.name === "string" ? restaurant.name : null,
        city: typeof restaurant.city === "string" ? restaurant.city : null,
      });
    }
  }

  const items = rawPage.rows.map((row): ExhaustedCompletenessItem => {
    const restaurant = typeof row.restaurant_id === "string"
      ? restaurantById.get(row.restaurant_id)
      : undefined;
    return {
      id: row.id,
      job_id: row.job_id,
      item_nonce: row.item_nonce,
      restaurant_id: row.restaurant_id ?? null,
      restaurant_name: restaurant?.name ?? factString(row.client_facts, "name"),
      restaurant_city: restaurant?.city ?? factString(row.client_facts, "city"),
      last_error: row.last_error ?? null,
      created_at: row.created_at,
    };
  });
  return {
    items,
    next_cursor: rawPage.next_cursor,
    has_more: rawPage.has_more,
  };
}

export async function retryExhaustedCompletenessItem(
  supabase: SupabaseLike,
  actorId: string,
  itemId: string,
): Promise<boolean> {
  // Actor is the JWT-validated user, never a request-body owner id. The SQL
  // RPC locks the row and repeats owner_id = p_actor before resetting state.
  const { data, error } = await supabase.rpc("fn_retry_completeness_item", {
    p_actor: actorId,
    p_item_id: itemId,
  });
  if (error) throw error;
  if (typeof data === "boolean") return data;
  if (Array.isArray(data) && typeof data[0] === "boolean") return data[0];
  if (data && typeof data === "object") {
    return Object.values(data).some((value) => value === true);
  }
  return false;
}

export async function dismissExhaustedCompletenessItem(
  supabase: SupabaseLike,
  actorId: string,
  itemId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("fn_dismiss_completeness_item", {
    p_actor: actorId,
    p_item_id: itemId,
  });
  if (error) throw error;
  if (typeof data === "boolean") return data;
  if (Array.isArray(data) && typeof data[0] === "boolean") return data[0];
  if (data && typeof data === "object") {
    return Object.values(data).some((value) => value === true);
  }
  return false;
}

export async function correctExhaustedCompletenessItem(
  supabase: SupabaseLike,
  actorId: string,
  itemId: string,
  resolutionId: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.rpc("fn_correct_completeness_item", {
    p_actor: actorId,
    p_item_id: itemId,
    p_resolution_id: resolutionId,
  });
  if (error) throw error;
  if (Array.isArray(data)) return asRecord(data[0]);
  return asRecord(data);
}
