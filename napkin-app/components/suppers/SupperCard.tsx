/**
 * SupperCard — the Supper v2 "empty table" feed card (TICKET-082 v2).
 *
 * Restaurant-anchored, viewer-relative. ONE evolving object with four visual states,
 * derived from filled_count / seat_count / viewer_filled:
 *   • empty                       — 0 filled. murmur + "add your take".
 *   • filling, your seat empty    — some filled, you haven't. pooled photo strip + "add your take".
 *   • filling, your seat filled   — you're in, others pending. your pull-quote + "see the table" + waiting-on.
 *   • gathered                    — all seats filled. avg chip + pooled mosaic + "see the table".
 *
 * Device (the whole "filling up" feeling): stacked avatars — filled = full colour,
 * pending = ghosted. Progress is quiet text, never a loud bar. Two accents: terracotta + amber.
 *
 * Heirloom: warm paper, italic Newsreader for the restaurant name, em-dash pull-quotes,
 * ambient Shadow.note, no 1px sectioning borders.
 */
import React from 'react';
import { View, Text, Image, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { InitialsAvatar } from './InitialsAvatar';
import type { SupperCardActivity, SupperSeat } from '@/hooks/tables/useTableActivity';

type Palette = typeof Colors.light;

interface SupperCardProps {
    supper: SupperCardActivity;
    /** The viewing user. Used to confirm the viewer actually holds a seat before
     *  offering "add your take" (the feed already gates the card to members, but this
     *  keeps the CTA honest if that ever changes). */
    viewerId?: string;
    /** Tap the card body → the gathered view (app/supper/[id]). */
    onOpen?: () => void;
    /** Primary CTA when the viewer's seat is empty → opens the logger in take mode. */
    onAddTake?: () => void;
}

const GHOST_OPACITY = 0.34;

function ratingLabel(n: number | null | undefined): string {
    if (n == null) return '';
    return n % 1 === 0 ? `${n}.0` : `${n}`;
}

/** A single overlapping seat avatar with the filled/ghosted treatment. */
function SeatAvatar({
    seat,
    size,
    overlap,
    palette,
    borderColor,
}: {
    seat: SupperSeat;
    size: number;
    overlap: boolean;
    palette: Palette;
    borderColor: string;
}) {
    return (
        <View
            style={{
                marginLeft: overlap ? -size * 0.3 : 0,
                borderRadius: size / 2,
                borderWidth: 2,
                borderColor,
                opacity: seat.filled ? 1 : GHOST_OPACITY,
            }}
        >
            <InitialsAvatar
                name={seat.display_name}
                avatarUrl={seat.avatar_url}
                size={size}
                palette={palette}
            />
        </View>
    );
}

export function SupperCard({ supper, viewerId, onOpen, onAddTake }: SupperCardProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const {
        restaurant,
        host_name,
        seat_count,
        filled_count,
        group_avg,
        viewer_filled,
        viewer_take,
        seats,
        photos,
    } = supper;

    const isEmpty = filled_count === 0;
    const isGathered = seat_count > 0 && filled_count >= seat_count;
    const isFilling = !isEmpty && !isGathered;
    // Only roster seats may add a take. The feed already gates this card to members,
    // so this is normally always true — but it keeps the CTA honest as defence-in-depth.
    const viewerIsSeat = viewerId ? seats.some((s) => s.user_id === viewerId) : true;
    const canAddTake = viewerIsSeat && !viewer_filled;

    // Avatar stack: filled first (reads as "filling up"), then pending.
    const stackSeats = [...seats].sort((a, b) => Number(b.filled) - Number(a.filled));
    const visibleSeats = stackSeats.slice(0, 5);
    const overflow = stackSeats.length - visibleSeats.length;

    // Pending seats other than the viewer → "waiting on …".
    const pendingNames = seats
        .filter((s) => !s.filled)
        .map((s) => s.display_name)
        .filter(Boolean) as string[];
    const waitingOn =
        pendingNames.length === 0
            ? null
            : pendingNames.length === 1
              ? `waiting on ${pendingNames[0]}`
              : `waiting on ${pendingNames.length} more`;

    const restaurantName = restaurant?.name ?? 'a spot';
    const cityLine = restaurant?.city ?? null;

    const progressText = isGathered
        ? "everyone's in"
        : `${filled_count} of ${seat_count} gathered`;

    return (
        <Pressable
            onPress={onOpen}
            style={({ pressed }) => [styles.pressable, pressed && onOpen ? { opacity: 0.92 } : undefined]}
            accessibilityRole="button"
            accessibilityLabel={`supper at ${restaurantName}, ${progressText}`}
        >
            <View style={[styles.card, { backgroundColor: palette.surfaceJournalLow }, Shadow.note]}>
                {/* Restaurant photo banner — only when we actually have a photo.
                    Restaurants have no reliable photo source, so rather than a big empty
                    grey box we skip the banner and lead the body with a small "supper"
                    kicker. The pooled "night" photos still show in the strip/mosaic below. */}
                {restaurant?.photo_url ? (
                    <View style={styles.bannerWrap}>
                        <Image source={{ uri: restaurant.photo_url }} style={styles.banner} resizeMode="cover" />
                        <View style={[styles.pill, { backgroundColor: palette.placesOverlayTint + 'd9' }]}>
                            <Text style={[styles.pillText, { color: palette.text }]}>supper</Text>
                        </View>
                    </View>
                ) : null}

                <View style={styles.body}>
                    {!restaurant?.photo_url ? (
                        <Text style={[styles.supperKicker, { color: palette.primary }]}>supper</Text>
                    ) : null}
                    {/* Restaurant + state badge */}
                    <View style={styles.titleRow}>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.restaurant, { color: palette.text }]} numberOfLines={1}>
                                {restaurantName}
                            </Text>
                            {cityLine ? (
                                <Text style={[styles.city, { color: palette.textMuted }]} numberOfLines={1}>
                                    {cityLine}
                                </Text>
                            ) : null}
                        </View>
                        {isGathered && group_avg != null ? (
                            <View style={[styles.avgChip, { backgroundColor: palette.tertiaryFixed }]}>
                                <Text style={[styles.avgNum, { color: palette.tertiary }]}>{group_avg.toFixed(1)}</Text>
                                <Text style={[styles.avgDenom, { color: palette.tertiary }]}>/5</Text>
                            </View>
                        ) : isEmpty ? (
                            <Text style={[styles.cornerNote, { color: palette.textMuted }]}>a table{'\n'}is set</Text>
                        ) : (
                            <Text style={[styles.cornerCount, { color: palette.textSecondary }]}>
                                {filled_count} of {seat_count}
                                {'\n'}
                                <Text style={[styles.cornerCountSub, { color: palette.textMuted }]}>gathered</Text>
                            </Text>
                        )}
                    </View>

                    {/* Avatar stack + quiet progress */}
                    <View style={styles.stackRow}>
                        <View style={styles.stack}>
                            {visibleSeats.map((seat, i) => (
                                <SeatAvatar
                                    key={seat.user_id}
                                    seat={seat}
                                    size={30}
                                    overlap={i > 0}
                                    palette={palette}
                                    borderColor={palette.surfaceJournalLow}
                                />
                            ))}
                        </View>
                        <Text style={[styles.progress, { color: palette.textMuted }]} numberOfLines={1}>
                            {overflow > 0 ? `+${overflow} · ` : ''}
                            {progressText}
                        </Text>
                    </View>

                    {/* State-specific middle ───────────────────────────────────── */}

                    {/* EMPTY — murmur */}
                    {isEmpty ? (
                        <Text style={[styles.murmur, { color: palette.textSecondary }]}>
                            <Text style={{ color: palette.primary }}>— </Text>
                            {host_name ? `${host_name} set a table. ` : ''}be the first to add your take.
                        </Text>
                    ) : null}

                    {/* FILLING, your seat filled — your pull-quote */}
                    {isFilling && viewer_filled && viewer_take ? (
                        <View style={[styles.quoteBox, { backgroundColor: palette.surfaceNote }]}>
                            <Text style={[styles.quoteKicker, { color: palette.primary }]}>
                                your take{viewer_take.rating != null ? ` · ${ratingLabel(viewer_take.rating)}` : ''}
                            </Text>
                            {viewer_take.content ? (
                                <Text style={[styles.quoteText, { color: palette.textSecondary }]} numberOfLines={2}>
                                    <Text style={{ color: palette.primary }}>— </Text>
                                    {viewer_take.content}
                                </Text>
                            ) : null}
                        </View>
                    ) : null}

                    {/* Pooled photos — strip while filling, mosaic when gathered */}
                    {photos.length > 0 && (isGathered || (isFilling && !viewer_filled)) ? (
                        isGathered ? (
                            <View style={styles.mosaic}>
                                {Array.from({ length: 4 }).map((_, i) =>
                                    photos[i] ? (
                                        <Image key={i} source={{ uri: photos[i] }} style={styles.mosaicTile} resizeMode="cover" />
                                    ) : (
                                        <View
                                            key={i}
                                            style={[styles.mosaicTile, { backgroundColor: palette.surfaceContainerHigh }]}
                                        />
                                    ),
                                )}
                            </View>
                        ) : (
                            <>
                                <Text style={[styles.stripKicker, { color: palette.textMuted }]}>on the table so far</Text>
                                <View style={styles.strip}>
                                    {photos.slice(0, 3).map((uri, i) => (
                                        <Image key={`${uri}-${i}`} source={{ uri }} style={styles.stripTile} resizeMode="cover" />
                                    ))}
                                    {photos.length > 3 ? (
                                        <View style={[styles.stripTile, styles.stripMore, { backgroundColor: palette.surfaceContainerHigh }]}>
                                            <Text style={[styles.stripMoreText, { color: palette.textMuted }]}>+{photos.length - 3}</Text>
                                        </View>
                                    ) : null}
                                </View>
                            </>
                        )
                    ) : null}

                    {/* Action row ──────────────────────────────────────────────── */}
                    {!canAddTake ? (
                        <View style={styles.actionRow}>
                            <Text style={[styles.seeTable, { color: palette.primary }]}>see the table →</Text>
                            {isFilling && waitingOn ? (
                                <Text style={[styles.waiting, { color: palette.textMuted }]} numberOfLines={1}>
                                    {waitingOn}
                                </Text>
                            ) : null}
                            {isGathered && group_avg != null ? (
                                <View style={styles.gatheredMeta}>
                                    <Ionicons name="people-outline" size={15} color={palette.textMuted} />
                                    <Text style={[styles.waiting, { color: palette.textMuted }]}>{filled_count} gathered</Text>
                                </View>
                            ) : null}
                        </View>
                    ) : (
                        <Pressable
                            onPress={onAddTake}
                            style={({ pressed }) => [
                                styles.cta,
                                { backgroundColor: palette.primary },
                                pressed ? { opacity: 0.9 } : undefined,
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel="add your take to this supper"
                        >
                            <Text style={styles.ctaText}>add your take</Text>
                        </Pressable>
                    )}
                </View>
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    pressable: {
        marginBottom: Spacing.sm,
    },
    card: {
        borderRadius: 20,
        borderWidth: 0,
        overflow: 'hidden',
    },
    bannerWrap: {
        height: 140,
        width: '100%',
        position: 'relative',
    },
    banner: {
        width: '100%',
        height: '100%',
    },
    pill: {
        position: 'absolute',
        top: 12,
        left: 12,
        paddingHorizontal: 11,
        paddingVertical: 5,
        borderRadius: 999,
    },
    pillText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
    },
    supperKicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        marginBottom: -4,
    },
    body: {
        padding: Spacing.md,
        gap: 12,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
    },
    restaurant: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 25,
        letterSpacing: -0.3,
        lineHeight: 28,
    },
    city: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10,
        letterSpacing: 1,
        textTransform: 'uppercase',
        marginTop: 5,
    },
    cornerNote: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        textAlign: 'right',
        lineHeight: 15,
    },
    cornerCount: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
        textAlign: 'right',
        lineHeight: 15,
    },
    cornerCountSub: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 10,
    },
    avgChip: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 2,
        paddingHorizontal: 11,
        paddingVertical: 6,
        borderRadius: 999,
    },
    avgNum: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 20,
        lineHeight: 22,
    },
    avgDenom: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 11,
    },
    stackRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    stack: {
        flexDirection: 'row',
    },
    progress: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        flex: 1,
    },
    murmur: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 16,
        lineHeight: 24,
    },
    quoteBox: {
        borderRadius: 14,
        padding: 13,
        gap: 7,
    },
    quoteKicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
    },
    quoteText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
        lineHeight: 21,
    },
    stripKicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
    },
    strip: {
        flexDirection: 'row',
        gap: 6,
        marginTop: -4,
    },
    stripTile: {
        width: 64,
        height: 64,
        borderRadius: 10,
    },
    stripMore: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    stripMoreText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11,
    },
    mosaic: {
        flexDirection: 'row',
        gap: 6,
    },
    mosaicTile: {
        flex: 1,
        aspectRatio: 1,
        borderRadius: 9,
    },
    actionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
    },
    seeTable: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
    },
    waiting: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
    },
    gatheredMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    cta: {
        height: 48,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
    },
    ctaText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 15,
        color: '#fff',
    },
});
