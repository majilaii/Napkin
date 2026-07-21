import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { RestaurantFeaturedList } from '@/hooks/restaurants/useRestaurantFeaturedLists';

interface Props {
    rows: RestaurantFeaturedList[];
    total: number;
}

function coverLetters(title: string): string {
    const firstWord = title.trim().split(/\s+/)[0] ?? '';
    return Array.from(firstWord).slice(0, 2).join('').toUpperCase() || '?';
}

export function FeaturedInListsBand({ rows, total }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const visibleRows = rows.slice(0, 3);

    if (visibleRows.length === 0) return null;

    return (
        <View style={styles.band}>
            <View style={styles.headerRow}>
                <View style={[styles.headerRule, { backgroundColor: palette.ruleInkSoft }]} />
                <Text
                    style={[styles.headerLabel, { color: palette.textMuted }]}
                    accessibilityRole="header"
                >
                    FEATURED IN LISTS
                </Text>
                <View style={[styles.headerRule, { backgroundColor: palette.ruleInkSoft }]} />
            </View>

            {visibleRows.map((list) => {
                const owner = list.owner_display_name ?? list.owner_username ?? 'someone';
                const emoji = list.emoji?.trim() || null;
                return (
                    <Pressable
                        key={list.id}
                        onPress={() => router.push(`/list/${list.id}` as any)}
                        accessibilityRole="button"
                        accessibilityLabel={`${list.title}, ${list.entry_count} spots, ${owner}`}
                        style={({ pressed }) => [
                            styles.card,
                            { backgroundColor: palette.surfaceJournalLow },
                            Shadow.ambient,
                            pressed && styles.cardPressed,
                        ]}
                    >
                        <View
                            style={[
                                styles.coverPlate,
                                { backgroundColor: palette.surfaceJournalHi },
                            ]}
                        >
                            <Text
                                style={[
                                    emoji ? styles.coverEmoji : styles.coverLetters,
                                    { color: palette.textSecondary },
                                ]}
                                numberOfLines={1}
                            >
                                {emoji ?? coverLetters(list.title)}
                            </Text>
                        </View>

                        <View style={styles.copy}>
                            <Text
                                style={[styles.title, { color: palette.text }]}
                                numberOfLines={1}
                            >
                                {list.title}
                            </Text>
                            <Text
                                style={[styles.meta, { color: palette.textMuted }]}
                                numberOfLines={1}
                            >
                                {`${list.entry_count} spots · ${owner}`}
                            </Text>
                        </View>

                        <Text style={[styles.arrow, { color: palette.textSecondary }]}>→</Text>
                    </Pressable>
                );
            })}

            {total > 3 ? (
                <Text style={[styles.more, { color: palette.textMuted }]}>
                    {`+${total - 3} more`}
                </Text>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    band: {
        paddingHorizontal: 22,
        paddingBottom: Spacing.md,
        marginTop: Spacing.xs,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        marginBottom: Spacing.md,
    },
    headerRule: {
        flex: 1,
        height: 1,
    },
    headerLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        lineHeight: 15,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
    },
    card: {
        minHeight: 76,
        borderRadius: Radius.md,
        padding: Spacing.md,
        marginBottom: Spacing.sm + 2,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    cardPressed: {
        opacity: 0.72,
    },
    coverPlate: {
        width: 48,
        height: 48,
        borderRadius: Radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    coverEmoji: {
        fontSize: 22,
        lineHeight: 28,
    },
    coverLetters: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 18,
        lineHeight: 22,
        letterSpacing: 0.5,
    },
    copy: {
        flex: 1,
        minWidth: 0,
    },
    title: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 17,
        lineHeight: 22,
    },
    meta: {
        ...Type.metadata,
        fontVariant: ['tabular-nums'],
        marginTop: 2,
    },
    arrow: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 20,
        lineHeight: 24,
        minWidth: 24,
        textAlign: 'right',
    },
    more: {
        ...Type.metadata,
        fontVariant: ['tabular-nums'],
        textAlign: 'right',
    },
});
