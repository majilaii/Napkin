/**
 * PublicReviewCard — a single public review on a restaurant page.
 *
 * Layout:
 *   [Avatar] DisplayName         [Photo 72pt]
 *           @username
 *           ★ Rating  · date
 *   Note excerpt (2 lines, Newsreader)
 *   [Reactions pill] [Replies pill]
 *
 * Tapping body → /entry-detail?entryId=X&viewAs=public
 * Tapping avatar / name / @username → /u/[username]  (TICKET-020 profile)
 */
import React from 'react';
import {
    View,
    Text,
    Pressable,
    StyleSheet,
    Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { PublicReviewCard as PublicReviewCardType } from '@/hooks/restaurants/useRestaurantPage';
import { CalibrationChip } from '@/components/profile/CalibrationChip';

interface PublicReviewCardProps {
    review: PublicReviewCardType;
    /** The authenticated viewer's user_id — used to suppress the chip on own cards. */
    viewerUserId?: string | null;
}

function formatRelativeDate(dateStr: string): string {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const diffMs = Date.now() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays < 1) return 'today';
    if (diffDays === 1) return '1d';
    if (diffDays < 7) return `${diffDays}d`;
    if (diffDays < 14) return '1w';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function initials(name: string): string {
    return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();
}

export function PublicReviewCard({ review, viewerUserId }: PublicReviewCardProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    const handleCardPress = () => {
        router.push({
            pathname: '/entry-detail',
            params: { entryId: review.entry_id, viewAs: 'public' },
        });
    };

    const handleAuthorPress = () => {
        if (review.username) {
            router.push({
                pathname: '/u/[identifier]' as const,
                params: { identifier: review.username },
            });
        }
    };

    const avatarInitials = initials(review.display_name);
    const relDate = formatRelativeDate(review.created_at);
    // Show calibration chip iff viewer is not the card author
    const showCalibration = review.user_id !== viewerUserId;

    return (
        <Pressable
            onPress={handleCardPress}
            style={({ pressed }) => [
                styles.card,
                {
                    backgroundColor: palette.card,
                    opacity: pressed ? 0.88 : 1,
                },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Review by ${review.display_name}`}
        >
            <View style={styles.header}>
                {/* Left: avatar + name + username */}
                <Pressable
                    onPress={handleAuthorPress}
                    style={styles.authorBlock}
                    hitSlop={4}
                >
                    {review.avatar_url ? (
                        <Image
                            source={{ uri: review.avatar_url }}
                            style={[styles.avatar, { backgroundColor: palette.secondaryContainer }]}
                        />
                    ) : (
                        <View
                            style={[
                                styles.avatar,
                                { backgroundColor: palette.secondaryContainer },
                            ]}
                        >
                            <Text
                                style={[styles.avatarInitials, { color: palette.text }]}
                                allowFontScaling={false}
                            >
                                {avatarInitials}
                            </Text>
                        </View>
                    )}
                    <View style={styles.nameStack}>
                        <Text
                            style={[styles.displayName, { color: palette.text }]}
                            numberOfLines={1}
                        >
                            {review.display_name}
                        </Text>
                        {/* @username row — chip right-aligned on the same row, wraps below if too narrow */}
                        <View style={styles.usernameRow}>
                            {review.username ? (
                                <Text
                                    style={[styles.username, { color: palette.textMuted }]}
                                    numberOfLines={1}
                                >
                                    @{review.username}
                                </Text>
                            ) : null}
                            {showCalibration && review.calibration != null && (
                                <CalibrationChip
                                    calibration={review.calibration}
                                    form="compact"
                                />
                            )}
                        </View>
                    </View>
                </Pressable>

                {/* Right: first photo (72pt square) */}
                {review.photo_url ? (
                    <Image
                        source={{ uri: review.photo_url }}
                        style={[styles.photo, { backgroundColor: palette.surfaceContainerHigh }]}
                        resizeMode="cover"
                    />
                ) : null}
            </View>

            {/* Rating + date row */}
            <View style={styles.metaRow}>
                <Text style={[styles.rating, { color: palette.amberBright }]}>
                    {review.rating.toFixed(1)}
                </Text>
                <Text style={[styles.metaDot, { color: palette.textMuted }]}> · </Text>
                <Text style={[styles.metaDate, { color: palette.textMuted }]}>{relDate}</Text>
            </View>

            {/* Note excerpt — 2 lines, Newsreader */}
            <Text
                style={[styles.noteExcerpt, { color: palette.text }]}
                numberOfLines={2}
                ellipsizeMode="tail"
            >
                {review.note_excerpt}
            </Text>

            {/* Engagement pills */}
            {(review.public_reaction_count > 0 || review.public_reply_count > 0) ? (
                <View style={styles.pills}>
                    {review.public_reaction_count > 0 && (
                        <View
                            style={[styles.pill, { backgroundColor: palette.surfaceContainerLow }]}
                        >
                            <Text style={[styles.pillText, { color: palette.textMuted }]}>
                                ❤️ {review.public_reaction_count}
                            </Text>
                        </View>
                    )}
                    {review.public_reply_count > 0 && (
                        <View
                            style={[styles.pill, { backgroundColor: palette.surfaceContainerLow }]}
                        >
                            <Text style={[styles.pillText, { color: palette.textMuted }]}>
                                {review.public_reply_count} {review.public_reply_count === 1 ? 'reply' : 'replies'}
                            </Text>
                        </View>
                    )}
                </View>
            ) : null}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: {
        borderRadius: Radius.md,
        padding: Spacing.md,
        gap: Spacing.xs + 2,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: Spacing.sm,
    },
    authorBlock: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        flex: 1,
    },
    avatar: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    avatarInitials: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11,
    },
    nameStack: {
        flex: 1,
    },
    usernameRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        flexWrap: 'wrap',
        gap: 6,
    },
    displayName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
        lineHeight: 18,
    },
    username: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
        lineHeight: 15,
    },
    photo: {
        width: 72,
        height: 72,
        borderRadius: Radius.sm,
        flexShrink: 0,
    },
    metaRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    rating: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
    },
    metaDot: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 12,
    },
    metaDate: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
    },
    noteExcerpt: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 14,
        lineHeight: 20,
    },
    pills: {
        flexDirection: 'row',
        gap: Spacing.xs,
        marginTop: Spacing.xs,
    },
    pill: {
        borderRadius: Radius.full,
        paddingHorizontal: Spacing.sm,
        paddingVertical: 3,
    },
    pillText: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
    },
});
