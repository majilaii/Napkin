/**
 * Hook to create a meal log entry.
 * Calls the entry edge function which handles restaurant upsert,
 * table sharing, and user_restaurant_status updates.
 *
 * TICKET-037 (P2-13): reads optional `warnings` from response and surfaces
 * a toast when companion tagging partially fails.
 *
 * TICKET-036 (P0-6): generates a `client_nonce` (uuid) per submission.
 *   - Server uses it to dedupe retries (entries_user_client_nonce_uidx).
 *   - Client uses it to optimistically prepend a placeholder row to the
 *     viewer's mySolo cache so the Journal tab doesn't flash empty
 *     during the round-trip, then swaps the placeholder for the real
 *     row in onSuccess. onError rolls back from snapshot.
 *
 * TICKET-043: extended to accept `table_ids?: string[]` for multi-Table posting.
 *   - `table_ids` wins over legacy `table_id`; both accepted for one release.
 *   - Client-side normalization (trim/dedupe/order) before send; server is authoritative.
 *   - Optimistic prepend fans out into every `tables.activity(id)` for each Table.
 *   - `table_not_authorized` (403): non-leaking toast, atomic rollback of all caches,
 *     optional `onTableNotAuthorized(offendingIds)` callback.
 *   - Atlas invalidation fires for `table_ids[0]` (primary) only.
 *
 * TICKET-042: extended optimistic patch to:
 *   - tables.activity(tableId) — Table activity feed (when table_id present)
 *   - entries.forDay(userId, localDateStr) — day-bucketed journal view
 *   - entries.mySolo(userId) — solo journal (existing, feed-only entries only)
 * All caches are snapshotted and rolled back together on error.
 * onSuccess reconciles by client_nonce, handles midnight day-bucket migration.
 *
 * TICKET-098: the feed.all optimistic prepend/reconcile was REMOVED. The legacy
 * cross-Table feed is gone; the new friends feed (feed.friends) never shows the
 * viewer's own entries, so there is nothing to patch on create.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { SessionExpiredError } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useToast } from '@/providers/ToastProvider';
import { localDateStr } from '@/lib/dateHelpers';
import { safeRandomUUID } from '@/lib/uuid';
import { track } from '@/lib/track';
import {
    prependToInfinitePages,
    swapByNonce,
    snapshotInfinite,
    prependArray,
    removeFromArray,
    swapInArray,
} from '@/lib/optimistic';
import type { SoloShareActivity } from '@/hooks/tables/useTableActivity';
import type { ActivityItem } from '@/hooks/tables/useTableActivity';
import type { Page } from '@/lib/pagination';
import type { InfiniteData } from '@tanstack/react-query';
import { invalidateEntryTasteCaches } from '@/hooks/entries/invalidateEntryTaste';

export interface CreateEntryInput {
    /** Persisted restaurant id. Ghost logs send `restaurant` and receive this id back. */
    restaurant_id?: string;
    restaurant?: {
        external_id: string;
        name: string;
        location?: {
            address?: string;
            locality?: string;
            country?: string;
        };
        types?: string[];
        latitude?: number;
        longitude?: number;
        photoReference?: string;
        photoAttributionHtml?: string | null;
        /** Full Places metadata — the upsert is sparse-write, so senders should
         * carry everything they have (first log at a ghost creates the row;
         * missing fields here made the page's Google numbers vanish). */
        googleRating?: number;
        googleRatingCount?: number;
        priceLevel?: number;
        cuisine?: string | null;
        phone?: string | null;
        website?: string | null;
        google_maps_uri?: string | null;
        hours?: unknown;
    };
    rating?: number | null;
    content?: string;
    dish_description?: string;
    cooked_by?: string;
    visited_at?: string;
    table_id?: string;
    /**
     * TICKET-043: multi-Table posting. When present, `table_ids` wins over `table_id`.
     * Client normalizes (trim/dedupe/preserve order) before sending; server re-normalizes.
     * Max 10 entries — server enforces, client mirrors for UX error message.
     */
    table_ids?: string[];
    visibility?: 'private' | 'friends' | 'table' | 'both';
    participant_ids?: string[];
    /** Companion tagging — who was there (distinct from Round participant_ids) */
    companion_ids?: string[];
    /**
     * TICKET-082: when true, this host entry opens a Supper — a shared-table meal
     * the tagged friends can add their own take to. `supper_participant_ids` are
     * the tagged friend ids (server seeds them into supper_members + companions).
     */
    supper?: boolean;
    supper_participant_ids?: string[];
    vibe_rating?: number | null;
    flavor_rating?: number | null;
    service_rating?: number | null;
    value_rating?: number | null;
    /** TICKET-075: Letterboxd-style like — distinct from the rating value. */
    liked?: boolean;
    photo_url?: string;
    photo_urls?: string[];
    /** Generated by useCreateEntry — do not pass from callers. */
    client_nonce?: string;
}

