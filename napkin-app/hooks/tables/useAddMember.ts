/**
 * useAddMember — owner-initiated INVITE of a mutual-follow to a Table.
 *
 * TICKET-133 changes the semantics: add_member no longer seats a member. It
 * upserts a PENDING invitation and notifies the invitee, who must accept
 * (useRespondInvitation) before a table_members row exists. This hook therefore
 * no longer patches tables.detail / tables.members — there is no new member yet.
 *
 * Optimistic patch (mutations.md): snapshot + add the target id to the
 * ['tablePendingInvites', tableId] Set so the AddMemberSheet chip flips to
 * "invited" without a refetch; rollback on error (or when the target turned out
 * to already be a member).
 *
 * Server enforces:
 *   - caller must be the Table owner (403 NOT_OWNER)
 *   - both follow directions must exist (403 NOT_MUTUAL_FOLLOW)
 *   - idempotent: existing member → already_member=true; existing pending invite
 *     → already_invited=true (no duplicate row, no duplicate notification).
 *
 * TICKET-037: uses shared unwrapInvokeError semantics; AddMemberError.error_code
 * is still exposed for UI branching.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { pendingInvitesQueryKey } from '@/hooks/tables/usePendingInvitations';

export interface AddMemberInput {
    tableId: string;
    targetUserId: string;
}

export interface AddMemberResult {
    invitation_id?: string;
    already_member: boolean;
    already_invited?: boolean;
    status?: 'pending';
}

export class AddMemberError extends Error {
    constructor(
        message: string,
        public readonly error_code?: 'NOT_OWNER' | 'NOT_MUTUAL_FOLLOW' | string,
        public readonly status?: number,
    ) {
        super(message);
        this.name = 'AddMemberError';
    }
}

async function addMember(input: AddMemberInput): Promise<AddMemberResult> {
    try {
        return await callEdgeFn<AddMemberResult>('table-management', {
            method: 'POST',
            params: { action: 'add_member' },
            body: { table_id: input.tableId, target_user_id: input.targetUserId },
        });
    } catch (err) {
        // Surface typed AddMemberError so the UI can branch on error_code.
        const cause = (err as { cause?: { code?: string; message?: string; status?: number } }).cause;
        const code = cause?.code && cause.code !== 'LEGACY' && cause.code !== 'UNKNOWN'
            ? cause.code
            : undefined;
        const message = cause?.message ?? (err instanceof Error ? err.message : 'Unknown error');
        throw new AddMemberError(message, code, cause?.status);
    }
}

interface MutationContext {
    previous?: Set<string>;
    targetUserId: string;
    tableId: string;
}

export function useAddMember(_userId: string | null | undefined) {
    const queryClient = useQueryClient();

    return useMutation<AddMemberResult, AddMemberError, AddMemberInput, MutationContext | undefined>({
        mutationFn: addMember,

        onMutate: async ({ tableId, targetUserId }) => {
            const key = pendingInvitesQueryKey(tableId);
            await queryClient.cancelQueries({ queryKey: key });

            // Snapshot the pending set for rollback.
            const previous = queryClient.getQueryData<Set<string>>(key);

            // Optimistically mark the target as invited so the chip flips.
            queryClient.setQueryData<Set<string>>(key, (prev) => {
                const next = new Set(prev ?? []);
                next.add(targetUserId);
                return next;
            });

            return { previous, targetUserId, tableId };
        },

        onError: (_err, _vars, ctx) => {
            if (!ctx) return;
            queryClient.setQueryData(pendingInvitesQueryKey(ctx.tableId), ctx.previous);
        },

        onSuccess: (result, { tableId }, ctx) => {
            if (!ctx) return;
            // already_member: the target was NOT invited (they're already seated).
            // Roll back the optimistic add so the chip doesn't lie. Fresh invite
            // and already_invited both mean a live pending invite exists — keep it.
            if (result.already_member) {
                queryClient.setQueryData(pendingInvitesQueryKey(tableId), ctx.previous);
            }
        },
    });
}
