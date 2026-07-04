/**
 * GatheringCard — the "gather the table" feed card (TICKET-095).
 *
 * An invitation object: a white note card (archetype 2 — the only white card on
 * the cream feed, so a future plan reads differently from a logged past) with a
 * calendar leaf for the date, the host's murmur, and a seat ledger that answers
 * the card's whole question at a glance: who's in · who can't · who hasn't said.
 *
 * Heirloom: italic Newsreader for the restaurant name and the date numeral
 * (content, like rating numerals), Manrope for labels, ghosted warm border,
 * ambient Shadow.note, quiet text — never a progress bar. One accent: terracotta.
 *
 * Three states from `status`:
 *   proposed   — leaf + murmur + ledger + RSVP footer ("I'm in" / "can't make
 *                it"; collapses to "you're in · change" after answering). The
 *                host instead sees a quiet "call it off" (Alert-confirmed).
 *   dispatched — the day came: footer becomes "gathered — see the table →"
 *                (routes to the auto-created supper; non-confirmed viewers get
 *                a plain "gathered" — the supper roster would 404 them).
 *   expired    — muted single line "didn't come together".
 *
 * Card body tap → the restaurant page. Cancelled rows never reach the client.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { InitialsAvatar } from '@/components/suppers';
import { useRsvpGathering, useCancelGathering } from '@/hooks/gatherings';
import type { GatheringCardActivity, GatheringSeat } from '@/hooks/tables/useTableActivity';

type Palette = typeof Colors.light;

const GHOST_OPACITY = 0.34;
const STACK_MAX = 4;

interface GatheringCardProps {
    gathering: GatheringCardActivity;
    /** The viewing user — decides host chrome vs the RSVP zone. */
    viewerId?: string;
}

