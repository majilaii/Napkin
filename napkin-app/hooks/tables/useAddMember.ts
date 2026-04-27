/**
 * useAddMember — add a mutual-follow to a Table (owner only, TICKET-029).
 *
 * Server enforces:
 *   - caller must be the Table owner (403 NOT_OWNER)
 *   - both follow directions must exist (403 NOT_MUTUAL_FOLLOW)
 *   - idempotent: adding an existing member returns already_member=true (no error)
 *
 * TICKET-042: replaced blast invalidateQueries with optimistic prepend.
 *
 * Strategy:
 *   - Snapshot tables.detail(tableId).members[] and tables.members(tableId)[].
 *   - Prepend an optimistic stub to both caches.
 *   - Attempt to read profile data from users.profile(targetUserId) if cached
 *     (likely: add-member flows from a profile/search context). Fall back to
 *     a sparse stub (blank display_name) if not present.
 *   - onSuccess: if already_member → rollback (stub shouldn't be there).
 *                else → replace stub with server-confirmed member_id.
 *   - onError: rollback both caches.
 *   - tables.list(userId) invalidate: DROPPED — member-count badges on the
 *     Tables tab are driven by useTableMembers (tables.members key), not
 *     tables.list. The list query carries no per-table member-count field.
 *     Audited against app/(tabs)/tables.tsx on 2026-04-27 (TICKET-042).
 *
 * On error: typed error_code is surfaced so the UI can render specific copy.
 *
 * TICKET-037: uses shared unwrapInvokeError helper instead of local unwrap.
 * AddMemberError.error_code still exposed for UI branching.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { snapshot } from '@/lib/optimistic';
import type { TableDetail, TableMember as DetailMember } from '@/hooks/tables/useTableDetail';
import type { TableMember as MembersMember } from '@/hooks/tables/useTableMembers';
import type { UserProfileResult } from '@/hooks/users/useUserProfile';

export interface AddMemberInput {
    tableId: string;
    targetUserId: string;
}

export interface AddMemberResult {
    member_id: string;
    already_member: boolean;
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

const OPTIMISTIC_MEMBER_PREFIX = 'optimistic-member-';

interface MutationContext {
    restoreDetail: () => void;
    restoreMembers: () => void;
    targetUserId: string;
    tableId: string;
}

export function useAddMember(_userId: string | null | undefined) {
    const queryClient = useQueryClient();

    return useMutation<AddMemberResult, AddMemberError, AddMemberInput, MutationContext | undefined>({
        mutationFn: addMember,

        onMutate: async ({ tableId, targetUserId }) => {
            const detailKey = queryKeys.tables.detail(tableId);
            const membersKey = queryKeys.tables.members(tableId);

            // Cancel in-flight queries for both caches.
            await queryClient.cancelQueries({ queryKey: detailKey });
            await queryClient.cancelQueries({ queryKey: membersKey });

            // Snapshot both for rollback.
            const { restore: restoreDetail } = snapshot<TableDetail>(queryClient, detailKey);
            const { restore: restoreMembers } = snapshot<MembersMember[]>(queryClient, membersKey);

            // Try to read display info from users.profile(targetUserId) if cached.
            // This is likely populated since add-member typically flows from a
            // profile/search context. Falls back to sparse stub if not present.
            const cachedProfile = queryClient.getQueryData<UserProfileResult>(
                queryKeys.users.profile(targetUserId),
            );
            const displayName = cachedProfile?.data?.profile?.display_name ?? '';
            const avatarUrl = cachedProfile?.data?.profile?.avatar_url ?? null;

            const now = new Date().toISOString();

            // Stub for tables.detail(tableId).members[] — uses user_id (DetailMember shape)
            const detailStub: DetailMember = {
                user_id: targetUserId,
                role: 'member',
                joined_at: now,
                profiles: { display_name: displayName, avatar_url: avatarUrl },
            };

            // Stub for tables.members(tableId)[] — uses member_id (MembersMember shape)
            const membersStub: MembersMember = {
                member_id: `${OPTIMISTIC_MEMBER_PREFIX}${targetUserId}`,
                role: 'member',
                joined_at: now,
                profiles: { display_name: displayName, avatar_url: avatarUrl },
            };

            // Patch tables.detail: prepend to members array.
            queryClient.setQueryData<TableDetail>(detailKey, (prev) => {
                if (!prev) return prev;
                return { ...prev, members: [detailStub, ...(prev.members ?? [])] };
            });

            // Patch tables.members: prepend stub.
            queryClient.setQueryData<MembersMember[]>(membersKey, (prev) =>
                prev ? [membersStub, ...prev] : [membersStub],
            );

            return { restoreDetail, restoreMembers, targetUserId, tableId };
        },

        onError: (_err, _vars, ctx) => {
            if (!ctx) return;
            ctx.restoreDetail();
            ctx.restoreMembers();
        },

        onSuccess: (result, { tableId, targetUserId }, ctx) => {
            if (!ctx) return;

            if (result.already_member) {
                // Idempotent add — the member was already there. Roll back the
                // optimistic prepend so we don't show a duplicate.
                ctx.restoreDetail();
                ctx.restoreMembers();
                return;
            }

            // Reconcile: replace stub member_id with server-assigned member_id.
            const detailKey = queryKeys.tables.detail(tableId);
            const membersKey = queryKeys.tables.members(tableId);

            // tables.detail.members[] — matched by user_id
            queryClient.setQueryData<TableDetail>(detailKey, (prev) => {
                if (!prev) return prev;
                const members = prev.members.map((m) =>
                    m.user_id === targetUserId
                        ? { ...m } // stub is already correct; no extra field to add
                        : m,
                );
                return { ...prev, members };
            });

            // tables.members[] — swap the optimistic member_id for server-assigned one
            queryClient.setQueryData<MembersMember[]>(membersKey, (prev) => {
                if (!prev) return prev;
                return prev.map((m) =>
                    m.member_id === `${OPTIMISTIC_MEMBER_PREFIX}${targetUserId}`
                        ? { ...m, member_id: result.member_id }
                        : m,
                );
            });

            // Note: tables.list(userId) invalidate DROPPED. Audited 2026-04-27:
            // member-count badges on the Tables tab read from useTableMembers
            // (tables.members key), not from tables.list. No badge depends on
            // the list query. tables.detail + tables.members are already patched
            // above.
        },
    });
}
