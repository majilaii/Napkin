/**
 * TableNightCard — "Group Entry" card matching the wireframe.
 *
 * Layout (top → bottom):
 *  1. Label: "Group Entry • 14 Dec" (uppercase, secondary)
 *  2. Full-bleed hero image (or colour-initial fallback), rounded-[2rem]
 *  3. Large italic Newsreader restaurant name
 *  4. Row: overlapping stacked avatars  |  amber rating chip
 *  5. Quote block (first participant note) with decorative quote marks
 */

import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    Pressable,
    Image,
} from 'react-native';
import { useRouter } from 'expo-router';

import { Colors, Spacing, Radius } from '@/constants/theme';
import { type TableNightActivity } from '@/hooks/tables/useTableActivity';
import { Avatar } from './Avatar';
import { PulseDot } from './PulseDot';

type Palette = typeof Colors.light;

function formatShortDate(dateStr: string | null): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

interface TableNightCardProps {
    item: TableNightActivity;
    palette: Palette;
}

const MAX_VISIBLE_AVATARS = 3;

export function TableNightCard({ item, palette }: TableNightCardProps) {
    const router = useRouter();
    const isActive = item.status === 'rating';
    const photoUrl = item.restaurants?.photo_url ?? null;
    const restaurantName = item.restaurants?.name ?? 'Unknown';
    const restaurantInitial = restaurantName[0].toUpperCase();
    const dateLabel = formatShortDate(item.revealed_at ?? item.created_at);

    // First participant note for the quote block
    const firstNote = item.participants?.find((p) => p.notes)?.notes ?? null;

    const visibleParticipants = item.participants?.slice(0, MAX_VISIBLE_AVATARS) ?? [];
    const overflowCount = Math.max(0, (item.participants?.length ?? 0) - MAX_VISIBLE_AVATARS);

    return (
        <Pressable
            onPress={() =>
                router.push({
                    pathname: isActive ? '/table-night' : '/table-night-detail',
                    params: { nightId: item.id },
                })
            }
            style={({ pressed }) => ({
                opacity: pressed ? 0.95 : 1,
            })}
        >
            {/* Label */}
            <View style={styles.labelRow}>
                {isActive && <PulseDot size={7} color={palette.primary} />}
                <Text
                    style={[
                        styles.labelText,
                        { color: isActive ? palette.primary : palette.textSecondary },
                    ]}
                >
                    {isActive ? 'LIVE ROUND' : `GROUP ENTRY \u00B7 ${dateLabel.toUpperCase()}`}
                </Text>
            </View>

            {/* Card container */}
            <View
                style={[
                    styles.card,
                    {
                        backgroundColor: palette.surfaceContainerLow,
                        shadowColor: palette.text,
                    },
                ]}
            >
                {/* Hero image or fallback */}
                {photoUrl ? (
                    <Image
                        source={{ uri: photoUrl }}
                        style={styles.heroImage}
                        resizeMode="cover"
                    />
                ) : (
                    <View
                        style={[
                            styles.heroFallback,
                            { backgroundColor: palette.primaryMuted },
                        ]}
                    >
                        <Text
                            style={[
                                styles.heroInitial,
                                { color: palette.primary },
                            ]}
                        >
                            {restaurantInitial}
                        </Text>
                    </View>
                )}

                {/* Content below image */}
                <View style={styles.content}>
                    {/* Restaurant name + Rating row */}
                    <View style={styles.nameRow}>
                        <Text
                            style={[
                                styles.restaurantName,
                                { color: palette.text },
                            ]}
                            numberOfLines={2}
                        >
                            {restaurantName}
                        </Text>

                        {item.average_rating != null && (
                            <View
                                style={[
                                    styles.ratingChip,
                                    { backgroundColor: palette.tertiaryFixed },
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.ratingValue,
                                        { color: palette.tertiary },
                                    ]}
                                >
                                    {item.average_rating.toFixed(1)}
                                </Text>
                                <Text
                                    style={[
                                        styles.ratingLabel,
                                        { color: palette.tertiary },
                                    ]}
                                >
                                    AVG
                                </Text>
                            </View>
                        )}
                    </View>

                    {/* Stacked avatars */}
                    {visibleParticipants.length > 0 && (
                        <View style={styles.avatarRow}>
                            {visibleParticipants.map((p, i) => (
                                <View
                                    key={p.user_id}
                                    style={[
                                        styles.avatarWrapper,
                                        {
                                            marginLeft: i === 0 ? 0 : -10,
                                            zIndex: MAX_VISIBLE_AVATARS - i,
                                            borderColor: palette.surfaceContainerLow,
                                        },
                                    ]}
                                >
                                    <Avatar
                                        name={p.profiles?.display_name ?? '?'}
                                        url={null}
                                        size={32}
                                        palette={palette}
                                    />
                                </View>
                            ))}
                            {overflowCount > 0 && (
                                <View
                                    style={[
                                        styles.avatarWrapper,
                                        styles.overflowBubble,
                                        {
                                            marginLeft: -10,
                                            backgroundColor: palette.surfaceContainerHigh,
                                            borderColor: palette.surfaceContainerLow,
                                        },
                                    ]}
                                >
                                    <Text
                                        style={[
                                            styles.overflowText,
                                            { color: palette.textSecondary },
                                        ]}
                                    >
                                        +{overflowCount}
                                    </Text>
                                </View>
                            )}
                        </View>
                    )}

                    {/* Quote block */}
                    {firstNote && (
                        <View style={styles.quoteBlock}>
                            <Text
                                style={[
                                    styles.quoteMark,
                                    { color: palette.primary },
                                ]}
                            >
                                {'\u201C'}
                            </Text>
                            <Text
                                style={[
                                    styles.quoteText,
                                    { color: palette.textSecondary },
                                ]}
                                numberOfLines={3}
                            >
                                {firstNote}
                            </Text>
                            <Text
                                style={[
                                    styles.quoteMark,
                                    styles.quoteMarkClose,
                                    { color: palette.primary },
                                ]}
                            >
                                {'\u201D'}
                            </Text>
                        </View>
                    )}
                </View>
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    labelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: Spacing.sm,
    },
    labelText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 1.5,
    },
    card: {
        borderRadius: 28,
        overflow: 'hidden',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.06,
        shadowRadius: 30,
        elevation: 3,
    },
    heroImage: {
        width: '100%',
        height: 220,
    },
    heroFallback: {
        width: '100%',
        height: 100,
        alignItems: 'center',
        justifyContent: 'center',
    },
    heroInitial: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 42,
        opacity: 0.3,
    },
    content: {
        padding: Spacing.lg,
        paddingTop: Spacing.lg + 4,
        paddingBottom: Spacing.lg + 4,
    },
    nameRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    restaurantName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 32,
        lineHeight: 38,
        flex: 1,
        marginRight: Spacing.md,
    },
    ratingChip: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: Radius.lg,
        alignItems: 'center',
    },
    ratingValue: {
        fontFamily: 'Newsreader_700Bold',
        fontSize: 22,
        lineHeight: 26,
    },
    ratingLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 9,
        letterSpacing: 0.8,
        opacity: 0.7,
        marginTop: -2,
    },
    avatarRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: Spacing.md + 4,
    },
    avatarWrapper: {
        borderWidth: 2,
        borderRadius: 18,
    },
    overflowBubble: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    overflowText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
    },
    quoteBlock: {
        marginTop: Spacing.md + 4,
    },
    quoteMark: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 32,
        lineHeight: 28,
    },
    quoteMarkClose: {
        textAlign: 'right',
        marginTop: -8,
    },
    quoteText: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 14,
        lineHeight: 22,
    },
});