/** 'YYYY-MM-DD' → the calendar-leaf pieces ("SUN", "5", "JUL"). */
function dateLeaf(ymd: string): { wd: string; day: string; mo: string } | null {
    const d = new Date(`${ymd}T00:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    return {
        wd: d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
        day: String(d.getDate()),
        mo: d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
    };
}

function firstName(name: string | null): string | null {
    if (!name) return null;
    return name.split(' ')[0] || null;
}

/** Viewer first (as "you"), then the host, then everyone else. */
function orderSeats(rows: GatheringSeat[], viewerId?: string): GatheringSeat[] {
    const score = (s: GatheringSeat) =>
        s.user_id === viewerId ? 0 : s.is_host ? 1 : 2;
    return [...rows].sort((a, b) => score(a) - score(b));
}

/** "you, Clara +2" — up to two names, the rest counted. */
function namesLine(rows: GatheringSeat[], viewerId?: string): string {
    const names: string[] = [];
    for (const s of rows) {
        if (names.length === 2) break;
        const n = s.user_id === viewerId ? 'you' : firstName(s.display_name);
        if (n) names.push(n);
    }
    const extra = rows.length - names.length;
    if (names.length === 0) return `${rows.length}`;
    return `${names.join(', ')}${extra > 0 ? ` +${extra}` : ''}`;
}

/** One ledger row: a small stack of seats + "in · you, Clara +1". */
function LedgerRow({
    rows,
    label,
    solid,
    viewerId,
    palette,
}: {
    rows: GatheringSeat[];
    label: string;
    solid: boolean;
    viewerId?: string;
    palette: Palette;
}) {
    const visible = rows.slice(0, STACK_MAX);
    return (
        <View style={styles.ledgerRow}>
            <View style={styles.stack}>
                {visible.map((seat, i) => (
                    <View
                        key={seat.user_id}
                        style={{
                            marginLeft: i > 0 ? -7 : 0,
                            borderRadius: 12,
                            borderWidth: 2,
                            borderColor: palette.surfaceNote,
                            opacity: solid ? 1 : GHOST_OPACITY,
                        }}
                    >
                        <InitialsAvatar
                            name={seat.display_name}
                            avatarUrl={seat.avatar_url}
                            size={22}
                            palette={palette}
                        />
                    </View>
                ))}
            </View>
            <Text style={styles.ledgerText} numberOfLines={1}>
                <Text style={[styles.ledgerLabel, { color: solid ? palette.primary : palette.textMuted }]}>
                    {label}
                </Text>
                <Text style={[styles.ledgerNames, { color: palette.textSecondary }]}>
                    {' · '}
                    {namesLine(rows, viewerId)}
                </Text>
            </Text>
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

    const leaf = dateLeaf(gather_on);
    const ins = orderSeats(seats.filter((s) => s.response === 'in'), viewerId);
    const outs = orderSeats(seats.filter((s) => s.response === 'out'), viewerId);
    const waiting = seats.filter((s) => s.response === null);
    const waitingNames = waiting
        .map((s) => (s.user_id === viewerId ? 'you' : firstName(s.display_name)))
        .filter(Boolean) as string[];
    const waitingLine =
        waiting.length === 0
            ? null
            : waiting.length === 1 && waitingNames[0]
              ? `waiting on ${waitingNames[0]}`
              : `waiting on ${waiting.length} more`;

    const restaurantName = restaurant?.name ?? 'a spot';
    const murmur = note
        ? note
        : isHost
          ? 'you want to gather the table'
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
            accessibilityLabel={`gathering at ${restaurantName} on ${gather_on}, ${in_count} in`}
        >
            <View
                style={[
                    styles.card,
                    { backgroundColor: palette.surfaceNote, borderColor: palette.divider },
                    Shadow.note,
                ]}
            >
                {/* Header — calendar leaf + masthead */}
                <View style={styles.headerRow}>
                    {leaf ? (
                        <View style={[styles.leaf, { backgroundColor: palette.surfaceJournalLow }]}>
                            <Text style={[styles.leafCap, { color: palette.textMuted }]}>{leaf.wd}</Text>
                            <Text style={[styles.leafDay, { color: palette.primary }]}>{leaf.day}</Text>
                            <Text style={[styles.leafCap, { color: palette.textMuted }]}>{leaf.mo}</Text>
                        </View>
                    ) : null}
                    <View style={styles.masthead}>
                        <Text style={[styles.kicker, { color: palette.textMuted }]}>gathering</Text>
                        <Text style={[styles.restaurant, { color: palette.text }]} numberOfLines={2}>
                            {restaurantName}
                        </Text>
                        {restaurant?.city ? (
                            <Text style={[styles.city, { color: palette.textMuted }]} numberOfLines={1}>
                                {restaurant.city}
                            </Text>
                        ) : null}
                    </View>
                </View>

                {/* Murmur — the note, else the host's ask */}
                <Text style={[styles.murmur, { color: palette.textSecondary }]} numberOfLines={2}>
                    <Text style={{ color: palette.primary }}>— </Text>
                    {murmur}
                </Text>

                {/* Seat ledger — who's in · who can't · who hasn't said */}
                {!isExpired ? (
                    <View style={styles.ledger}>
                        {ins.length > 0 ? (
                            <LedgerRow rows={ins} label="in" solid viewerId={viewerId} palette={palette} />
                        ) : null}
                        {outs.length > 0 ? (
                            <LedgerRow rows={outs} label="can't" solid={false} viewerId={viewerId} palette={palette} />
                        ) : null}
                        {isProposed && waitingLine ? (
                            <Text style={[styles.waiting, { color: palette.textMuted }]}>{waitingLine}</Text>
                        ) : null}
                    </View>
                ) : null}

                {/* ── Footer zone ────────────────────────────────────────────── */}
                {isExpired ? (
                    <Text style={[styles.expired, { color: palette.textMuted }]}>
                        didn&apos;t come together
                    </Text>
                ) : null}

                {isDispatched ? (
                    isHost || viewer_response === 'in' ? (
                        <View style={styles.footerRow}>
                            <Pressable
                                onPress={openSupper}
                                accessibilityRole="button"
                                accessibilityLabel="see the table"
                                style={({ pressed }) => [
                                    styles.ghostPill,
                                    { borderColor: palette.ruleInkSoft, opacity: pressed ? 0.7 : 1 },
                                ]}
                            >
                                <Text style={[styles.ghostPillText, { color: palette.primary }]}>see the table →</Text>
                            </Pressable>
                        </View>
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
                                    { backgroundColor: palette.surfaceContainerLow, opacity: pressed || rsvp.isPending ? 0.85 : 1 },
                                ]}
                                accessibilityRole="button"
                                accessibilityLabel="can't make it"
                            >
                                <Text style={[styles.outBtnText, { color: palette.textSecondary }]}>can&apos;t make it</Text>
                            </Pressable>
                        </View>
                    ) : (
                        <View style={styles.footerRow}>
                            <View
                                style={[
                                    styles.stateChip,
                                    {
                                        backgroundColor:
                                            viewer_response === 'in'
                                                ? palette.primaryMuted
                                                : palette.surfaceContainerLow,
                                    },
                                ]}
                            >
                                <Ionicons
                                    name={viewer_response === 'in' ? 'checkmark-circle-outline' : 'close-circle-outline'}
                                    size={14}
                                    color={viewer_response === 'in' ? palette.primary : palette.textMuted}
                                />
                                <Text
                                    style={[
                                        styles.stateChipText,
                                        { color: viewer_response === 'in' ? palette.primary : palette.textSecondary },
                                    ]}
                                >
                                    {viewer_response === 'in' ? "you're in" : "you can't make it"}
                                </Text>
                            </View>
                            <Pressable
                                onPress={() => setChanging(true)}
                                accessibilityRole="button"
                                accessibilityLabel="change your answer"
                                style={({ pressed }) => [
                                    styles.ghostPill,
                                    { borderColor: palette.ruleInkSoft, opacity: pressed ? 0.7 : 1 },
                                ]}
                            >
                                <Text style={[styles.ghostPillText, { color: palette.textMuted }]}>change</Text>
                            </Pressable>
                        </View>
                    )
                ) : null}

                {isProposed && isHost ? (
                    <View style={styles.footerRow}>
                        <Pressable
                            onPress={confirmCancel}
                            disabled={cancel.isPending}
                            accessibilityRole="button"
                            accessibilityLabel="call it off"
                            style={({ pressed }) => [
                                styles.ghostPill,
                                { borderColor: palette.ruleInkSoft, opacity: cancel.isPending ? 0.5 : pressed ? 0.7 : 1 },
                            ]}
                        >
                            <Text style={[styles.ghostPillText, { color: palette.textMuted }]}>call it off</Text>
                        </Pressable>
                    </View>
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
        borderRadius: 24,
        borderWidth: 1,
        padding: Spacing.md,
        gap: 14,
    },
    headerRow: {
        flexDirection: 'row',
        gap: 14,
    },
    leaf: {
        width: 56,
        borderRadius: 12,
        paddingVertical: 9,
        alignItems: 'center',
        gap: 1,
    },
    leafCap: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
    },
    leafDay: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 27,
        lineHeight: 30,
        letterSpacing: -0.5,
    },
    masthead: {
        flex: 1,
        gap: 3,
    },
    kicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
    },
    restaurant: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 23,
        letterSpacing: -0.3,
        lineHeight: 27,
    },
    city: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10,
        letterSpacing: 1,
        textTransform: 'uppercase',
        marginTop: 2,
    },
    murmur: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 16,
        lineHeight: 24,
    },
    ledger: {
        gap: 8,
    },
    ledgerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    stack: {
        flexDirection: 'row',
    },
    ledgerText: {
        flex: 1,
        fontSize: 12,
    },
    ledgerLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 12,
    },
    ledgerNames: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
    waiting: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
    },
    expired: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
    },
    // Footer vocabulary — a state chip (what you answered) + ghost pills (every
    // quiet action: change, call it off, see the table). One grammar, all states.
    footerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    stateChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        height: 34,
        paddingHorizontal: 13,
        borderRadius: 999,
    },
    stateChipText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
    },
    ghostPill: {
        height: 34,
        paddingHorizontal: 14,
        borderRadius: 999,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    ghostPillText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
    },
    rsvpRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    inBtn: {
        flex: 1,
        height: 44,
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
        flex: 1,
        height: 44,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
    },
    outBtnText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 14,
    },
});
