/**
 * ListCard — row in the Lists tab.
 * Text-forward (no thumbnail): italic-serif title + quiet middle-dot meta line
 * (count · ranked · last-updated) + relationship icon for private/Table lists.
 * Heirloom voice — no chip badges.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Palette = typeof Colors.light;

/** Structural subset ListCard renders — satisfied by both MyList and SavedList. */
export interface ListCardData {
    title: string;
    emoji: string | null;
    table_id?: string | null;
    privacy: 'public' | 'private';
    entry_count: number;
    ranked: boolean;
    updated_at: string;
}

interface Props {
    list: ListCardData;
    onPress: () => void;
    /** TICKET-111: long-press → owner sheet (Edit · Delete). */
    onLongPress?: () => void;
    /** TICKET-185: replaces the default "N spots · ranked · date" meta (e.g. a
     * saved list shows "by owner · N saves" instead). */
    metaOverride?: string;
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

export function ListCard({ list, onPress, onLongPress, metaOverride }: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;

    let metaLine = metaOverride;
    if (metaLine === undefined) {
        const metaParts: string[] = [
            `${list.entry_count} ${list.entry_count === 1 ? 'spot' : 'spots'}`,
        ];
        if (list.ranked) metaParts.push('ranked');
        metaParts.push(formatRelativeDate(list.updated_at));
        metaLine = metaParts.join(' · ');
    }

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
                    {list.emoji ? (
                        <Text style={styles.emoji} numberOfLines={1}>
                            {list.emoji}{' '}
                        </Text>
                    ) : null}
                    <Text
                        style={[styles.title, { color: palette.text, flex: 1 }]}
                        numberOfLines={1}
                    >
                        {list.title}
                    </Text>
                    {list.table_id ? (
                        <Ionicons
                            name="people-outline"
                            size={13}
                            color={palette.textMuted}
                            style={{ marginLeft: Spacing.xs }}
                            accessibilityLabel="Shared with Table"
                        />
                    ) : list.privacy === 'private' ? (
                        <Ionicons
                            name="lock-closed"
                            size={12}
                            color={palette.textMuted}
                            style={{ marginLeft: Spacing.xs }}
                            accessibilityLabel="Private list"
                        />
                    ) : null}
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
    emoji: {
        fontSize: 16,
        lineHeight: 22,
    },
    meta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
});
