/**
 * RatingBand — prominent star band below the masthead.
 *
 * Stars ≥32px, amber fill (palette.star) / muted-rule unset (palette.divider),
 * half-step taps (tap full → half → clear cycle).
 * Serif italic adjective + "· X / 5" descriptor line when rated.
 *
 * Props: { rating, onRatingChange }
 * No business logic — purely presentational.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ratingDescriptor } from '@/lib/composer';

const STAR_SIZE = 34;

interface Props {
    /** 0 = unrated; 0.5–5 in half-star steps */
    rating: number;
    onRatingChange: (value: number) => void;
}

/**
 * Half-step tap cycle per star:
 *   current = star (full)   → set to star - 0.5
 *   current = star - 0.5    → clear to 0
 *   otherwise               → set to star (full)
 */
function nextRating(current: number, star: number): number {
    if (current === star) return star - 0.5;
    if (current === star - 0.5) return 0;
    return star;
}

export function RatingBand({ rating, onRatingChange }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const descriptor = ratingDescriptor(rating);

    return (
        <View style={styles.wrapper}>
            <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((star) => {
                    const filled = rating >= star;
                    const half = !filled && rating >= star - 0.5;
                    const iconColor = (filled || half) ? palette.star : palette.divider;
                    return (
                        <Pressable
                            key={star}
                            onPress={() => onRatingChange(nextRating(rating, star))}
                            style={styles.starTap}
                            hitSlop={6}
                            accessibilityLabel={`Rate ${star} star${star !== 1 ? 's' : ''}`}
                            accessibilityRole="button"
                        >
                            <Ionicons
                                name={filled ? 'star' : half ? 'star-half' : 'star-outline'}
                                size={STAR_SIZE}
                                color={iconColor}
                            />
                        </Pressable>
                    );
                })}
            </View>

            {rating > 0 ? (
                <View style={styles.descriptorRow}>
                    <Text style={[styles.adjective, { color: palette.text }]}>
                        {descriptor}
                    </Text>
                    <Text style={[styles.ratio, { color: palette.textMuted }]}>
                        {` · ${rating % 1 === 0 ? rating.toFixed(1) : rating} / 5`}
                    </Text>
                </View>
            ) : (
                <Text style={[styles.hint, { color: palette.textMuted }]}>
                    tap a star to rate
                </Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        paddingVertical: Spacing.md,
        gap: Spacing.sm,
    },
    starsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    starTap: {
        padding: 2,
    },
    descriptorRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        flexWrap: 'wrap',
    },
    adjective: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
        lineHeight: 20,
        fontWeight: '400',
        letterSpacing: 0,
    },
    ratio: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
    },
    hint: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 12,
        letterSpacing: 0.3,
    },
});
