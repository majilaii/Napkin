/**
 * FirstFlipBody — the two-list "what becomes visible / what stays private" body.
 * Reusable component for the make-public screen.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const PUBLIC_ITEMS = [
    'Your display name, username, avatar, and bio',
    'Your public lists',
    'Restaurants you\'ve logged (as tiles — not your notes)',
    'Your rating count, restaurant count, and average rating',
];

const PRIVATE_ITEMS = [
    'Your Tables and everything in them',
    'Your Rounds',
    'Your wishlist',
    'Your private lists',
    'The notes inside your logs (until a specific review is opted public — a future setting)',
];

export function FirstFlipBody() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View style={styles.container}>
            {/* Public section */}
            <Text style={[Type.titleSmall, { color: palette.text, marginBottom: Spacing.sm }]}>
                What becomes visible to anyone with the link:
            </Text>
            {PUBLIC_ITEMS.map((item) => (
                <View key={item} style={styles.item}>
                    <Ionicons name="eye-outline" size={14} color={palette.primary} style={styles.icon} />
                    <Text style={[Type.body, { color: palette.textSecondary, flex: 1 }]}>
                        {item}
                    </Text>
                </View>
            ))}

            <View style={styles.divider} />

            {/* Private section */}
            <Text style={[Type.titleSmall, { color: palette.text, marginBottom: Spacing.sm }]}>
                What stays private — always:
            </Text>
            {PRIVATE_ITEMS.map((item) => (
                <View key={item} style={styles.item}>
                    <Ionicons name="lock-closed-outline" size={14} color={palette.success} style={styles.icon} />
                    <Text style={[Type.body, { color: palette.textSecondary, flex: 1 }]}>
                        {item}
                    </Text>
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        gap: Spacing.xs,
    },
    item: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: Spacing.sm,
        marginBottom: Spacing.sm,
    },
    icon: {
        marginTop: 3,
    },
    divider: {
        height: Spacing.md,
    },
});
