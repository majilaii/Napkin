/**
 * useDeleteAccount (TICKET-090, guideline 5.1.1(v)) — permanently delete the
 * caller's account. The edge fn transfers/deletes owned tables, wipes storage,
 * then deletes the auth user (FK cascades clean up the rest).
 *
 * On success the local session is dead server-side; the caller must signOut()
 * to tear down client state — done here so every call site behaves the same.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { supabase } from '@/lib/supabase';

export function useDeleteAccount() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async () => {
            await callEdgeFn('account', { action: 'delete', body: {} });
        },
        onSuccess: async () => {
            queryClient.clear();
            // Server-side session is already gone; ignore local sign-out noise.
            await supabase.auth.signOut().catch(() => null);
        },
    });
}
