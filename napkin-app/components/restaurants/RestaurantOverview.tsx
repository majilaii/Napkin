import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, IconSize, Spacing, Type } from '@/constants/theme';

type Props = {
    average?: number | null;
    ratingCount?: number;
    reviewCount?: number;
    loading?: boolean;
    unavailable?: boolean;
    onReviews?: () => void;
    palette: typeof Colors.light;
};

/** Native ratings and written reviews have distinct counts, kept on one quiet line. */
export function RestaurantOverview({
    average, ratingCount = 0, reviewCount = 0, loading = false,
    unavailable = false, onReviews, palette,
}: Props) {
    const hasRating = average != null && Number.isFinite(average) && average >= 0.5 && average <= 5
        && Number.isSafeInteger(ratingCount) && ratingCount > 0;
    const hasReviews = Number.isSafeInteger(reviewCount) && reviewCount > 0;
    const canOpen = hasReviews && !!onReviews;
    const ratingCopy = `${ratingCount} Napkin ${ratingCount === 1 ? 'rating' : 'ratings'}`;
    const reviewCopy = `${reviewCount} ${hasRating ? '' : 'Napkin '}${reviewCount === 1 ? 'review' : 'reviews'}`;
    const fallback = loading ? 'Loading reviews…' : unavailable ? 'Reviews unavailable' : 'No reviews yet';
    const accessibilityLabel = [
        hasRating ? `Napkin, ${average.toFixed(1)} out of 5 from ${ratingCount} ${ratingCount === 1 ? 'rating' : 'ratings'}` : null,
        hasReviews ? `${reviewCount} ${reviewCount === 1 ? 'review' : 'reviews'}` : null,
        !hasRating && !hasReviews ? fallback : null,
    ].filter(Boolean).join('. ');
    const content = <>
        {hasRating ? <View style={styles.rating}>
            <Ionicons name="star-outline" size={IconSize.sm} color={palette.amberBright} />
            <Text style={[Type.restaurantLedgerRating, { color: palette.text }]}>{average.toFixed(1)}</Text>
            <Text style={[Type.metadata, { color: palette.textMuted }]}>· {ratingCopy}</Text>
        </View> : null}
        {hasReviews ? <Text style={[Type.metadata, { color: canOpen ? palette.primary : palette.textMuted }]}>
            {hasRating ? '· ' : ''}{reviewCopy}
        </Text> : null}
        {canOpen ? <Ionicons name="chevron-forward" size={IconSize.sm} color={palette.primary} /> : null}
        {!hasRating && !hasReviews ? <Text style={[Type.metadata, { color: palette.textMuted }]}>{fallback}</Text> : null}
    </>;

    return (
        <View style={styles.overview} testID="restaurant-overview">
            {canOpen ? <Pressable onPress={onReviews} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
                style={({ pressed }) => [styles.line, pressed && styles.pressed]}>{content}</Pressable>
                : <View accessible accessibilityLabel={accessibilityLabel} style={styles.line}>{content}</View>}
        </View>
    );
}

const styles = StyleSheet.create({
    overview: { paddingHorizontal: Spacing.restaurant.pageGutter },
    line: { minHeight: Spacing.restaurant.quietActionHeight, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: Spacing.xs },
    rating: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.xs },
    pressed: { opacity: 0.8 },
});
