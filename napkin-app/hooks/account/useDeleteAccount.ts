/**
 * useDeleteAccount (TICKET-090, guideline 5.1.1(v)) — permanently delete the
 * caller's account. The edge fn first freezes the account at a durable
 * tombstone, then drains/inventories/purges it synchronously or through the
 * monitored cleanup worker before deleting the auth user.
 *
 * A 202 pending response means the irreversible freeze was accepted and cleanup
 * will resume durably, so it is also a success: clear private state and sign out
 * immediately in every call site, even if Auth deletion has not run yet.
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
