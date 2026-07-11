/**
 * Utility functions for table-shares edge function.
 * Extracted for testability (same pattern as places-search/utils.ts).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * fn_correct_import_job takes `p_restaurant_id uuid` — a non-UUID string
 * (classically a Google Place id like "ChIJ…" sent by a client that skipped
 * the persist step) fails Postgres coercion as an opaque 500. Validate the
 * shape up front so the mistake surfaces as a clear 400 instead.
 */
export function isUuid(value: unknown): value is string {
    return typeof value === 'string' && UUID_RE.test(value);
}