/**
 * Client-side normalization for table_ids (TICKET-043).
 * Server is authoritative but we normalize client-side to match the optimistic
 * patch logic with what will actually be sent.
 */
function normalizeTableIds(input: CreateEntryInput): string[] {
    // table_ids wins over table_id when both are present.
    const raw = input.table_ids ?? (input.table_id ? [input.table_id] : []);
    const seen = new Set<string>();
    const result: string[] = [];
    for (const id of raw) {
        const trimmed = id?.trim();
        if (trimmed && !seen.has(trimmed)) {
            seen.add(trimmed);
            result.push(trimmed);
        }
    }
    return result;
}

/**
 * TICKET-075: is this invoke error a 401 / invalid-JWT? Detected off the
 * FunctionsHttpError Response status on `.context.status`.
 */
function isInvoke401(error: unknown): boolean {
    const status = (error as { context?: { status?: number } })?.context?.status;
    if (status === 401) return true;
    const message = ((error as Error)?.message ?? '').toLowerCase();
    return message.includes('invalid jwt') || message.includes('jwt expired');
}

/** Single invoke of the `entry` edge function with the current session token. */
async function invokeEntryOnce(bodyWithTableIds: Record<string, unknown>) {
    const { data: { session } } = await supabase.auth.getSession();
    return supabase.functions.invoke('entry', {
        body: bodyWithTableIds,
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });
}

async function createEntry(input: CreateEntryInput): Promise<any> {
    // TICKET-043: normalize table_ids client-side before sending.
    const effectiveTableIds = normalizeTableIds(input);
    const bodyWithTableIds = {
        ...input,
        table_ids: effectiveTableIds,
        // Keep table_id for legacy server code that may not yet read table_ids.
        table_id: effectiveTableIds[0] ?? input.table_id ?? null,
    };

    // The entry edge function returns { data: EntryRow, warnings?: [...] }.
    // callEdgeFn returns whatever's at `data.data` — we lose `warnings`.
    // Fall back to direct invoke for this one call so we can read the warnings
    // envelope. (Acceptable exception to the callEdgeFn doctrine — documented
    // here, and warnings is a TICKET-037 P2-13 quirk that the helper API
    // doesn't yet expose. If a third hook needs envelope access we'll
    // generalize callEdgeFn to return { data, meta }.)
    //
    // TICKET-075: mirror callEdgeFn's 401 recovery — on a stale-session 401,
    // refresh once and retry; if the refresh fails, throw SessionExpiredError so
    // the app routes to sign-out → /auth rather than a raw "non-2xx" toast.
    let { data, error } = await invokeEntryOnce(bodyWithTableIds);
    if (error && isInvoke401(error)) {
        const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession();
        if (refreshErr || !refreshData.session) throw new SessionExpiredError();
        ({ data, error } = await invokeEntryOnce(bodyWithTableIds));
        if (error && isInvoke401(error)) throw new SessionExpiredError();
    }
    if (error) {
        // TICKET-043 review-fix: edge fn returns table_not_authorized as a 403 with
        // nested { error: { code, message, ids } }. supabase-js throws FunctionsHttpError
        // and exposes the original Response on `.context`. Parse it so the composer can
        // surface a non-leaking toast and roll back optimistic state. (Codex Review 1
        // finding #3.)
        const ctx = (error as any)?.context;
        if (ctx && typeof ctx.json === 'function') {
            try {
                const parsed = await ctx.json();
                const inner = parsed?.error;
                if (inner?.code === 'table_not_authorized') {
                    const wrapped = new Error('table_not_authorized') as any;
                    wrapped.code = 'table_not_authorized';
                    wrapped.offendingIds = Array.isArray(inner.ids) ? inner.ids : [];
                    wrapped.cause = error;
                    throw wrapped;
                }
            } catch (parseErr) {
                // If parseErr is itself the wrapped error, surface it.
                if ((parseErr as any)?.code === 'table_not_authorized') throw parseErr;
                // Otherwise body wasn't JSON or didn't match; fall through to raw error.
            }
        }
        throw error;
    }
    if (data?.error) {
        // Some 200-with-error legacy paths still arrive flat. Handle both nested and flat shapes.
        const inner = typeof data.error === 'object' ? data.error : null;
        const code = inner?.code ?? data.code
            ?? (data.error === 'table_not_authorized' ? 'table_not_authorized' : undefined);
        const offendingIds = inner?.ids ?? data.ids ?? [];
        const err = new Error(typeof data.error === 'string' ? data.error : (inner?.message ?? 'entry_error')) as any;
        err.code = code;
        err.offendingIds = offendingIds;
        throw err;
    }
    // Shallow-clone so we never mutate the mock/server object reference.
    const entryRow = { ...(data?.data ?? {}) };
    if (data?.warnings) {
        (entryRow as any).__warnings = data.warnings;
    }
    // TICKET-050: stash entry_ordinal on the row so composers can surface it
    // in the post-save slip/stamp without a second round-trip.
    if (data?.entry_ordinal !== undefined) {
        (entryRow as any).__entry_ordinal = data.entry_ordinal;
    }
    return entryRow;
}

