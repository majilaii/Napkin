/**
 * GatheringCard — the "gather the table" feed card (TICKET-095).
 *
 * A proposed future date at a restaurant. Structural/aesthetic reference is
 * SupperCard: warm journal card, italic Newsreader restaurant name, em-dash
 * murmur, seat avatars (in = solid, undecided/out = ghosted), quiet text
 * progress, ambient shadow, no 1px sectioning borders. One accent: terracotta.
 *
 * Three states from `status`:
 *   proposed   — kicker with the date, murmur, seats, RSVP zone (I'm in / can't;
 *                collapses to "you're in · change" after answering). The host
 *                instead sees a quiet "call it off" (Alert-confirmed cancel).
 *   dispatched — the day came: RSVP zone becomes "gathered — see the table →"
 *                (routes to the auto-created supper).
 *   expired    — muted single line "didn't come together".
 *
 * Card body tap → the restaurant page. Cancelled rows never reach the client.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { InitialsAvatar } from '@/components/suppers';
import { useRsvpGathering, useCancelGathering } from '@/hooks/gatherings';
import type { GatheringCardActivity, GatheringSeat } from '@/hooks/tables/useTableActivity';

type Palette = typeof Colors.light;

const GHOST_OPACITY = 0.34;

interface GatheringCardProps {
    gathering: GatheringCardActivity;
    /** The viewing user — decides host chrome vs the RSVP zone. */
    viewerId?: string;
}

