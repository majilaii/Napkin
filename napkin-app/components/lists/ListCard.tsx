/**
 * ListCard — row in the Lists tab.
 * Text-forward (no thumbnail): italic-serif title + quiet middle-dot meta line
 * (count · ranked · last-updated) + lock for private lists. Heirloom voice — no
 * chip badges.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { MyList } from '@/hooks/lists/useMyLists';

type Palette = typeof Colors.light;

interface Props {
    list: MyList;
    onPress: () => void;
    /** TICKET-111: long-press → owner sheet (Edit · Delete). */
    onLongPress?: () => void;
}

function formatRelativeDate(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function ListCard({ list, onPress, onLongPress }: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;

    const metaParts: string[] = [
        `${list.entry_count} ${list.entry_count === 1 ? 'spot' : 'spots'}`,
    ];
    if (list.ranked) metaParts.push('ranked');
    metaParts.push(formatRelativeDate(list.updated_at));
    const metaLine = metaParts.join(' · ');

    return (
        <Pressable
            onPress={onPress}
            onLongPress={onLongPress}
            delayLongPress={350}
            style={({ pressed }) => [
                styles.card,
                { backgroundColor: palette.card, opacity: pressed ? 0.85 : 1 },
                Shadow.subtle,
            ]}
        >
            <View style={styles.content}>
                <View style={styles.titleRow}>
                    <Text
                        style={[styles.title, { color: palette.text, flex: 1 }]}
                        numberOfLines={1}
                    >
                        {list.title}
                    </Text>
                    {list.privacy === 'private' && (
                        <Ionicons
                            name="lock-closed"
                            size={12}
                            color={palette.textMuted}
                            style={{ marginLeft: Spacing.xs }}
                        />
                    )}
                </View>
                <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>
                    {metaLine}
                </Text>
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
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.md,
        gap: Spacing.md,
    },
    content: {
        flex: 1,
        gap: 4,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    title: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 18,
        lineHeight: 22,
    },
    meta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
});
