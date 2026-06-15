/**
 * TopFour — 4-up row of "plates": the score plated in the centre of a round
 * dish, name + city beneath. TICKET-025 · reshaped 2026-06-15.
 *
 * Why plates, not posters: restaurants rarely carry a reliable photo, and a
 * portrait poster slot with no image reads as a broken/missing picture. A round
 * plate has no photo expectation — the rating IS the face. Form fixes the
 * "empty box" problem the poster grid couldn't.
 *
 * Auto-derived from `top_four` in profile payload — no edit affordance.
 * Cold-start / partial fill: empty plates (dashed ring + '+') for the remainder.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';

import { Colors, Spacing, Radius, Type } from '@/constants/theme';
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

    // Pad to 4 slots
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
                            style={({ pressed }) => [styles.cell, { opacity: pressed ? 0.92 : 1 }]}
                            onPress={() => router.push(`/restaurant/${pick.restaurant_id}` as any)}
                            accessibilityRole="button"
                            accessibilityLabel={`View ${pick.name}`}
                        >
                            {/* Plate — the restaurant NAME is plated (it's the hero) */}
                            <View
                                style={[
                                    styles.plate,
                                    { backgroundColor: palette.surfaceContainerHigh },
                                ]}
                            >
                                <View
                                    style={[
                                        styles.plateRing,
                                        { borderColor: palette.outlineVariant },
                                    ]}
                                />
                                <Text
                                    style={[styles.plateName, { color: palette.text }]}
                                    numberOfLines={2}
                                >
                                    {pick.name}
                                </Text>
                            </View>
                            {/* Score + city beneath — quiet, secondary (hidden when no visible rating) */}
                            {pick.max_rating != null ? (
                                <Text style={[styles.score, { color: palette.primary }]}>
                                    {pick.max_rating.toFixed(1)}
                                </Text>
                            ) : null}
                            {pick.city ? (
                                <Text
                                    style={[styles.city, { color: palette.textMuted }]}
                                    numberOfLines={1}
                                >
                                    {pick.city}
                                </Text>
                            ) : null}
                        </Pressable>
                    ) : (
                        <Pressable
                            key={i}
                            style={styles.cell}
                            onPress={isOwner && onEdit ? onEdit : undefined}
                            accessibilityRole={isOwner && onEdit ? 'button' : undefined}
                            accessibilityLabel={isOwner && onEdit ? 'Add to your Top 4' : undefined}
                        >
                            <View
                                style={[
                                    styles.plate,
                                    styles.emptyPlate,
                                    {
                                        borderColor: palette.outlineVariant,
                                        backgroundColor: palette.surfaceContainerLow,
                                    },
                                ]}
                            >
                                <Text
                                    style={[Type.headlineMedium, { color: palette.textMuted, fontWeight: '300' }]}
                                >
                                    +
                                </Text>
                            </View>
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
        paddingHorizontal: Spacing.lg,
        gap: Spacing.sm,
    },
    cell: {
        flex: 1,
        alignItems: 'center',
        gap: 6,
    },
    plate: {
        width: '100%',
        aspectRatio: 1,
        borderRadius: Radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
    },
    plateRing: {
        position: 'absolute',
        top: 7,
        left: 7,
        right: 7,
        bottom: 7,
        borderRadius: Radius.full,
        borderWidth: 1,
    },
    emptyPlate: {
        borderWidth: 1,
        borderStyle: 'dashed',
    },
    plateName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 12.5,
        lineHeight: 15,
        textAlign: 'center',
        paddingHorizontal: 8,
    },
    score: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
        textAlign: 'center',
    },
    city: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 10,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        textAlign: 'center',
    },
});
