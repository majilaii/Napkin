/**
 * TopFour — the profile's four favourite restaurants, ranked 1–4 in a compact 2x2
 * grid of warm "plate" tiles. TICKET-025 · redesigned 2026-06-17.
 *
 * Each filled tile glances three things without a tap:
 *   • amber rating numeral — what they scored it (hidden when unrated)
 *   • a terracotta heart    — they liked it (Letterboxd-style, distinct from rating)
 *   • a muted note glyph    — they wrote a review (entry has content)
 *
 * Two accents only (amber + terracotta); the review glyph stays neutral ink.
 * Auto-derived or curated from `top_four` in the profile payload. Empty slots show
 * a tappable '+' for the owner.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Colors, Spacing, Radius, Shadow } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SectionHeader } from './SectionHeader';
import type { TopPick } from '@/hooks/users/useUserProfile';

interface Props {
    picks: TopPick[];
    /** When true (own profile), shows an "edit" affordance + tappable empty slots. */
    isOwner?: boolean;
    onEdit?: () => void;
}

export function TopFour({ picks, isOwner = false, onEdit }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    const slots: (TopPick | null)[] = [
        picks[0] ?? null,
        picks[1] ?? null,
        picks[2] ?? null,
        picks[3] ?? null,
    ];

    return (
        <View>
            <SectionHeader
                title="Top 4"
                rightLabel={isOwner && onEdit ? 'edit' : undefined}
                onRightLabelPress={onEdit}
            />
            <View style={styles.grid}>
                {slots.map((pick, i) =>
                    pick ? (
                        <Pressable
                            key={i}
                            style={({ pressed }) => [
                                styles.tile,
                                { backgroundColor: palette.surfaceNote, opacity: pressed ? 0.92 : 1 },
                                Shadow.note,
                            ]}
                            onPress={() => router.push(`/restaurant/${pick.restaurant_id}` as any)}
                            accessibilityRole="button"
                            accessibilityLabel={`View ${pick.name}`}
                        >
                            <View style={styles.tileHead}>
                                <Text style={[styles.rank, { color: palette.textMuted }]}>{i + 1}</Text>
                                <Text style={[styles.name, { color: palette.text }]} numberOfLines={2}>
                                    {pick.name}
                                </Text>
                            </View>
                            {pick.city ? (
                                <Text style={[styles.city, { color: palette.textMuted }]} numberOfLines={1}>
                                    {pick.city}
                                </Text>
                            ) : null}

                            {/* Indicator row — rated · liked · reviewed */}
                            <View style={styles.indicators}>
                                {pick.max_rating != null ? (
                                    <View style={[styles.ratingChip, { backgroundColor: palette.tertiaryFixed }]}>
                                        <Text style={[styles.ratingNum, { color: palette.tertiary }]}>
                                            {pick.max_rating.toFixed(1)}
                                        </Text>
                                    </View>
                                ) : null}
                                {pick.liked ? (
                                    <Ionicons name="heart" size={13} color={palette.primary} accessibilityLabel="liked" />
                                ) : null}
                                {pick.has_review ? (
                                    <Ionicons
                                        name="document-text-outline"
                                        size={13}
                                        color={palette.textMuted}
                                        accessibilityLabel="wrote a review"
                                    />
                                ) : null}
                                {/* Liked but unrated — say so, so the tile isn't bare. */}
                                {pick.max_rating == null && pick.liked ? (
                                    <Text style={[styles.likedLabel, { color: palette.textMuted }]}>liked</Text>
                                ) : null}
                            </View>
                        </Pressable>
                    ) : (
                        <Pressable
                            key={i}
                            style={[
                                styles.tile,
                                styles.emptyTile,
                                { borderColor: palette.outlineVariant, backgroundColor: palette.surfaceContainerLow },
                            ]}
                            onPress={isOwner && onEdit ? onEdit : undefined}
                            accessibilityRole={isOwner && onEdit ? 'button' : undefined}
                            accessibilityLabel={isOwner && onEdit ? 'Add to your Top 4' : undefined}
                        >
                            <Text style={[styles.plus, { color: palette.textMuted }]}>+</Text>
                        </Pressable>
                    )
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        paddingHorizontal: Spacing.lg,
        gap: Spacing.sm,
    },
    tile: {
        width: '48%',
        minHeight: 96,
        borderRadius: Radius.md,
        paddingHorizontal: 11,
        paddingVertical: 10,
        justifyContent: 'flex-start',
    },
    tileHead: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 6,
    },
    rank: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
        lineHeight: 18,
    },
    name: {
        flex: 1,
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15.5,
        lineHeight: 18,
    },
    city: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 10,
        letterSpacing: 0.3,
        marginTop: 3,
        marginLeft: 20,
    },
    indicators: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        marginTop: 'auto',
        paddingTop: 9,
        marginLeft: 20,
    },
    ratingChip: {
        borderRadius: 999,
        paddingHorizontal: 7,
        paddingVertical: 1,
    },
    ratingNum: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
    },
    likedLabel: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 12,
    },
    emptyTile: {
        borderWidth: 1,
        borderStyle: 'dashed',
        alignItems: 'center',
        justifyContent: 'center',
    },
    plus: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 28,
        fontWeight: '300',
    },
});
