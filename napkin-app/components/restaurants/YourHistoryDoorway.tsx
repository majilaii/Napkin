import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, IconSize, Spacing, Type } from '@/constants/theme';

type Props = {
    restaurantName: string;
    visitCount: number;
    onPress: () => void;
    palette: typeof Colors.light;
    regular?: string | null;
};

export function shouldShowHistoryDoorway(
    visitCount: number,
    persistedRestaurantId: string | null | undefined,
): boolean {
    return visitCount > 0 && !!persistedRestaurantId;
}

export function YourHistoryDoorway({
    restaurantName,
    visitCount,
    onPress,
    palette,
    regular = null,
}: Props) {
    const visitLabel = `${visitCount} visit${visitCount === 1 ? '' : 's'}`;
    return (
        <View style={styles.section}>
            <Text style={[Type.feedSectionKicker, { color: palette.textMuted }]}>
                {`YOU & ${restaurantName.toUpperCase()}`}
            </Text>
            <Pressable
                onPress={onPress}
                accessibilityRole="button"
                accessibilityLabel={`your history, ${visitLabel}`}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
                <Ionicons name="time-outline" size={IconSize.md} color={palette.textSecondary} />
                <Text style={[styles.copy, { color: palette.text }]}>
                    {`you've been here · ${visitLabel}`}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={palette.textFaint} />
            </Pressable>
            {regular ? (
                <>
                    <View style={[styles.divider, { backgroundColor: palette.dividerSoft }]} />
                    <View style={styles.regularRow}>
                        <Ionicons name="ribbon-outline" size={IconSize.md} color={palette.amberBright} />
                        <Text style={[Type.metadata, styles.regularCopy, { color: palette.textMuted }]}>
                            {regular}
                        </Text>
                    </View>
                </>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    section: {
        paddingHorizontal: Spacing.restaurant.pageGutter,
        marginTop: Spacing.restaurant.doorwaySectionGap,
    },
    row: {
        minHeight: Spacing.xxl,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.restaurant.actionGap,
        marginTop: Spacing.xs,
    },
    copy: { flex: 1, ...Type.restaurantDoorway },
    regularRow: {
        minHeight: Spacing.restaurant.quietActionHeight,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.restaurant.actionGap,
    },
    regularCopy: { flex: 1 },
    divider: { height: StyleSheet.hairlineWidth },
    pressed: { opacity: 0.8 },
});
