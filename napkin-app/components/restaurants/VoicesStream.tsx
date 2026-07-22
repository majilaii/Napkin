/**
 * VoicesStream — the restaurant page's compact REVIEWS section.
 *
 * Order: self/tablemate visit rows → match filter → one featured public review
 * → one compact public review → the all-reviews doorway.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { PageVisit, PublicReviewCard } from '@/hooks/restaurants/useRestaurantPage';

import { AllReviewsFolio } from './AllReviewsFolio';

interface VoiceRowProps {
    kind: 'self' | 'tablemate';
    initial: string;
    name: string;
    rating: number | null;
    date: string;
    note?: string | null;
    onPress?: () => void;
    palette: typeof Colors.light;
}

interface Props {
    selfVisits: PageVisit[];
    tablemateVisits: PageVisit[];
    publicReviews: PublicReviewCard[];
    /** Total public reviews from `public_reviews_total`. */
    reviewCount?: number | null;
    /** Used to suppress self-comparison detail in public-review accessibility copy. */
    viewerUserId?: string | null;
    /** Controlled filter state for the existing "matches mine" toggle. */
    matchFilterOn?: boolean;
    onToggleMatchFilter?: () => void;
    onVisitPress?: (visit: PageVisit) => void;
    onPublicReviewPress?: (entry_id: string) => void;
    restaurantName?: string | null;
    /** Opens the all-reviews page. */
    onSeeAllReviews?: () => void;
}

const MATCH_MIN_PCT = 70;
const MATCH_MIN_OVERLAP = 5;
const FILTER_PILL_MIN_QUALIFYING = 3;

function reviewQualifiesForMatchFilter(review: PublicReviewCard): boolean {
    const calibration = review.calibration;
    if (!calibration) return false;
    return calibration.match_pct >= MATCH_MIN_PCT
        && calibration.overlap_n >= MATCH_MIN_OVERLAP;
}

type Palette = typeof Colors.light;

function formatDate(iso: string): string {
    try {
        const date = new Date(iso);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
        return iso;
    }
}

function getInitial(name: string): string {
    return (name ?? '?')[0]?.toUpperCase() ?? '?';
}

function publicReviewAccessibilityLabel(
    review: PublicReviewCard,
    viewerUserId?: string | null,
): string {
    const parts = [
        `${review.display_name} review`,
        `${Number(review.rating).toFixed(1)} rating`,
        `noted ${formatDate(review.created_at)}`,
    ];
    if (viewerUserId !== review.user_id && review.calibration) {
        parts.push(`${review.calibration.match_pct} percent taste match`);
    }
    return parts.join(', ');
}

const CREAM = '#f6ecd9';
const RULE_COLOR = 'rgba(221, 192, 186, 0.4)';

/** Existing compact self/tablemate row. Keep its rendering unchanged. */
function VoiceRow({ kind, initial, name, rating, date, note, onPress, palette }: VoiceRowProps) {
    const avatarContent = <Text style={styles.avText}>{initial}</Text>;
    const avatarEl = kind === 'self' ? (
        <LinearGradient
            colors={['#a8995f', '#6b7c3a']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.av}
        >
            {avatarContent}
        </LinearGradient>
    ) : (
        <LinearGradient
            colors={['#c97557', '#a03f28']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.av}
        >
            {avatarContent}
        </LinearGradient>
    );

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.voice,
                { borderBottomColor: RULE_COLOR, opacity: pressed ? 0.75 : 1 },
            ]}
        >
            {avatarEl}
            <View style={styles.body}>
                <View style={styles.line1}>
                    <Text style={[styles.voiceName, { color: palette.text }]}>{name}</Text>
                    {rating != null ? (
                        <>
                            <Text style={[styles.dot, { color: palette.textMuted }]}>·</Text>
                            <Text style={[styles.ratingText, { color: palette.primary }]}>
                                {rating.toFixed(1)}
                            </Text>
                        </>
                    ) : null}
                    <Text style={[styles.dot, { color: palette.textMuted }]}>·</Text>
                    <Text style={[styles.dateText, { color: palette.textMuted }]}>{formatDate(date)}</Text>
                </View>
                {note ? (
                    <Text style={[styles.noteText, { color: palette.textSecondary }]} numberOfLines={2}>
                        {'— '}{note}
                    </Text>
                ) : null}
            </View>
        </Pressable>
    );
}

