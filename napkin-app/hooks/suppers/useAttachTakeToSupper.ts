/**
 * useAttachTakeToSupper — confirm a stray-log stitch (TICKET-159).
 *
 * The entry create response may carry a `supper_suggestion` ("you logged the
 * same spot the night your table gathered — add this as your take?"). When the
 * author CONFIRMS, this binds their existing entry to the supper via the
 * `entry` fn's `attach-take` action → fn_attach_take_to_supper, which
 * revalidates everything server-side under lock (owner, membership,
 * unattached, same restaurant, no existing take). Never called without an
 * explicit confirm — the server never attaches on its own.
 *
 * Canonical mutation lifecycle (lib/mutations.md):
 *   onMutate  → cancel + snapshot suppers.detail(supper_id). No optimistic
 *               patch: the input carries only ids, so there is nothing
 *               faithful to synthesize before the server row returns.
 *   onError   → restore the snapshot.
 *   onSuccess → patch the author's take into SupperDetail.takes from the
 *               REAL server entry row (display fields come from the cached
 *               roster — the author is a member), patch the entry-detail
 *               cache's supper_id, then narrow-invalidate suppers.detail:
 *               server-sorted entry_photos are a join the patch can't
 *               synthesise (the "first-page joins" invalidation exception).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { SupperDetail, SupperTake } from './useSupper';

/** The suggest-only candidate riding the entry create response (inside data). */
export interface SupperSuggestion {
    supper_id: string;
    restaurant_name: string | null;
    /** Seats at the supper (roster size) — the "«n» gathered" numeral. */
    gathered_count: number;
    /** 'YYYY-MM-DD' — the supper's night (gather_on for gather-born, HKT). */
    night: string;
}

export interface AttachTakeInput {
    entry_id: string;
    supper_id: string;
}

/** The server returns the updated entries row. */
interface AttachedEntryRow {
    id: string;
    user_id: string;
    restaurant_id: string | null;
    supper_id: string;
    rating: number | null;
    content: string | null;
    dish_description: string | null;
    visited_at: string | null;
    created_at: string;
    vibe_rating: number | null;
    flavor_rating: number | null;
    service_rating: number | null;
    value_rating: number | null;
    liked: boolean | null;
    photo_url: string | null;
}

/** True when the server said this take already exists / entry already bound —
 *  the sheet surfaces it as a friendly "already added", not an error. */
export function isAttachConflict(error: unknown): boolean {
    const code =
        (error as { cause?: { code?: string } } | null)?.cause?.code ??
        (error as { code?: string } | null)?.code;
    return code === 'ATTACH_CONFLICT';
}

interface MutationContext {
    previous?: SupperDetail;
}

export function useAttachTakeToSupper() {
    const qc = useQueryClient();

    return useMutation<AttachedEntryRow, Error, AttachTakeInput, MutationContext>({
        mutationFn: async (input) =>
            callEdgeFn<AttachedEntryRow>('entry', {
                action: 'attach-take',
                body: { entry_id: input.entry_id, supper_id: input.supper_id },
            }),

        onMutate: async (input): Promise<MutationContext> => {
            const key = queryKeys.suppers.detail(input.supper_id);
            await qc.cancelQueries({ queryKey: key });
            const previous = qc.getQueryData<SupperDetail>(key);
            return { previous };
        },

        onError: (_err, input, ctx) => {
            if (ctx?.previous !== undefined) {
                qc.setQueryData(queryKeys.suppers.detail(input.supper_id), ctx.previous);
            }
        },

        onSuccess: (row, input) => {
            // Patch the supper detail (if cached): the entry becomes the author's
            // take. Display name/avatar come from the roster — the author is a
            // supper member by validation. Preserve every other field (lineage
            // included) via spread.
            qc.setQueryData<SupperDetail>(queryKeys.suppers.detail(input.supper_id), (old) => {
                if (!old) return old;
                const roster = old.roster.find((r) => r.user_id === row.user_id);
                const take: SupperTake = {
                    entry_id: row.id,
                    user_id: row.user_id,
                    restaurant_id: row.restaurant_id,
                    supper_id: input.supper_id,
                    rating: row.rating,
                    content: row.content,
                    dish_description: row.dish_description,
                    visited_at: row.visited_at,
                    created_at: row.created_at,
                    vibe_rating: row.vibe_rating,
                    flavor_rating: row.flavor_rating,
                    service_rating: row.service_rating,
                    value_rating: row.value_rating,
                    liked: row.liked,
                    photo_url: row.photo_url,
                    photos: row.photo_url ? [row.photo_url] : [],
                    display_name: roster?.display_name ?? null,
                    avatar_url: roster?.avatar_url ?? null,
                };
                const existingIdx = old.takes.findIndex((t) => t.user_id === row.user_id);
                const takes =
                    existingIdx >= 0
                        ? old.takes.map((t, i) => (i === existingIdx ? take : t))
                        : [...old.takes, take];
                return { ...old, takes };
            });

            // The entry itself gained its supper binding — patch the detail cache.
            qc.setQueryData(queryKeys.entries.detail(input.entry_id), (old: unknown) =>
                old ? { ...(old as Record<string, unknown>), supper_id: input.supper_id } : old,
            );

            // invalidate (narrow): server-sorted entry_photos + joined display data
            // are first-page joins the patch can't synthesise (mutations.md §6).
            qc.invalidateQueries({ queryKey: queryKeys.suppers.detail(input.supper_id) });
        },
    });
}
