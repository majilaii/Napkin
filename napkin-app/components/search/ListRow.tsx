/**
 * ListRow — compact typographic list row for search surfaces (TICKET-097).
 *
 * Lists are typographic per design doctrine: NO thumbnails. Title in
 * Newsreader italic (content voice), `<n> spots` meta in Manrope. Metrics
 * match SearchResultRow (padding, type sizes) so it sits in the same ledger.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { MyList } from '@/hooks/lists/useMyLists';

interface Props {
    list: MyList;
    onPress: (list: MyList) => void;
}

export function ListRow({ list, onPress }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const meta = `${list.entry_count} ${list.entry_count === 1 ? 'spot' : 'spots'}`;

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
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xs,
    },
    title: {
        flexShrink: 1,
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 17,
        lineHeight: 22,
    },
    meta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
});