function ReviewInitialPlate({ name, palette }: { name: string; palette: Palette }) {
    return (
        <View
            style={[
                styles.reviewPlate,
                {
                    backgroundColor: palette.surfaceContainerLow,
                    borderColor: palette.ruleInkSoft,
                },
            ]}
        >
            <Text style={[styles.reviewPlateText, { color: palette.textSecondary }]}>
                {getInitial(name)}
            </Text>
        </View>
    );
}

function FeaturedReview({
    review,
    viewerUserId,
    onPress,
    palette,
}: {
    review: PublicReviewCard;
    viewerUserId?: string | null;
    onPress?: () => void;
    palette: Palette;
}) {
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole={onPress ? 'button' : undefined}
            accessibilityLabel={publicReviewAccessibilityLabel(review, viewerUserId)}
            style={({ pressed }) => [
                styles.featuredCard,
                { backgroundColor: palette.card },
                Shadow.ambient,
                pressed && styles.pressed,
            ]}
        >
            <Text style={[styles.featuredQuote, { color: palette.text }]} numberOfLines={4}>
                {`— ${review.note_excerpt}`}
            </Text>
            <View style={styles.featuredByline}>
                <ReviewInitialPlate name={review.display_name} palette={palette} />
                <View style={styles.featuredIdentity}>
                    <Text
                        style={[styles.featuredName, { color: palette.text }]}
                        numberOfLines={1}
                    >
                        {review.display_name}
                    </Text>
                    <Text style={[styles.reviewMeta, { color: palette.textMuted }]}>
                        {`noted ${formatDate(review.created_at)}`}
                    </Text>
                </View>
                <View style={styles.featuredRight}>
                    <Text style={[styles.featuredRating, { color: palette.text }]}>
                        {Number(review.rating).toFixed(1)}
                    </Text>
                    {review.public_reaction_count > 0 ? (
                        <Text style={[styles.heartCount, { color: palette.textMuted }]}>
                            {`♥ ${review.public_reaction_count}`}
                        </Text>
                    ) : null}
                </View>
            </View>
        </Pressable>
    );
}

function CompactPublicReview({
    review,
    viewerUserId,
    onPress,
    palette,
}: {
    review: PublicReviewCard;
    viewerUserId?: string | null;
    onPress?: () => void;
    palette: Palette;
}) {
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole={onPress ? 'button' : undefined}
            accessibilityLabel={publicReviewAccessibilityLabel(review, viewerUserId)}
            style={({ pressed }) => [
                styles.compactReview,
                pressed && styles.pressed,
            ]}
        >
            <ReviewInitialPlate name={review.display_name} palette={palette} />
            <View style={styles.compactBody}>
                <View style={styles.compactHeader}>
                    <Text
                        style={[styles.compactName, { color: palette.text }]}
                        numberOfLines={1}
                    >
                        {review.display_name}
                    </Text>
                    <Text style={[styles.compactDot, { color: palette.textMuted }]}>·</Text>
                    <Text style={[styles.reviewMeta, { color: palette.textMuted }]}>
                        {formatDate(review.created_at)}
                    </Text>
                </View>
                <Text
                    style={[styles.compactNote, { color: palette.textSecondary }]}
                    numberOfLines={2}
                >
                    {`— ${review.note_excerpt}`}
                </Text>
            </View>
            <Text style={[styles.compactRating, { color: palette.text }]}>
                {Number(review.rating).toFixed(1)}
            </Text>
        </Pressable>
    );
}

