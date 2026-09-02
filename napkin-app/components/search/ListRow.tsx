/**
 * ListRow — compact typographic list row for search surfaces (TICKET-097).
 *
 * Lists are typographic per design doctrine: NO thumbnails. Title in
 * upright Newsreader, `<n> spots` meta in Manrope. Metrics
 * match SearchResultRow (padding, type sizes) so it sits in the same ledger.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, IconSize, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { MyList } from '@/hooks/lists/useMyLists';

export type ListRowList = Pick<MyList, 'id' | 'title' | 'emoji' | 'entry_count'>
    & Partial<Pick<MyList, 'privacy'>>;

interface Props {
    list: ListRowList;
    meta?: string;
    onPress: (list: ListRowList) => void;
}

export function ListRow({ list, meta: metaOverride, onPress }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const meta = metaOverride
        ?? `${list.entry_count} ${list.entry_count === 1 ? 'spot' : 'spots'}`;

    return (
        <Pressable
            style={({ pressed }) => [
                styles.row,
                pressed && { backgroundColor: palette.surfaceContainer },
            ]}
            onPress={() => onPress(list)}
            accessibilityRole="button"
            accessibilityLabel={list.title}
        >
            {list.emoji ? <Text style={styles.emoji}>{list.emoji}</Text> : null}
            <View style={styles.textBlock}>
                <View style={styles.titleRow}>
                    <Text
                        style={[styles.title, { color: palette.text }]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                    >
                        {list.title}
                    </Text>
                    {list.privacy === 'private' ? (
                        <Ionicons
                            name="lock-closed-outline"
                            size={12}
                            color={palette.textMuted}
                        />
                    ) : null}
                </View>
                <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>
                    {meta}
                </Text>
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.sm + 3,
    },
    textBlock: {
        flex: 1,
        minWidth: 0,
        gap: 2,
    },
    emoji: {
        fontSize: IconSize.md,
        marginRight: Spacing.sm,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xs,
    },
    title: {
        ...Type.feedNoteRestaurant,
        flexShrink: 1,
    },
    meta: {
        ...Type.metadata,
    },
});
