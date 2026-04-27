/**
 * useIsAdmin — checks whether the current user is an operator admin.
 * TICKET-033
 *
 * Calls critics-admin?action=is_admin. The edge function returns 200 if
 * the JWT user is in admin_users, or 403 if not. We trap the 403 and
 * return isAdmin=false rather than throwing (graceful degrade).
 *
 * Cached with staleTime: Infinity — admin status doesn't change at runtime.
 * Used to gate the /admin/critics route (P1-2 ARCH-REVIEW).
 *
 * Returns:
 *   isAdmin: boolean | undefined   — undefined while loading
 *   isLoading: boolean
 */

import { useQuery } from '@tanstack/react-query';
import { callEdgeFn, type UnwrappedError } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/providers/AuthProvider';

interface IsAdminResult {
    is_admin: boolean;
}

async function fetchIsAdmin(): Promise<IsAdminResult> {
    try {
        return await callEdgeFn<IsAdminResult>('critics-admin', {
            action: 'is_admin',
            body: {},
        });
    } catch (err) {
        // 403 = not admin; treat as a clean false result rather than an error
        const cause = (err as Error & { cause?: UnwrappedError })?.cause;
        if (cause?.status === 403 || cause?.code === 'FORBIDDEN') {
            return { is_admin: false };
        }
        throw err;
    }
}

export function useIsAdmin() {
    const { user } = useAuth();

    const query = useQuery({
        queryKey: queryKeys.admin.isAdmin(user?.id ?? ''),
        queryFn: fetchIsAdmin,
        enabled: !!user?.id,
        // Admin status is stable at runtime — never needs a background refetch.
        staleTime: Infinity,
        retry: false,
    });

    return {
        isAdmin: query.data?.is_admin,
        isLoading: query.isLoading,
    };
}
