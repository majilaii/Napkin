/**
 * PublicReviewsSection — the "Public reviews" section on a restaurant page.
 *
 * Shows up to 5 cards by default; "See more" reveals up to 20.
 * Empty state = hidden. Loading = spinner. Error = muted copy.
 *
 * Sits below Who's-been, above the Visits feed (per UX spec).
 */
import React, { useState } from 'react';
import {
    View,
    Text,
    Pressable,
    ActivityIndicator,
    StyleSheet,
} from 'react-native';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { PublicReviewCard as PublicReviewCardType } from '@/hooks/restaurants/useRestaurantPage';
import { PublicReviewCard } from './PublicReviewCard';

const DEFAULT_COUNT = 5;
const MAX_COUNT = 20;

interface PublicReviewsSectionProps {
    reviews: PublicReviewCardType[];
    total: number;
    loading?: boolean;
    error?: boolean;
}

export function PublicReviewsSection({
    reviews,
    total,
    loading = false,
    error = false,
}: PublicReviewsSectionProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const [expanded, setExpanded] = useState(false);

    // Loading state
    if (loading) {
        return (
            <View style={styles.container}>
                <Text style={[styles.sectionLabel, { color: palette.textSecondary }]}>
                    Public reviews
                </Text>
                <ActivityIndicator size="small" color={palette.textMuted} style={{ marginTop: Spacing.sm }} />
            </View>
        );
    }

    // Error state
    if (error) {
        return (
            <View style={styles.container}>
                <Text style={[styles.sectionLabel, { color: palette.textSecondary }]}>
                    Public reviews
                </Text>
                <Text style={[styles.errorText, { color: palette.textMuted }]}>
                    Couldn&apos;t load public reviews.
                </Text>
            </View>
        );
    }

    // Empty state — hide section entirely per spec
    if (reviews.length === 0) return null;

    const displayedReviews = expanded ? reviews.slice(0, MAX_COUNT) : reviews.slice(0, DEFAULT_COUNT);
    const canSeeMore = !expanded && total > DEFAULT_COUNT;

    return (
        <View style={styles.container}>
            <Text style={[styles.sectionLabel, { color: palette.textSecondary }]}>
                Public reviews
            </Text>

            <View style={styles.list}>
                {displayedReviews.map((review) => (
                    <PublicReviewCard key={review.entry_id} review={review} />
                ))}
            </View>

            {canSeeMore && (
                <Pressable
                    onPress={() => setExpanded(true)}
                    style={({ pressed }) => [
                        styles.seeMoreBtn,
                        { borderColor: palette.outlineVariant, opacity: pressed ? 0.6 : 1 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="See more public reviews"
                >
                    <Text style={[styles.seeMoreText, { color: palette.textSecondary }]}>
                        See more ({total - DEFAULT_COUNT} more)
                    </Text>
                </Pressable>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: 22,
        paddingTop: Spacing.xl,
        gap: Spacing.sm,
    },
    sectionLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        marginBottom: 4,
    },
    list: {
        gap: Spacing.xs,
    },
    errorText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
    },
    seeMoreBtn: {
        alignSelf: 'flex-start',
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 20,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.xs + 2,
        marginTop: Spacing.xs,
    },
    seeMoreText: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
});
