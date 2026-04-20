/**
 * Profile tab — thin wrapper that mounts ProfileScreenBody.
 * TICKET-025: Replaced hand-rolled scroll with ProfileScreenBody.
 * The shared body kills drift between this tab and /u/[identifier].
 */
import React from 'react';
import {
    View,
    StyleSheet,
    Text,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { ProfileScreenBody } from '@/components/profile';

export default function ProfileTab() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const { user } = useAuth();

    return (
        <View style={[styles.container, { backgroundColor: palette.background }]}>
            {/* Top bar — tab identity only. The gear lives inside ProfileHeader per the canvas. */}
            <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
                <Text style={[Type.headlineMedium, { color: palette.text }]}>You</Text>
            </View>

            <ProfileScreenBody identifier={user?.id} inTab />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    topBar: {
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.sm,
    },
});