/**
 * Build a placeholder SoloShareActivity from the user's input so we can
 * optimistically prepend it to the mySolo and forDay caches.
 * The id is `optimistic-<nonce>` so onSuccess can find + swap it for the real server row.
 */
function buildOptimisticSoloShare(
    input: CreateEntryInput,
    userId: string,
    nonce: string,
): SoloShareActivity {
    const now = new Date().toISOString();
    const visited = input.visited_at ?? now;
    return {
        type: 'solo_share',
        id: `optimistic-${nonce}`,
        user_id: userId,
        restaurant_id: null,
        rating: input.rating ?? null,
        content: input.content ?? null,
        dish_description: input.dish_description ?? null,
        visited_at: visited,
        created_at: now,
        sort_date: visited,
        photo_url: input.photo_urls?.[0] ?? input.photo_url ?? null,
        photo_count: input.photo_urls?.length ?? (input.photo_url ? 1 : 0),
        reaction_count: 0,
        comment_count: 0,
        top_emojis: [],
        my_reactions: [],
        restaurants: input.restaurant
            ? {
                  id: '',
                  name: input.restaurant.name,
                  address: input.restaurant.location?.address ?? null,
                  city: input.restaurant.location?.locality ?? null,
                  photo_url: null,
              }
            : null,
        profiles: { display_name: '' },
    };
}

/**
 * Build a placeholder ActivityItem (solo_share type) for the tables.activity cache.
 * The activity feed shows solo shares via SoloShareActivity shape.
 */
function buildOptimisticActivityItem(
    input: CreateEntryInput,
    userId: string,
    nonce: string,
): SoloShareActivity {
    // Same shape as mySolo optimistic row — SoloShareActivity covers both caches.
    return buildOptimisticSoloShare(input, userId, nonce);
}

interface MutationContext {
    /** Ordered list of snapshot restores — call each on error. */
    restores: Array<() => void>;
    nonce: string;
    /** The viewer-local date bucket the entry was optimistically placed in. */
    viewerLocalDate: string;
    mySoloKey?: readonly unknown[];
    /** TICKET-043: one key per selected Table (multi-Table fan-out). */
    activityKeys: Array<readonly unknown[]>;
    forDayKey?: readonly unknown[];
}

export interface UseCreateEntryOptions {
    /**
     * TICKET-043: called when the server returns `table_not_authorized` (403).
     * Receives the offending Table ids so the composer can remove them from selection.
     * All optimistic patches are already rolled back when this is called.
     */
    onTableNotAuthorized?: (offendingIds: string[]) => void;
}

