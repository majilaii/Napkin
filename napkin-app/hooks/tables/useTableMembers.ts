/**
 * Hook to manage table members
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

interface InviteMemberInput {
    tableId: string;
    inviteUserId: string;
    role?: 'admin' | 'member';
}

interface RemoveMemberInput {
    tableId: string;
    userId: string;
}

interface ChangeRoleInput {
    tableId: string;
    userId: string;
    role: 'admin' | 'member';
}

export function useInviteMember() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ tableId, inviteUserId, role = 'member' }: InviteMemberInput) => {
            const { data, error } = await supabase.functions.invoke('table-members/invite', {
                body: { table_id: tableId, invite_user_id: inviteUserId, role },
            });
            if (error) throw error;
            if (data?.error) throw new Error(data.error);
            return data?.data;
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({
                queryKey: queryKeys.tables.detail(variables.tableId),
            });
        },
    });
}

export function useRemoveMember() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ tableId, userId }: RemoveMemberInput) => {
            const { data, error } = await supabase.functions.invoke(`table-members/${userId}?table_id=${tableId}`, {
                method: 'DELETE',
            });
            if (error) throw error;
            return data;
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({
                queryKey: queryKeys.tables.detail(variables.tableId),
            });
        },
    });
}

export function useChangeRole() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ tableId, userId, role }: ChangeRoleInput) => {
            const { data, error } = await supabase.functions.invoke(`table-members/${userId}/role`, {
                body: { table_id: tableId, role },
            });
            if (error) throw error;
            if (data?.error) throw new Error(data.error);
            return data?.data;
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({
                queryKey: queryKeys.tables.detail(variables.tableId),
            });
        },
    });
}
