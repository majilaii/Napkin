import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, IconSize, Spacing, Type } from '@/constants/theme';
import type { RegularDetail } from '@/hooks/restaurants/useRestaurantPage';
import { Avatar } from '@/components/feed/Avatar';
import { SectionHeading } from './RestaurantPageV3';

type Props = {
    detail: RegularDetail | null | undefined;
    /** Opens the regular's profile. Omitted (or the viewer's own crown) leaves the row inert. */
    onPress?: (userId: string) => void;
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

/** The second line under the name: the count, then how close the chase is. */
export function regularStandingCopy(detail: RegularDetail): string {
    const visits = `${detail.visits} visit${detail.visits === 1 ? '' : 's'}`;
    if (!detail.runner_up) return visits;
    const gap = detail.runner_up.gap === 0
        ? `tied with ${detail.runner_up.display_name}`
        : `${detail.runner_up.display_name} is ${detail.runner_up.gap} behind`;
    return `${visits} · ${gap}`;
}

/**
 * THE REGULAR: the friend (or you) with the most visits here, all time. The
 * cohort is friends-only on the server; strangers never hold or see a crown.
 */
export function RestaurantRegularRow({ detail, onPress, palette }: Props) {
    if (!detail) return null;
    const name = detail.is_viewer ? 'you' : detail.display_name;
    const canOpen = !!onPress && !detail.is_viewer;
    const row = (
        <View style={styles.row}>
            <Avatar
                name={detail.display_name}
                url={detail.avatar_url}
                size={Spacing.restaurant.regularAvatar}
                palette={palette}
            />
            <View style={styles.body}>
                <View style={styles.nameLine}>
                    <Ionicons name="ribbon-outline" size={IconSize.sm} color={palette.amberBright} />
                    <Text style={[Type.feedNoteRestaurant, styles.name, { color: palette.text }]} numberOfLines={1}>
                        {name}
                    </Text>
                </View>
                <Text style={[Type.metadata, styles.standing, { color: palette.textMuted }]} numberOfLines={1}>
                    {regularStandingCopy(detail)}
                </Text>
            </View>
            {canOpen ? (
                <Ionicons name="chevron-forward" size={IconSize.md} color={palette.textFaint} />
            ) : null}
        </View>
    );
    return (
        <View style={styles.section}>
            <SectionHeading label="THE REGULAR" palette={palette} />
            {canOpen ? (
                <Pressable
                    onPress={() => onPress(detail.user_id)}
                    accessibilityRole="button"
                    accessibilityLabel={regularDetailCopy(detail)}
                    style={({ pressed }) => pressed && styles.pressed}
                >
                    {row}
                </Pressable>
            ) : (
                <View accessible accessibilityRole="text" accessibilityLabel={regularDetailCopy(detail)}>
                    {row}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    section: {
        paddingHorizontal: Spacing.restaurant.pageGutter,
        marginTop: Spacing.restaurant.sectionGap,
    },
    row: {
        minHeight: Spacing.restaurant.quietActionHeight,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.restaurant.actionGap,
    },
    body: { flex: 1, gap: Spacing.xs },
    nameLine: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xs,
    },
    name: { flexShrink: 1 },
    standing: { fontVariant: ['tabular-nums'] },
    pressed: { opacity: 0.8 },
});
