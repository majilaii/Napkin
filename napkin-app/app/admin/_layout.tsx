/**
 * Admin group layout — gates the /admin/* routes by is_admin.
 * TICKET-033
 *
 * P1-2 ARCH-REVIEW:
 * - Renders null while isAdmin is undefined (loading) to prevent child
 *   components from firing queries before the gate resolves.
 * - Redirects non-admins to the journal tab silently.
 * - The edge function re-checks admin on every action regardless.
 */

import { Slot, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useIsAdmin } from '@/hooks/admin/useIsAdmin';
import { Colors } from '@/constants/theme';

export default function AdminLayout() {
    const { isAdmin, isLoading } = useIsAdmin();
    const router = useRouter();
    const c = Colors.light;

    useEffect(() => {
        // Only redirect once the check resolves. isAdmin=undefined = still loading.
        if (!isLoading && isAdmin === false) {
            router.replace('/(tabs)/journal');
        }
    }, [isAdmin, isLoading, router]);

    // Show nothing while loading — don't flash the child route before auth resolves
    if (isLoading || isAdmin === undefined) {
        return (
            <View style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator color={c.primary} />
            </View>
        );
    }

    // Non-admin: redirect fires in useEffect above; return null in the meantime
    if (!isAdmin) {
        return null;
    }

    return <Slot />;
}
