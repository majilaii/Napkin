/**
 * ListsRail — the YOUR LISTS shelf at the top of the Wishlist tab.
 *
 * Wishlist (saved spots) stays the hero of the tab; lists live up top as a
 * compact horizontal shelf of editorial cards so they're visible/discoverable
 * (not buried at the bottom of a long scroll) with `+ new list` always one tap.
 *
 * Text-forward cards (no thumbnails) — italic-serif title + muted count — in
 * keeping with the warm-paper, type-led brand.
 */
import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { ListsSectionRow } from './listsSectionUtils';

type Palette = typeof Colors.light;

interface Props {
    rows: ListsSectionRow[];
    onOpenList: (id: string) => void;
    onNewList: () => void;
}

export function ListsRail({ rows, onOpenList, onNewList }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;

    return (
        <View style={styles.wrap}>
            <Text style={[styles.kicker, { color: palette.textSecondary }]}>YOUR LISTS</Text>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.rail}
            >
                {rows.map((row) => (
                    <Pressable
                        key={row.id}
                        onPress={() => onOpenList(row.id)}
                        style={({ pressed }) => [
                            styles.card,
                            { backgroundColor: palette.card, opacity: pressed ? 0.8 : 1 },
                            Shadow.subtle,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`Open list ${row.name}`}
                    >
                        <Text style={[styles.cardName, { color: palette.text }]} numberOfLines={2}>
                            {row.name}
                        </Text>
                        <Text style={[styles.cardMeta, { color: palette.textMuted }]} numberOfLines={1}>
                            {row.metaLabel}
                        </Text>
                    </Pressable>
                ))}

                {/* + new list — always present, never buried */}
                <Pressable
                    onPress={onNewList}
                    style={({ pressed }) => [
                        styles.newCard,
                        { borderColor: palette.outlineVariant, opacity: pressed ? 0.7 : 1 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="new list"
                >
                    <Ionicons name="add" size={20} color={palette.primary} />
                    <Text style={[styles.newLabel, { color: palette.primary }]}>new list</Text>
                </Pressable>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        paddingTop: Spacing.md,
    },
    kicker: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        marginBottom: 10,
        paddingHorizontal: 22,
    },
    rail: {
        flexDirection: 'row',
        gap: 10,
        paddingHorizontal: 22,
        paddingRight: 30,
        paddingBottom: 4,
    },
    card: {
        minWidth: 150,
        maxWidth: 210,
        borderRadius: 14,
        paddingVertical: 13,
        paddingHorizontal: 14,
        justifyContent: 'space-between',
        gap: 8,
    },
    cardName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 17,
        lineHeight: 21,
    },
    cardMeta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
    newCard: {
        minWidth: 104,
        borderRadius: 14,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        paddingHorizontal: 14,
        paddingVertical: 16,
    },
    newLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
    },
});
