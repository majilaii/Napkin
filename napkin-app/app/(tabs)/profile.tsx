/**
 * Profile tab — TICKET-092 revamp.
 *
 * The TICKET-070 body (header + Top 4 + the WHOLE journal auto-expanded) is
 * gone. Own profile now shares ProfileScreenBody with /u/[identifier]:
 * identity + stats strip + Top 4 + taste band + dining map + rating histogram +
 * the index (Journal · Spots · Reviews · Lists · Wishlist). The journal lives
 * behind its index row — one tap, not a dump.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { ProfileScreenBody } from '@/components/profile/ProfileScreenBody';

export default function ProfileTab() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const { user } = useAuth();

    return (
        <View style={[styles.root, { backgroundColor: palette.background, paddingTop: insets.top }]}>
            <ProfileScreenBody identifier={user?.id} inTab />
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
});