export function VoicesStream(props: Props) {
    const {
        selfVisits,
        tablemateVisits,
        publicReviews,
        reviewCount,
        matchFilterOn = false,
        onToggleMatchFilter,
        onVisitPress,
        onPublicReviewPress,
        restaurantName,
        onSeeAllReviews,
    } = props;
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;

    // The viewer's own reviews render as the "You" self rows above — showing
    // them again in the public slots tripled them (founder-caught on-sim,
    // 2026-07-22). Counts still include self; only the rendered rows dedupe.
    const othersReviews = React.useMemo(
        () => publicReviews.filter((review) => review.user_id !== props.viewerUserId),
        [publicReviews, props.viewerUserId],
    );
    const strangerReviews = React.useMemo(
        () => othersReviews.filter((review) => !review.is_followee),
        [othersReviews],
    );
    const qualifyingPublicCount = strangerReviews.filter(reviewQualifiesForMatchFilter).length;
    const showFilterPill =
        onToggleMatchFilter != null && qualifyingPublicCount >= FILTER_PILL_MIN_QUALIFYING;

    const visiblePublic = React.useMemo(() => {
        // Followee-first (stable, recency preserved within each group) so a
        // friend's review is never buried behind the doorway by a stranger's.
        if (!matchFilterOn) {
            return [...othersReviews].sort(
                (a, b) => Number(b.is_followee) - Number(a.is_followee),
            );
        }

        const followees = othersReviews.filter((review) => review.is_followee);
        const matchingStrangers = strangerReviews
            .filter(reviewQualifiesForMatchFilter)
            .slice()
            .sort((a, b) => {
                const aMatch = a.calibration!.match_pct;
                const bMatch = b.calibration!.match_pct;
                if (bMatch !== aMatch) return bMatch - aMatch;
                return b.created_at > a.created_at ? 1 : -1;
            });
        return [...followees, ...matchingStrangers];
    }, [othersReviews, strangerReviews, matchFilterOn]);

    const inlinePublic = visiblePublic.slice(0, 2);
    const hasPrivateVoices = selfVisits.length > 0 || tablemateVisits.length > 0;
    const total = selfVisits.length + tablemateVisits.length + visiblePublic.length;
    const publicReviewTotal = Math.max(0, reviewCount ?? publicReviews.length);

    if (!hasPrivateVoices && publicReviews.length === 0) {
        const emptyLine = restaurantName
            ? `— no one's written about ${restaurantName} yet.`
            : '— no notes yet.';
        return (
            <View style={styles.empty}>
                <Text style={[styles.emptyText, { color: palette.textMuted }]}>
                    {emptyLine}
                </Text>
            </View>
        );
    }

    return (
        <View style={styles.wrap}>
            <View style={styles.headerRow}>
                <View style={[styles.headerRule, { backgroundColor: palette.ruleInkSoft }]} />
                <Text
                    style={[styles.headerLabel, { color: palette.textMuted }]}
                    accessibilityRole="header"
                    accessibilityLabel="reviews"
                >
                    REVIEWS
                </Text>
                <View style={[styles.headerRule, { backgroundColor: palette.ruleInkSoft }]} />
            </View>

            {selfVisits.map((visit) => (
                <VoiceRow
                    key={`self-${visit.id}`}
                    kind="self"
                    initial={getInitial(visit.user_display_names[0] ?? 'You')}
                    name="You"
                    rating={visit.rating}
                    date={visit.date}
                    note={visit.note}
                    onPress={onVisitPress ? () => onVisitPress(visit) : undefined}
                    palette={palette}
                />
            ))}

            {tablemateVisits.map((visit) => (
                <VoiceRow
                    key={`tm-${visit.id}`}
                    kind="tablemate"
                    initial={getInitial(visit.user_display_names[0] ?? 'M')}
                    name={visit.user_display_names[0] ?? 'Tablemate'}
                    rating={visit.rating}
                    date={visit.date}
                    note={visit.note}
                    onPress={onVisitPress ? () => onVisitPress(visit) : undefined}
                    palette={palette}
                />
            ))}

            {showFilterPill ? (
                <Pressable
                    onPress={onToggleMatchFilter}
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
                            { color: matchFilterOn ? palette.textInverse : palette.textSecondary },
                        ]}
                    >
                        show reviews from people whose taste matches mine
                    </Text>
                </Pressable>
            ) : null}

            {inlinePublic[0] ? (
                <FeaturedReview
                    review={inlinePublic[0]}
                    viewerUserId={props.viewerUserId}
                    onPress={onPublicReviewPress
                        ? () => onPublicReviewPress(inlinePublic[0].entry_id)
                        : undefined}
                    palette={palette}
                />
            ) : null}

            {inlinePublic[1] ? (
                <CompactPublicReview
                    review={inlinePublic[1]}
                    viewerUserId={props.viewerUserId}
                    onPress={onPublicReviewPress
                        ? () => onPublicReviewPress(inlinePublic[1].entry_id)
                        : undefined}
                    palette={palette}
                />
            ) : null}

            {onSeeAllReviews ? (
                <AllReviewsFolio total={publicReviewTotal} onPress={onSeeAllReviews} />
            ) : (
                <Text
                    style={[styles.seeAllText, styles.voiceCount, { color: palette.textSecondary }]}
                >
                    {total}
                </Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        paddingHorizontal: 22,
        paddingTop: Spacing.xs,
        paddingBottom: Spacing.md,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        paddingTop: Spacing.md,
        marginBottom: Spacing.xs,
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
    seeAllText: {
        ...Type.metadata,
        fontFamily: 'Manrope_600SemiBold',
        letterSpacing: 0.2,
    },
    voiceCount: {
        alignSelf: 'flex-end',
        paddingVertical: Spacing.xs,
        marginTop: Spacing.sm,
    },
    voice: {
        flexDirection: 'row',
        gap: 11,
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    av: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    avText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
        fontWeight: '500',
        color: CREAM,
    },
    body: {
        flex: 1,
    },
    line1: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 7,
        marginBottom: 3,
        flexWrap: 'wrap',
    },
    voiceName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
    },
    dot: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 10,
    },
    ratingText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
        fontWeight: '500',
    },
    dateText: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 10.5,
    },
    noteText: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 13,
        lineHeight: 19,
    },
    filterPill: {
        alignSelf: 'flex-start',
        borderRadius: Radius.full,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.xs + 2,
        marginTop: Spacing.sm,
        marginBottom: Spacing.sm,
    },
    filterPillText: {
        ...Type.metadata,
    },
    featuredCard: {
        borderRadius: Radius.md,
        padding: Spacing.md + 2,
        marginTop: Spacing.md,
    },
    featuredQuote: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 19,
        lineHeight: 25,
    },
    featuredByline: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginTop: Spacing.md,
    },
    reviewPlate: {
        width: 32,
        height: 32,
        borderRadius: 16,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    reviewPlateText: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 14,
        lineHeight: 18,
    },
    featuredIdentity: {
        flex: 1,
        minWidth: 0,
    },
    featuredName: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 16,
        lineHeight: 20,
    },
    reviewMeta: {
        ...Type.metadata,
    },
    featuredRight: {
        alignItems: 'flex-end',
        marginLeft: Spacing.sm,
    },
    featuredRating: {
        ...Type.ratingCompact,
        fontSize: 20,
        lineHeight: 24,
        textAlign: 'right',
    },
    heartCount: {
        ...Type.metadata,
        marginTop: 2,
    },
    compactReview: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 11,
        paddingVertical: 14,
    },
    compactBody: {
        flex: 1,
        minWidth: 0,
    },
    compactHeader: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 7,
        marginBottom: Spacing.xs,
    },
    compactName: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 16,
        lineHeight: 20,
        flexShrink: 1,
    },
    compactDot: {
        ...Type.metadata,
    },
    compactNote: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 16,
        lineHeight: 22,
    },
    compactRating: {
        ...Type.ratingCompact,
        fontSize: 19,
        lineHeight: 24,
        minWidth: 42,
        textAlign: 'right',
    },
    pressed: {
        opacity: 0.75,
    },
    empty: {
        paddingHorizontal: 22,
        paddingTop: 20,
    },
    emptyText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
    },
});
