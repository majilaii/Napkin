/**
 * TablePreviewCard — preview card for a shared (or own) Table.
 *
 * Shows: Table name, target's avg at this Table, visit count,
 * most-recent entry (restaurant name + rating + relative date).
 * Taps to /member/[targetUserId]?tableId=X.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Radius, Type, Shadow } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { TablePreview } from '@/hooks/users/useUserProfile';

interface Props {
    preview: TablePreview;
    targetUserId: string;
    isSelf: boolean;
}

function relativeDate(isoString: string | null): string {
    if (!isoString) return '';
    const now = Date.now();
    const then = new Date(isoString).getTime();
    const diff = now - then;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
}

export function TablePreviewCard({ preview, targetUserId, isSelf }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    const handlePress = () => {
        router.push({
            pathname: '/member/[userId]',
            params: { userId: targetUserId, tableId: preview.table_id },
        });
    };
    const averageLabel = preview.avg != null
        ? `${isSelf ? 'your average' : 'average'} ${preview.avg.toFixed(1)}`
        : 'no average yet';
    const visitsLabel = `${preview.visit_count} ${preview.visit_count === 1 ? 'visit' : 'visits'}`;
    const latestLabel = preview.last_entry_restaurant_name
        ? `Last entry: ${preview.last_entry_restaurant_name}${preview.last_entry_rating != null ? `, rated ${preview.last_entry_rating.toFixed(1)}` : ''}${preview.last_entry_at ? `, ${relativeDate(preview.last_entry_at)}` : ''}`
        : 'No recent entry';

    return (
        <Pressable
            onPress={handlePress}
            accessibilityRole="button"
            accessibilityLabel={`${preview.table_name}. ${averageLabel}. ${visitsLabel}. ${latestLabel}. Open full activity.`}
            style={({ pressed }) => [
                styles.card,
                Shadow.subtle,
                {
                    backgroundColor: pressed ? palette.surfaceContainerHigh : palette.card,
                },
            ]}
        >
            {/* Table name + chevron */}
            <View style={styles.header}>
                <Text
                    style={[
                        Type.editorialTitle,
                        { color: palette.text, flex: 1 },
                    ]}
                >
                    {preview.table_name}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
            </View>

            {/* Stats row: avg + visit count */}
            <View style={styles.statsRow}>
                <View style={styles.statItem}>
                    <Text style={[Type.rating, { color: palette.tertiary }]}>
                        {preview.avg != null ? preview.avg.toFixed(1) : '—'}
                    </Text>
                    <Text style={[Type.metadata, { color: palette.textMuted }]}>
                        {isSelf ? 'Your avg' : 'Avg'}
                    </Text>
                </View>
                <View style={styles.statItem}>
                    <Text style={[Type.editorialTitle, { color: palette.text }]}>
                        {preview.visit_count}
                    </Text>
                    <Text style={[Type.metadata, { color: palette.textMuted }]}>
                        {preview.visit_count === 1 ? 'Visit' : 'Visits'}
                    </Text>
                </View>
            </View>

            {/* Most recent entry */}
            {preview.last_entry_restaurant_name && (
                <View style={styles.lastEntry}>
                    <Text style={[Type.bodySmall, { color: palette.textSecondary }]}>
                        Last: {preview.last_entry_restaurant_name}
                        {preview.last_entry_rating != null && ` · ${preview.last_entry_rating.toFixed(1)}`}
                        {preview.last_entry_at && ` · ${relativeDate(preview.last_entry_at)}`}
                    </Text>
                </View>
            )}

            {/* Drill-down hint */}
            <Text style={[Type.metadata, styles.hint, { color: palette.textMuted }]}>
                Tap for full activity
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: {
        borderRadius: Radius.lg,
        padding: Spacing.md,
        gap: Spacing.sm,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xs,
    },
    statsRow: {
        flexDirection: 'row',
        gap: Spacing.lg,
    },
    statItem: {
        alignItems: 'center',
    },
    lastEntry: {
        marginTop: Spacing.xs,
    },
    hint: {
        marginTop: Spacing.xs,
    },
});
