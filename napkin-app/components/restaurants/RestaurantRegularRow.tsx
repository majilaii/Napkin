import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, IconSize, Spacing, Type } from '@/constants/theme';
import type { RegularDetail } from '@/hooks/restaurants/useRestaurantPage';

type Props = {
    detail: RegularDetail | null | undefined;
    palette: typeof Colors.light;
};

export function regularDetailCopy(detail: RegularDetail): string {
    const lead = detail.is_viewer
        ? "you're the regular here"
        : `${detail.display_name} is the regular here`;
    return detail.runner_up
        ? `${lead} · ${detail.runner_up.display_name} is ${detail.runner_up.gap} behind`
        : lead;
}

export function RestaurantRegularRow({ detail, palette }: Props) {
    if (!detail) return null;
    return (
        <View
            style={styles.row}
            accessibilityRole="text"
            accessibilityLabel={regularDetailCopy(detail)}
        >
            <Ionicons name="ribbon-outline" size={IconSize.md} color={palette.amberBright} />
            <Text style={[Type.metadata, styles.copy, { color: palette.textMuted }]}>
                {regularDetailCopy(detail)}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        minHeight: Spacing.restaurant.quietActionHeight,
        paddingHorizontal: Spacing.restaurant.pageGutter,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.restaurant.actionGap,
    },
    copy: {
        flex: 1,
        fontVariant: ['tabular-nums'],
    },
});
