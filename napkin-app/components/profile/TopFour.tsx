/**
 * TopFour — 4-up grid of poster cards with rating badge + italic caption.
 * TICKET-025
 *
 * Auto-derived from `top_four` in profile payload — no edit affordance.
 * Cold-start: 4 dashed empty frames.
 * Partial fill: real posters for qualifying picks + dashed frames for remainder.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';

import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SectionHeader } from './SectionHeader';
import type { TopPick } from '@/hooks/users/useUserProfile';

interface Props {
    picks: TopPick[];
}

export function TopFour({ picks }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    // Pad to 4 slots
    const slots: (TopPick | null)[] = [
        picks[0] ?? null,
        picks[1] ?? null,
        picks[2] ?? null,
        picks[3] ?? null,
    ];

    return (
        <View>
            <SectionHeader title="Top 4" />
            <View style={styles.grid}>
                {slots.map((pick, i) =>
                    pick ? (
                        <View key={i} style={styles.cell}>
                            {/* Poster */}
                            <View
                                style={[
                                    styles.poster,
                                    { backgroundColor: palette.surfaceContainerHigh },
                                ]}
                            >
                                {pick.photo_url ? (
                                    <Image
                                        source={{ uri: pick.photo_url }}
                                        style={StyleSheet.absoluteFill}
                                        contentFit="cover"
                                        transition={150}
                                    />
                                ) : null}
                                {/* Rating badge — bottom-left overlay */}
                                <View style={styles.ratingBadge}>
                                    <Text
                                        style={{
                                            fontFamily: 'Newsreader_400Regular_Italic',
                                            fontSize: 10,
                                            color: palette.textInverse,
                                        }}
                                    >
                                        {pick.max_rating.toFixed(1)}
                                    </Text>
                                </View>
                            </View>
                            {/* Caption */}
                            <Text
                                style={[
                                    styles.caption,
                                    { color: palette.text, fontFamily: 'Newsreader_400Regular_Italic' },
                                ]}
                                numberOfLines={2}
                            >
                                {pick.name}
                            </Text>
                        </View>
                    ) : (
                        <View key={i} style={styles.cell}>
                            <View
                                style={[
                                    styles.poster,
                                    styles.emptyPoster,
                                    {
                                        borderColor: palette.outlineVariant,
                                        backgroundColor: palette.surfaceContainerLow,
                                    },
                                ]}
                            >
                                <Text style={[Type.headlineMedium, { color: palette.textMuted, fontWeight: '300' }]}>
                                    +
                                </Text>
                            </View>
                        </View>
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
        gap: 4,
    },
    poster: {
        aspectRatio: 3 / 4,
        borderRadius: Radius.sm,
        overflow: 'hidden',
        position: 'relative',
        justifyContent: 'flex-end',
    },
    emptyPoster: {
        borderWidth: 1,
        borderStyle: 'dashed',
        justifyContent: 'center',
        alignItems: 'center',
    },
    ratingBadge: {
        position: 'absolute',
        bottom: 4,
        left: 4,
        backgroundColor: 'rgba(28,28,25,0.7)',
        paddingHorizontal: 5,
        paddingVertical: 2,
        borderRadius: 3,
    },
    caption: {
        fontSize: 11,
        lineHeight: 14,
        overflow: 'hidden',
    },
});