export function useCreateEntry(
    userId?: string | null,
    tableId?: string | null,
    options?: UseCreateEntryOptions,
) {
    const qc = useQueryClient();
    const toast = useToast();

    return useMutation({
        mutationFn: (input: CreateEntryInput) => {
            // Generate the nonce here so the same value flows through both the
            // server call (server stores it for dedupe) and the optimistic row.
            const client_nonce = input.client_nonce ?? safeRandomUUID();
            return createEntry({ ...input, client_nonce });
        },

        onMutate: async (input): Promise<MutationContext | undefined> => {
            if (!userId) return undefined;

            const nonce = input.client_nonce ?? safeRandomUUID();
            // Stash the nonce on input so mutationFn uses the same value.
            input.client_nonce = nonce;

            // TICKET-043: determine the effective table ids list for optimistic fan-out.
            const effectiveTableIds = normalizeTableIds(input);
            // Legacy single-table fallback for callers that pass tableId via hook arg.
            if (effectiveTableIds.length === 0 && tableId) effectiveTableIds.push(tableId);

            const viewerLocalDate = localDateStr(new Date());
            const restores: Array<() => void> = [];

            // (TICKET-098: no feed patch here — the friends feed excludes self.)

            // ── 1. tables.activity — fan out per Table (TICKET-043) ───────────
            // One optimistic row per selected Table. Each cache is snapshotted
            // independently so all restores are collected and rolled back atomically.
            const activityKeys: Array<readonly unknown[]> = [];
            for (const tid of effectiveTableIds) {
                const activityKey = queryKeys.tables.activity(tid);
                activityKeys.push(activityKey);
                await qc.cancelQueries({ queryKey: activityKey });
                const { restore: restoreActivity } = snapshotInfinite<ActivityItem>(qc, activityKey);
                restores.push(restoreActivity);
                const optimisticActivityRow = buildOptimisticActivityItem(input, userId, nonce);
                qc.setQueryData<InfiniteData<Page<ActivityItem>>>(activityKey, (prev) =>
                    prependToInfinitePages<ActivityItem>(prev, optimisticActivityRow),
                );
            }

            // ── 2. entries.forDay(userId, localDate) — flat SoloShareActivity[] ─
            // forDay is a flat array (non-paginated), used by day-bucketed calendar view.
            // ONE row regardless of table_ids count (aggregate-feed dedup invariant).
            const forDayKey = queryKeys.entries.forDay(userId, viewerLocalDate);
            await qc.cancelQueries({ queryKey: forDayKey });
            const prevForDay = qc.getQueryData<SoloShareActivity[]>(forDayKey);
            restores.push(() => qc.setQueryData(forDayKey, prevForDay));
            // is_shared marks Table/Round entries so the Journal can badge them.
            const optimisticSoloRow = {
                ...buildOptimisticSoloShare(input, userId, nonce),
                is_shared: effectiveTableIds.length > 0,
            };
            qc.setQueryData<SoloShareActivity[]>(forDayKey, (prev) =>
                prependArray(prev, optimisticSoloRow),
            );

            // ── 3. entries.mySolo(userId) — flat SoloShareActivity[] ─────────
            // The personal Journal shows ALL the viewer's own entries (feed-only +
            // Table-shared + Round) since 20260616000100, so prepend regardless of
            // table context. (Previously gated to feed-only, which hid shared meals
            // from the author's own Journal.)
            const mySoloKey: readonly unknown[] = queryKeys.entries.mySolo(userId);
            await qc.cancelQueries({ queryKey: mySoloKey });
            const prevMySolo = qc.getQueryData<SoloShareActivity[]>(mySoloKey);
            restores.push(() => qc.setQueryData(mySoloKey, prevMySolo));
            qc.setQueryData<SoloShareActivity[]>(mySoloKey, (prev) =>
                prependArray(prev, optimisticSoloRow),
            );

            return {
                restores,
                nonce,
                viewerLocalDate,
                mySoloKey,
                activityKeys,
                forDayKey,
            };
        },

        onError: (err: any, _input, context) => {
            if (!context) return;
            // Always roll back all caches atomically.
            for (const restore of context.restores) {
                restore();
            }
            // TICKET-043: surface table_not_authorized as a non-leaking toast.
            if (err?.code === 'table_not_authorized') {
                toast.show("One of your tables couldn't accept this post — review and try again.");
                options?.onTableNotAuthorized?.(err.offendingIds ?? []);
            }
        },

        onSuccess: (result, _input, context) => {
            // Surface companion tag failures as a non-blocking toast (TICKET-037 P2-13)
            const warnings: Array<{ type: string }> | undefined = (result as any)?.__warnings;
            if (warnings?.some((w) => w.type === 'companion_tag_failed')) {
                toast.show("Couldn't tag some friends.");
            }

            // TICKET-088 loop metrics (fire-and-forget).
            const companionsN = _input.companion_ids?.length ?? 0;
            track('entry_logged', {
                has_note: !!_input.content?.trim(),
                has_photo: !!(_input.photo_urls?.length || _input.photo_url),
                has_rating: _input.rating != null,
                tables_n: _input.table_ids?.length ?? (_input.table_id ? 1 : 0),
                companions_n: companionsN,
                supper: !!_input.supper,
            });
            if (companionsN > 0) track('companion_tagged', { companions_n: companionsN });

            if (!userId || !context) return;
            const { nonce, viewerLocalDate } = context;

            // Build the server-reconciled SoloShareActivity from the result.
            const serverSoloRow: Partial<SoloShareActivity> = {
                id: result?.id,
                restaurant_id: result?.restaurant_id ?? null,
                created_at: result?.created_at,
                sort_date: result?.visited_at ?? result?.created_at,
                visited_at: result?.visited_at ?? result?.created_at,
                rating: result?.rating ?? null,
                content: result?.content ?? null,
            };

            // ── 1. Reconcile tables.activity — per Table (TICKET-043) ─────────
            for (const activityKey of context.activityKeys) {
                qc.setQueryData<InfiniteData<Page<ActivityItem>>>(activityKey as any, (prev) => {
                    if (!prev) return prev;
                    return swapByNonce<ActivityItem>(prev, nonce, {
                        ...((prev.pages[0]?.rows?.find((r) => r.id === `optimistic-${nonce}`) ?? {}) as ActivityItem),
                        ...serverSoloRow,
                    } as ActivityItem) ?? prev;
                });
            }

            // ── 2. Reconcile entries.forDay ───────────────────────────────────
            // Day-bucket migration: server's created_at may have crossed midnight.
            const serverCreatedAt = result?.created_at;
            const serverLocalDate = serverCreatedAt ? localDateStr(new Date(serverCreatedAt)) : viewerLocalDate;

            if (serverLocalDate !== viewerLocalDate) {
                // Row landed in a different bucket — remove from optimistic bucket,
                // prepend to server's bucket with the real row.
                if (context.forDayKey) {
                    qc.setQueryData<SoloShareActivity[]>(context.forDayKey, (prev) =>
                        removeFromArray(prev, (r) => r.id === `optimistic-${nonce}`),
                    );
                }
                const serverForDayKey = queryKeys.entries.forDay(userId, serverLocalDate);
                qc.setQueryData<SoloShareActivity[]>(serverForDayKey, (prev) =>
                    prependArray(prev, { ...(serverSoloRow as SoloShareActivity) }),
                );
            } else if (context.forDayKey) {
                qc.setQueryData<SoloShareActivity[]>(context.forDayKey, (prev) =>
                    swapInArray(
                        prev,
                        (r) => r.id === `optimistic-${nonce}`,
                        (old) => ({ ...old, ...serverSoloRow } as SoloShareActivity),
                    ),
                );
            }

            // ── 3. Reconcile entries.mySolo ───────────────────────────────────
            if (context.mySoloKey) {
                qc.setQueryData<SoloShareActivity[]>(context.mySoloKey, (prev) => {
                    if (!prev) return prev;
                    return swapInArray(
                        prev,
                        (r) => r.id === `optimistic-${nonce}`,
                        (old) => ({
                            ...old,
                            id: result?.id ?? old.id,
                            restaurant_id: result?.restaurant_id ?? old.restaurant_id,
                            created_at: result?.created_at ?? old.created_at,
                            sort_date: result?.visited_at ?? result?.created_at ?? old.sort_date,
                        } as SoloShareActivity),
                    );
                });
            }

            // ── Atlas invalidate — server-derived aggregate the client can't synthesize ─
            // (intentional invalidation — see mutations.md "When invalidation IS appropriate")
            // TICKET-043: fire for table_ids[0] (primary) only — secondary Tables inherit
            // via legacy column until the follow-up drop ticket.
            const effectiveTableIds = normalizeTableIds(_input);
            if (effectiveTableIds.length === 0 && tableId) effectiveTableIds.push(tableId);
            const primaryTableId = effectiveTableIds[0];
            if (primaryTableId) {
                qc.invalidateQueries({ queryKey: queryKeys.atlas.index(primaryTableId) });
            }

            // Profile stats, Spots, and the earned Taste emblem are all
            // server/spot-derived and cannot be patched from this response.
            invalidateEntryTasteCaches(qc, userId, {
                restaurantId: result?.restaurant_id ?? _input.restaurant_id ?? null,
            });
        },
    });
}
