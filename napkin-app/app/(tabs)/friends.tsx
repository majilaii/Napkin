/**
 * Friends tab — placeholder.
 * Will become the member directory across your Tables.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function FriendsScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();

    return (
        <View style={{ flex: 1, backgroundColor: palette.background, paddingTop: insets.top + Spacing.xxl, paddingHorizontal: Spacing.lg }}>
            <Text style={[Type.displaySmall, { color: palette.text }]}>Friends</Text>
            <Text style={[Type.body, { color: palette.textSecondary, marginTop: Spacing.sm }]}>
                The people sitting at your Tables.
            </Text>
        </View>
    );
}
