/**
 * Profile tab — "You".
 * Thin wrapper around ProfileScreenBody for the signed-in viewer.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { ProfileScreenBody } from '@/components/profile';

export default function ProfileTab() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const { user } = useAuth();

    return (
        <View
            style={[
                styles.container,
                { backgroundColor: palette.background, paddingTop: insets.top },
            ]}
        >
            <ProfileScreenBody identifier={user?.id} inTab />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
});
