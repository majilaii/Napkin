/**
 * TopEntriesList — up to 5 highest-rated entries.
 * Each row: rank, upright restaurant name, relative date, and rating accent.
 * Tapping navigates to /entry-detail.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { TopEntry } from '@/hooks/members/useMemberProfile';

interface TopEntriesListProps {
    entries: TopEntry[];
}

function relativeDate(dateString: string | null): string {
    if (!dateString) return 'no date';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const diffMs = Date.now() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
    return `${Math.floor(diffDays / 365)}y ago`;
}

export function TopEntriesList({ entries }: TopEntriesListProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    if (entries.length === 0) return null;

    return (
        <View style={styles.container}>
            {entries.map((entry, index) => {
                const dateLabel = relativeDate(entry.visited_at);
                return (
                    <Pressable
                        key={entry.id}
                        onPress={() =>
                            router.push({
                                pathname: '/entry-detail',
                                params: { entryId: entry.id },
                            })
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`${index + 1}. ${entry.restaurant_name}, rated ${entry.rating.toFixed(1)}, ${dateLabel}`}
                        style={({ pressed }) => [
                            styles.row,
                            {
                                borderBottomColor: palette.divider,
                                borderBottomWidth:
                                    index < entries.length - 1
                                        ? StyleSheet.hairlineWidth
                                        : 0,
                                opacity: pressed ? 0.75 : 1,
                            },
                        ]}
                    >
                        {/* Rank number */}
                        <Text
                            style={[Type.metadata, { color: palette.textMuted, width: 24, textAlign: 'center' }]}
                            maxFontSizeMultiplier={1.6}
                        >
                            {index + 1}
                        </Text>

                        <View style={styles.details}>
                            {/* Restaurant name */}
                            <Text
                                style={[Type.editorialBody, { color: palette.text }]}
                                numberOfLines={2}
                                maxFontSizeMultiplier={1.8}
                            >
                                {entry.restaurant_name}
                            </Text>

                            {/* Date */}
                            <Text
                                style={[Type.metadata, { color: palette.textMuted }]}
                                maxFontSizeMultiplier={1.6}
                            >
                                {dateLabel}
                            </Text>
                        </View>

                        {/* Rating */}
                        <Text
                            style={[Type.rating, { color: palette.tertiary }]}
                            maxFontSizeMultiplier={1.4}
                        >
                            {entry.rating.toFixed(1)}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        gap: 0,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 56,
        paddingVertical: Spacing.sm,
        gap: Spacing.sm,
    },
    details: {
        flex: 1,
        gap: 2,
    },
});
