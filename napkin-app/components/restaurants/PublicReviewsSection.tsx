/**
 * PublicReviewsSection — the "Public reviews" section on a restaurant page.
 *
 * Shows up to 5 cards by default; "See more" reveals up to 20.
 * Empty state = hidden. Loading = spinner. Error = muted copy.
 *
 * Surface C (TICKET-022): a "matches mine" toggle pill filters/reorders
 * the list to show only reviews whose author has match_pct >= 70 AND
 * overlap_n >= 5. The pill is hidden when fewer than 3 qualifying reviews
 * are in the loaded set. Filter is client-side; toggling is instant.
 *
 * Sits below Who's-been, above the Visits feed (per UX spec).
 */
import React, { useMemo, useState } from 'react';
import {
    View,
    Text,
    Pressable,
    ActivityIndicator,
    StyleSheet,
} from 'react-native';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { PublicReviewCard as PublicReviewCardType } from '@/hooks/restaurants/useRestaurantPage';
import { PublicReviewCard } from './PublicReviewCard';

// Calibration thresholds for the "matches mine" filter (locked for v1)
const MATCH_MIN_PCT = 70;
const MATCH_MIN_OVERLAP = 5;
const FILTER_PILL_MIN_QUALIFYING = 3;

const DEFAULT_COUNT = 5;
const MAX_COUNT = 20;

interface PublicReviewsSectionProps {
    reviews: PublicReviewCardType[];
    total: number;
    loading?: boolean;
    error?: boolean;
    /** The authenticated viewer's user_id — suppresses the calibration chip on own cards. */
    viewerUserId?: string | null;
}

/** Returns true when a review qualifies for the "matches mine" filter. */
function isMatchingReview(review: PublicReviewCardType): boolean {
    const cal = review.calibration;
    if (!cal) return false;
    return cal.match_pct >= MATCH_MIN_PCT && cal.overlap_n >= MATCH_MIN_OVERLAP;
}

export function PublicReviewsSection({
    reviews,
    total,
    loading = false,
    error = false,
    viewerUserId,
}: PublicReviewsSectionProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const [expanded, setExpanded] = useState(false);
    // Filter state — default OFF, resets on each page load per spec
    const [matchFilterOn, setMatchFilterOn] = useState(false);

    // Qualifying reviews in the full loaded set
    const qualifyingCount = useMemo(
        () => reviews.slice(0, MAX_COUNT).filter(isMatchingReview).length,
        [reviews],
    );

    // Show the filter pill only when >= 3 qualifying reviews are loaded
    const showFilterPill = qualifyingCount >= FILTER_PILL_MIN_QUALIFYING;

    // Derive displayed list
    const displayedReviews = useMemo(() => {
        const pool = expanded ? reviews.slice(0, MAX_COUNT) : reviews.slice(0, DEFAULT_COUNT);

        if (!matchFilterOn) return pool;

        // Filter to qualifying reviews, sorted by match_pct DESC, then created_at DESC
        return pool
            .filter(isMatchingReview)
            .sort((a, b) => {
                const aMatch = a.calibration!.match_pct;
                const bMatch = b.calibration!.match_pct;
                if (bMatch !== aMatch) return bMatch - aMatch;
                return b.created_at > a.created_at ? 1 : -1;
            });
    }, [reviews, expanded, matchFilterOn]);

    const canSeeMore = !expanded && total > DEFAULT_COUNT;

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

    return (
        <View style={styles.container}>
            <Text style={[styles.sectionLabel, { color: palette.textSecondary }]}>
                Public reviews
            </Text>

            {/* "Matches mine" filter pill — Surface C (TICKET-022) */}
            {showFilterPill && (
                <Pressable
                    onPress={() => setMatchFilterOn((prev) => !prev)}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: matchFilterOn }}
                    accessibilityLabel="show reviews from people whose taste matches mine"
                    style={({ pressed }) => [
                        styles.filterPill,
                        matchFilterOn
                            ? { backgroundColor: palette.primary }
                            : { backgroundColor: palette.surfaceContainerHigh },
                        pressed && { opacity: 0.75 },
                    ]}
                >
                    <Text
                        style={[
                            styles.filterPillText,
                            { color: matchFilterOn ? '#ffffff' : palette.textSecondary },
                        ]}
                    >
                        show reviews from people whose taste matches mine
                    </Text>
                </Pressable>
            )}

            <View style={styles.list}>
                {displayedReviews.map((review) => (
                    <PublicReviewCard
                        key={review.entry_id}
                        review={review}
                        viewerUserId={viewerUserId}
                    />
                ))}
            </View>

            {canSeeMore && !matchFilterOn && (
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
    filterPill: {
        alignSelf: 'flex-start',
        borderRadius: Radius.full,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.xs + 2,
        marginBottom: Spacing.xs,
    },
    filterPillText: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        lineHeight: 17,
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
