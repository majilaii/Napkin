/**
 * TopEntriesList — up to 5 highest-rated entries.
 * Each row: restaurant name (Newsreader italic), rating (amber), relative date.
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

function relativeDate(dateString: string): string {
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
            {entries.map((entry, index) => (
                <Pressable
                    key={entry.id}
                    onPress={() =>
                        router.push({
                            pathname: '/entry-detail',
                            params: { entryId: entry.id },
                        })
                    }
                    style={({ pressed }) => [
                        styles.row,
                        {
                            borderBottomColor: palette.divider,
                            borderBottomWidth: index < entries.length - 1 ? StyleSheet.hairlineWidth : 0,
                            opacity: pressed ? 0.75 : 1,
                        },
                    ]}
                >
                    {/* Rank number */}
                    <Text style={[Type.caption, { color: palette.textMuted, width: 20, textAlign: 'center' }]}>
                        {index + 1}
                    </Text>

                    {/* Restaurant name */}
                    <Text
                        style={[
                            Type.headlineItalic,
                            { flex: 1, color: palette.text, fontSize: 16, lineHeight: 22 },
                        ]}
                        numberOfLines={1}
                    >
                        {entry.restaurant_name}
                    </Text>

                    {/* Date */}
                    <Text style={[Type.caption, { color: palette.textMuted, marginRight: Spacing.sm }]}>
                        {relativeDate(entry.visited_at)}
                    </Text>

                    {/* Rating */}
                    <Text style={[Type.rating, { color: palette.tertiary, fontSize: 18 }]}>
                        {entry.rating.toFixed(1)}
                    </Text>
                </Pressable>
            ))}
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
        paddingVertical: Spacing.sm + 2,
        gap: Spacing.sm,
    },
});
