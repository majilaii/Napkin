/**
 * Profile tab stub — immediately replaces itself with the merged profile screen.
 * Using router.replace keeps a single URL identity (/u/[userId]) whether the
 * user arrives via the Profile tab or by tapping an avatar from the feed.
 */
import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';

export default function ProfileTab() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const { user } = useAuth();

    useEffect(() => {
        if (user?.id) {
            router.replace(`/u/${user.id}`);
        }
    }, [user?.id]);

    return (
        <View style={{ flex: 1, backgroundColor: palette.background, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator color={palette.primary} />
        </View>
    );
}
