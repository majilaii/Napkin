/**
 * RecentActivityList — up to 10 items merged chronologically.
 * Each row: kind label (ENTRY / ROUND), restaurant name, optional rating, relative date.
 * Tapping routes to /entry-detail (entries) or /table-night-detail (rounds).
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { RecentActivityItem } from '@/hooks/members/useMemberProfile';

interface RecentActivityListProps {
    items: RecentActivityItem[];
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

export function RecentActivityList({ items }: RecentActivityListProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    if (items.length === 0) {
        return (
            <Text
                style={[
                    Type.headlineItalic,
                    { color: palette.textMuted, fontSize: 16, fontStyle: 'italic' },
                ]}
            >
                Nothing here yet
            </Text>
        );
    }

    return (
        <View style={styles.container}>
            {items.map((item, index) => {
                const isEntry = item.kind === 'entry';
                const handlePress = () => {
                    if (isEntry) {
                        router.push({
                            pathname: '/entry-detail',
                            params: { entryId: item.id },
                        });
                    } else {
                        router.push({
                            pathname: '/table-night-detail',
                            params: { nightId: item.id },
                        });
                    }
                };

                return (
                    <Pressable
                        key={`${item.kind}-${item.id}`}
                        onPress={handlePress}
                        style={({ pressed }) => [
                            styles.row,
                            {
                                borderBottomColor: palette.divider,
                                borderBottomWidth:
                                    index < items.length - 1 ? StyleSheet.hairlineWidth : 0,
                                opacity: pressed ? 0.75 : 1,
                            },
                        ]}
                    >
                        {/* Kind label chip */}
                        <View
                            style={[
                                styles.kindChip,
                                {
                                    backgroundColor: isEntry
                                        ? palette.secondaryContainer
                                        : palette.primaryMuted,
                                },
                            ]}
                        >
                            <Text
                                style={[
                                    Type.labelSmall,
                                    {
                                        color: isEntry ? palette.secondary : palette.primary,
                                        fontSize: 8,
                                    },
                                ]}
                            >
                                {isEntry ? 'ENTRY' : 'ROUND'}
                            </Text>
                        </View>

                        {/* Restaurant name */}
                        <Text
                            style={[
                                Type.headlineItalic,
                                { flex: 1, color: palette.text, fontSize: 15, lineHeight: 20 },
                            ]}
                            numberOfLines={1}
                        >
                            {item.restaurant_name}
                        </Text>

                        {/* Date */}
                        <Text
                            style={[Type.caption, { color: palette.textMuted, marginRight: Spacing.sm }]}
                        >
                            {relativeDate(item.date)}
                        </Text>

                        {/* Rating (if present) */}
                        {item.rating != null ? (
                            <Text style={[Type.rating, { color: palette.tertiary, fontSize: 16 }]}>
                                {item.rating.toFixed(1)}
                            </Text>
                        ) : (
                            <Text style={[Type.caption, { color: palette.textMuted, width: 28 }]}>
                                —
                            </Text>
                        )}
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
        paddingVertical: Spacing.sm + 2,
        gap: Spacing.sm,
    },
    kindChip: {
        paddingHorizontal: 6,
        paddingVertical: 3,
        borderRadius: Radius.sm,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