/** 'YYYY-MM-DD' → "SAT · JUL 12" for the kicker. */
function fmtGatherOn(ymd: string): string {
    const d = new Date(`${ymd}T00:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    const wd = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
    const mo = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    return `${wd} · ${mo} ${d.getDate()}`;
}

function firstName(name: string | null): string | null {
    if (!name) return null;
    return name.split(' ')[0] || null;
}

function SeatDot({
    seat,
    size,
    overlap,
    palette,
    borderColor,
}: {
    seat: GatheringSeat;
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
                opacity: seat.response === 'in' ? 1 : GHOST_OPACITY,
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

export function GatheringCard({ gathering, viewerId }: GatheringCardProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;
    const router = useRouter();

    const rsvp = useRsvpGathering();
    const cancel = useCancelGathering();

    const {
        id,
        table_id,
        restaurant,
        host_user_id,
        host_name,
        note,
        gather_on,
        status,
        supper_id,
        seats,
        in_count,
        viewer_response,
    } = gathering;

    const isHost = !!viewerId && viewerId === host_user_id;
    const isProposed = status === 'proposed';
    const isDispatched = status === 'dispatched';
    const isExpired = status === 'expired';

    // "change" re-opens the two controls after the viewer already answered.
    const [changing, setChanging] = useState(false);
    const showControls = isProposed && !isHost && (viewer_response === null || changing);

    const visibleSeats = seats.slice(0, 6);
    const overflow = seats.length - visibleSeats.length;

    const restaurantName = restaurant?.name ?? 'a spot';
    const murmur = note
        ? note
        : `${firstName(host_name) ?? 'someone'} wants to gather the table`;

    const answer = (response: 'in' | 'out') => {
        setChanging(false);
        rsvp.mutate({ gathering_id: id, table_id, response });
    };

    const confirmCancel = () => {
        Alert.alert('call it off?', undefined, [
            { text: 'keep it', style: 'cancel' },
            {
                text: 'call it off',
                style: 'destructive',
                onPress: () => cancel.mutate({ gathering_id: id, table_id }),
            },
        ]);
    };

    const openRestaurant = () => {
        if (!restaurant?.id) return;
        router.push({ pathname: '/restaurant/[id]', params: { id: restaurant.id } });
    };

    const openSupper = () => {
        if (!supper_id) return;
        router.push({ pathname: '/supper/[id]', params: { id: supper_id } });
    };

    return (
        <Pressable
            onPress={openRestaurant}
            style={({ pressed }) => [styles.pressable, pressed ? { opacity: 0.92 } : undefined]}
            accessibilityRole="button"
            accessibilityLabel={`gathering at ${restaurantName}, ${in_count} in`}
        >
            <View style={[styles.card, { backgroundColor: palette.surfaceJournalLow }, Shadow.note]}>
                {/* Kicker — GATHERING · SAT · JUL 12 */}
                <Text style={[styles.kicker, { color: palette.textMuted }]}>
                    GATHERING{gather_on ? ' · ' : ''}
                    <Text style={{ color: palette.primary }}>{fmtGatherOn(gather_on)}</Text>
                </Text>

                {/* Murmur — the note, else the host's ask */}
                <Text style={[styles.murmur, { color: palette.textSecondary }]} numberOfLines={2}>
                    <Text style={{ color: palette.primary }}>— </Text>
                    {murmur}
                </Text>

                {/* Restaurant + city */}
                <View>
                    <Text style={[styles.restaurant, { color: palette.text }]} numberOfLines={1}>
                        {restaurantName}
                    </Text>
                    {restaurant?.city ? (
                        <Text style={[styles.city, { color: palette.textMuted }]} numberOfLines={1}>
                            {restaurant.city}
                        </Text>
                    ) : null}
                </View>

                {/* Seats — in solid, undecided/out ghosted, host first (server order) */}
                <View style={styles.stackRow}>
                    <View style={styles.stack}>
                        {visibleSeats.map((seat, i) => (
                            <SeatDot
                                key={seat.user_id}
                                seat={seat}
                                size={30}
                                overlap={i > 0}
                                palette={palette}
                                borderColor={palette.surfaceJournalLow}
                            />
                        ))}
                    </View>
                    <Text style={[styles.inMeta, { color: palette.textMuted }]} numberOfLines={1}>
                        {overflow > 0 ? `+${overflow} · ` : ''}
                        {in_count} in
                    </Text>
                </View>

                {/* ── State zone ─────────────────────────────────────────────── */}
                {isExpired ? (
                    <Text style={[styles.expired, { color: palette.textMuted }]}>
                        didn&apos;t come together
                    </Text>
                ) : null}

                {isDispatched ? (
                    isHost || viewer_response === 'in' ? (
                        <Pressable onPress={openSupper} hitSlop={6} accessibilityRole="button" accessibilityLabel="see the table">
                            <Text style={[styles.seeTable, { color: palette.primary }]}>
                                gathered — see the table →
                            </Text>
                        </Pressable>
                    ) : (
                        /* The supper roster is confirmed members only — supper-detail
                           404s everyone else, so don't link them into a dead end. */
                        <Text style={[styles.expired, { color: palette.textMuted }]}>
                            gathered
                        </Text>
                    )
                ) : null}

                {isProposed && !isHost ? (
                    showControls ? (
                        <View style={styles.rsvpRow}>
                            <Pressable
                                onPress={() => answer('in')}
                                disabled={rsvp.isPending}
                                style={({ pressed }) => [
                                    styles.inBtn,
                                    { backgroundColor: palette.primary, opacity: pressed || rsvp.isPending ? 0.85 : 1 },
                                ]}
                                accessibilityRole="button"
                                accessibilityLabel="I'm in"
                            >
                                <Text style={styles.inBtnText}>I&apos;m in</Text>
                            </Pressable>
                            <Pressable
                                onPress={() => answer('out')}
                                disabled={rsvp.isPending}
                                style={({ pressed }) => [
                                    styles.outBtn,
                                    { backgroundColor: palette.surfaceNote, opacity: pressed || rsvp.isPending ? 0.85 : 1 },
                                ]}
                                accessibilityRole="button"
                                accessibilityLabel="can't make it"
                            >
                                <Text style={[styles.outBtnText, { color: palette.textSecondary }]}>can&apos;t</Text>
                            </Pressable>
                        </View>
                    ) : (
                        <View style={styles.answeredRow}>
                            <Text style={[styles.answered, { color: palette.textSecondary }]}>
                                {viewer_response === 'in' ? "you're in" : "can't make it"}
                                <Text style={{ color: palette.textMuted }}> · </Text>
                            </Text>
                            <Pressable onPress={() => setChanging(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="change your answer">
                                <Text style={[styles.change, { color: palette.primary }]}>change</Text>
                            </Pressable>
                        </View>
                    )
                ) : null}

                {isProposed && isHost ? (
                    <Pressable
                        onPress={confirmCancel}
                        disabled={cancel.isPending}
                        hitSlop={6}
                        accessibilityRole="button"
                        accessibilityLabel="call it off"
                    >
                        <Text style={[styles.callOff, { color: palette.textMuted, opacity: cancel.isPending ? 0.5 : 1 }]}>
                            call it off
                        </Text>
                    </Pressable>
                ) : null}
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
        padding: Spacing.md,
        gap: 12,
    },
    kicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
    },
    murmur: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 16,
        lineHeight: 24,
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
    stackRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    stack: {
        flexDirection: 'row',
    },
    inMeta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        flex: 1,
    },
    expired: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
    },
    seeTable: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
    },
    rsvpRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    inBtn: {
        flex: 1,
        height: 42,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
    },
    inBtnText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 14,
        color: '#fff',
    },
    outBtn: {
        paddingHorizontal: 22,
        height: 42,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
    },
    outBtnText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 14,
    },
    answeredRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
    },
    answered: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
    },
    change: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
    },
    callOff: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
    },
});
