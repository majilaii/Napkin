/**
 * SubsetCard — round card variant for partial-attendance meals.
 * Canvas WF5. Olive-green badge + "X · Y ate here. Without A & B." line.
 *
 * Rendered in place of a full TableNightCard when a round has fewer
 * participants than the table's current member count (some members
 * missed it). Tappable — opens table-night-detail.
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Spacing } from '@/constants/theme';

type Palette = typeof Colors.light;

interface SubsetCardProps {
    id: string;
    photoUrl: string | null;
    restaurantName: string;
    subLabel?: string; // "Nolita · Spanish"
    date: string; // "Thu 20 Mar"
    present: string[]; // display names
    missing: string[]; // display names
    averageRating: number | null;
    palette: Palette;
}

export function SubsetCard({
    id,
    photoUrl,
    restaurantName,
    subLabel,
    date,
    present,
    missing,
    averageRating,
    palette,
}: SubsetCardProps) {
    const router = useRouter();
    const voices = `${present.length} / ${present.length + missing.length}`;

    return (
        <Pressable
            onPress={() =>
                router.push({
                    pathname: '/table-night-detail',
                    params: { nightId: id },
                })
            }
            style={({ pressed }) => ({ opacity: pressed ? 0.95 : 1 })}
        >
            <View
                style={[
                    styles.card,
                    {
                        backgroundColor: palette.surfaceJournalLow,
                        borderColor: palette.outlineVariant,
                    },
                ]}
            >
                <View
                    style={[
                        styles.hero,
                        !photoUrl && { backgroundColor: palette.primaryMuted },
                    ]}
                >
                    {photoUrl ? (
                        <Image
                            source={{ uri: photoUrl }}
                            style={StyleSheet.absoluteFill}
                            resizeMode="cover"
                        />
                    ) : (
                        <Text style={[styles.heroInitial, { color: palette.primary }]}>
                            {restaurantName[0]?.toUpperCase() ?? '?'}
                        </Text>
                    )}
                    <View
                        style={[
                            styles.badge,
                            { backgroundColor: 'rgba(60,85,60,0.9)' },
                        ]}
                    >
                        <Text style={styles.badgeText}>
                            SUBSET {'\u00B7'} {date.toUpperCase()}
                        </Text>
                    </View>
                </View>

                <View style={styles.content}>
                    <View style={styles.titleRow}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                            <Text
                                style={[styles.name, { color: palette.text }]}
                                numberOfLines={2}
                            >
                                {restaurantName}
                            </Text>
                            {subLabel ? (
                                <Text
                                    style={[styles.sub, { color: palette.textMuted }]}
                                    numberOfLines={1}
                                >
                                    {subLabel}
                                </Text>
                            ) : null}
                        </View>
                        <View style={styles.ratingBlock}>
                            <Text
                                style={[styles.ratingValue, { color: palette.tertiary }]}
                            >
                                {averageRating != null ? averageRating.toFixed(1) : '—'}
                            </Text>
                            <Text
                                style={[
                                    styles.ratingLabel,
                                    { color: palette.textMuted },
                                ]}
                            >
                                {voices} VOICES
                            </Text>
                        </View>
                    </View>

                    <View
                        style={[
                            styles.dashed,
                            { borderColor: palette.outlineVariant },
                        ]}
                    />

                    <Text
                        style={[styles.witnessText, { color: palette.textSecondary }]}
                        numberOfLines={2}
                    >
                        <Text style={{ fontFamily: 'Manrope_600SemiBold' }}>
                            {present.join(' \u00B7 ')}
                        </Text>
                        {' ate here.'}
                        {missing.length > 0 ? (
                            <Text style={{ color: palette.textMuted }}>
                                {' '}Without {missing.join(' & ')}.
                            </Text>
                        ) : null}
                    </Text>
                </View>
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: {
        borderRadius: 12,
        overflow: 'hidden',
        borderWidth: 1,
    },
    hero: {
        height: 110,
        justifyContent: 'center',
        alignItems: 'center',
    },
    heroInitial: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 42,
        opacity: 0.35,
    },
    badge: {
        position: 'absolute',
        top: 10,
        left: 10,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 3,
    },
    badgeText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 0.8,
        color: '#f2f5e8',
    },
    content: {
        padding: 14,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        marginBottom: 8,
    },
    name: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 20,
        lineHeight: 23,
        letterSpacing: -0.3,
    },
    sub: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
        marginTop: 3,
    },
    ratingBlock: {
        alignItems: 'flex-end',
    },
    ratingValue: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 22,
        lineHeight: 24,
    },
    ratingLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 8,
        letterSpacing: 0.8,
        marginTop: 2,
    },
    dashed: {
        borderTopWidth: 1,
        borderStyle: 'dashed',
        marginTop: 2,
        marginBottom: 8,
    },
    witnessText: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
        lineHeight: 17,
    },
});
