/**
 * ListCard — row in the Lists tab.
 * Shows: cover thumbnail (if any), title, entry count badge, ranked/unranked badge,
 * lock icon for private lists, last-updated date.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { MyList } from '@/hooks/lists/useMyLists';

type Palette = typeof Colors.light;

interface Props {
    list: MyList;
    onPress: () => void;
}

function formatRelativeDate(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function ListCard({ list, onPress }: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.card,
                {
                    backgroundColor: palette.card,
                    opacity: pressed ? 0.85 : 1,
                },
                Shadow.subtle,
            ]}
        >
            {/* Cover thumbnail */}
            {list.cover_photo_url ? (
                <View style={styles.thumb}>
                    <ExpoImage
                        source={{ uri: list.cover_photo_url }}
                        style={styles.thumbImage}
                        contentFit="cover"
                    />
                </View>
            ) : (
                <View style={[styles.thumb, styles.thumbFallback, { backgroundColor: palette.surfaceContainerHigh }]}>
                    <Ionicons name="list-outline" size={20} color={palette.textMuted} />
                </View>
            )}

            {/* Content */}
            <View style={styles.content}>
                <View style={styles.titleRow}>
                    <Text
                        style={[Type.titleMedium, { color: palette.text, flex: 1 }]}
                        numberOfLines={1}
                    >
                        {list.title}
                    </Text>
                    {list.privacy === 'private' && (
                        <Ionicons
                            name="lock-closed"
                            size={13}
                            color={palette.textMuted}
                            style={{ marginLeft: Spacing.xs }}
                        />
                    )}
                </View>

                <View style={styles.badges}>
                    <View style={[styles.badge, { backgroundColor: palette.surfaceContainerLow }]}>
                        <Text style={[Type.caption, { color: palette.textSecondary }]}>
                            {list.entry_count} {list.entry_count === 1 ? 'place' : 'places'}
                        </Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: palette.surfaceContainerLow }]}>
                        <Text style={[Type.caption, { color: palette.textSecondary }]}>
                            {list.ranked ? 'Ranked' : 'Unranked'}
                        </Text>
                    </View>
                    <Text style={[Type.caption, { color: palette.textMuted }]}>
                        {formatRelativeDate(list.updated_at)}
                    </Text>
                </View>
            </View>

            <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: Radius.md,
        padding: Spacing.md,
        gap: Spacing.md,
    },
    thumb: {
        width: 52,
        height: 52,
        borderRadius: Radius.sm,
        overflow: 'hidden',
        flexShrink: 0,
    },
    thumbImage: {
        width: '100%',
        height: '100%',
    },
    thumbFallback: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    content: {
        flex: 1,
        gap: Spacing.xs,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    badges: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xs,
        flexWrap: 'wrap',
    },
    badge: {
        borderRadius: Radius.sm,
        paddingHorizontal: 6,
        paddingVertical: 2,
    },
});
