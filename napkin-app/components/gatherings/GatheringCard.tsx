/**
 * GatheringCard — the "gather the table" feed card (TICKET-095, counter-dates
 * TICKET-127).
 *
 * An invitation object: a white note card (archetype 2 — the only white card on
 * the cream feed, so a future plan reads differently from a logged past) with a
 * calendar leaf for the date, the host's murmur, and a seat ledger that answers
 * the card's whole question at a glance: who's in · who can't · who hasn't said.
 *
 * TICKET-127 adds the two things the group chat actually negotiates:
 *   • why this place — a `pinned from tiktok` line that taps out to the clip when
 *     the host's wishlist pin carries an import source URL.
 *   • counter-dates — a third RSVP, `can't — pick a date`, opening the same date
 *     picker family as GatherSheet; the member's counter renders as a chip
 *     (`you · sat 12`), others' counters name them. When counters cluster the card
 *     surfaces `sat 12 works for 3 of 4` (pure client counting), and the HOST can
 *     tap a counter (or that alignment line) to move the gather there. A re-dated
 *     card shows `date moved · was <old>` until the viewer answers again.
 *
 * Heirloom: italic Newsreader for the restaurant name and the date numeral,
 * Manrope for labels, ghosted warm border, ambient Shadow.note, quiet text —
 * never a progress bar. One accent: terracotta.
 *
 * Card body tap → the restaurant page. Cancelled rows never reach the client.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Linking, Modal, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { InitialsAvatar } from '@/components/suppers';
import { OwnerActionsSheet } from '@/components/common';
import {
    useRsvpGathering,
    useCancelGathering,
    useDeleteGathering,
    useRescheduleGathering,
} from '@/hooks/gatherings';
import type { GatheringCardActivity, GatheringSeat } from '@/hooks/tables/useTableActivity';

type Palette = typeof Colors.light;

const GHOST_OPACITY = 0.34;
const STACK_MAX = 4;
const MAX_DAYS_AHEAD = 90;

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

/** 'YYYY-MM-DD' → 'sat 12' (lowercase weekday + day) — the counter/meta grammar. */
function shortDate(ymd: string): string {
    const d = new Date(`${ymd}T00:00:00`);
    if (Number.isNaN(d.getTime())) return ymd;
    const wd = d.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
    return `${wd} ${d.getDate()}`;
}

/** Start of the day n days from now (device-local; the server re-validates HKT). */
function dayFromNow(n: number): Date {
    const d = new Date();
    d.setDate(d.getDate() + n);
    d.setHours(0, 0, 0, 0);
    return d;
}

/** Local-time YYYY-MM-DD (never toISOString — UTC can shift the day). */
function toYMD(d: Date): string {
    return d.toLocaleDateString('en-CA');
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
    const del = useDeleteGathering();
    const reschedule = useRescheduleGathering();

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
        counters = [],
        source_url = null,
        source_type = null,
        rescheduled_from = null,
    } = gathering;

    const isHost = !!viewerId && viewerId === host_user_id;
    const isProposed = status === 'proposed';
    const isDispatched = status === 'dispatched';
    const isExpired = status === 'expired';

    // "change" re-opens the controls after the viewer already answered.
    const [changing, setChanging] = useState(false);
    const showControls = isProposed && !isHost && (viewer_response === null || changing);

    // Counter-date picker (same DateTimePicker family as GatherSheet).
    const [counterPickerVisible, setCounterPickerVisible] = useState(false);
    const [counterDate, setCounterDate] = useState<Date>(() => dayFromNow(1));

    const [ownerSheet, setOwnerSheet] = useState(false);

    const supperCancelled = isDispatched && !supper_id;
    const canClear = isHost && (isExpired || supperCancelled);

    const leaf = dateLeaf(gather_on);
    const ins = orderSeats(seats.filter((s) => s.response === 'in'), viewerId);
    const outs = orderSeats(seats.filter((s) => s.response === 'out'), viewerId);
    // Waiting = still undecided; a counter is a definitive answer, not "waiting".
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

    // Alignment (AC11): the best counter date, shown only when it clusters (>= 2)
    // AND beats the current date's in-count. m = table member count.
    const memberCount = seats.length;
    const counterTally = new Map<string, number>();
    for (const c of counters) {
        if (c.counter_on === gather_on) continue; // never surface the current date
        counterTally.set(c.counter_on, (counterTally.get(c.counter_on) ?? 0) + 1);
    }
    let bestCounterDate: string | null = null;
    let bestCounterN = 0;
    for (const [date, n] of counterTally) {
        if (n > bestCounterN) {
            bestCounterN = n;
            bestCounterDate = date;
        }
    }
    const showAlignment =
        isProposed && !!bestCounterDate && bestCounterN >= 2 && bestCounterN > in_count;

    // "date moved · was <old>" until the viewer re-answers on the new date.
    const showDateMoved = isProposed && !!rescheduled_from && viewer_response === null;

    // Source line (AC1/AC2): only when the host's pin carries a URL.
    const srcType = source_type ? source_type.toLowerCase().replace(/_/g, ' ') : null;
    const sourceLabel = source_url ? `pinned from ${srcType ?? 'a link'}` : null;

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

    const submitCounter = (d: Date) => {
        setCounterPickerVisible(false);
        setChanging(false);
        rsvp.mutate({ gathering_id: id, table_id, response: 'counter', counter_on: toYMD(d) });
    };

    const handleCounterChange = (event: DateTimePickerEvent, selected?: Date) => {
        // Android's picker is a system dialog — it returns the chosen date directly.
        if (Platform.OS === 'android') {
            setCounterPickerVisible(false);
            if (event.type === 'dismissed' || !selected) return;
            const next = new Date(selected);
            next.setHours(0, 0, 0, 0);
            submitCounter(next);
            return;
        }
        if (!selected) return;
        const next = new Date(selected);
        next.setHours(0, 0, 0, 0);
        setCounterDate(next);
    };

    // Host taps a counter (or the alignment line) → move the gather there.
    const handleMoveTo = (date: string) => {
        if (reschedule.isPending) return;
        Alert.alert(`move to ${shortDate(date)}?`, undefined, [
            { text: 'not now', style: 'cancel' },
            {
                text: 'move',
                onPress: () =>
                    reschedule.mutate(
                        { gathering_id: id, table_id, new_date: date, old_date: gather_on },
                        { onError: () => Alert.alert("couldn't move the date", 'Try again.') },
                    ),
            },
        ]);
    };

    const handleCallItOff = () => {
        setOwnerSheet(false);
        cancel.mutate(
            { gathering_id: id, table_id },
            { onError: () => Alert.alert("Couldn't call it off", 'Try again.') },
        );
    };

    const handleClear = () => {
        setOwnerSheet(false);
        del.mutate(
            { gathering_id: id, table_id },
            { onError: () => Alert.alert("Couldn't clear it", 'Try again.') },
        );
    };

    const onCardLongPress =
        (isHost && isProposed) || canClear ? () => setOwnerSheet(true) : undefined;

    const openRestaurant = () => {
        if (!restaurant?.id) return;
        router.push({ pathname: '/restaurant/[id]', params: { id: restaurant.id } });
    };

    const openSupper = () => {
        if (!supper_id) return;
        router.push({ pathname: '/supper/[id]', params: { id: supper_id } });
    };

    const openSource = () => {
        if (source_url) Linking.openURL(source_url).catch(() => undefined);
    };

    return (
        <Pressable
            onPress={openRestaurant}
            onLongPress={onCardLongPress}
            delayLongPress={350}
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

                {/* Why this place — tap out to the pinned clip (AC1) */}
                {sourceLabel ? (
                    <Pressable onPress={openSource} hitSlop={6} style={styles.sourceRow}>
                        <Ionicons name="link-outline" size={13} color={palette.textMuted} />
                        <Text style={[styles.sourceText, { color: palette.textMuted }]} numberOfLines={1}>
                            {sourceLabel}
                        </Text>
                    </Pressable>
                ) : null}

                {/* date moved · was <old> (AC9) */}
                {showDateMoved && rescheduled_from ? (
                    <Text style={[styles.dateMoved, { color: palette.textMuted }]} numberOfLines={1}>
                        date moved · was {shortDate(rescheduled_from)}
                    </Text>
                ) : null}

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

                        {/* Counters — each member's proposed date (AC7). Host can tap one to move. */}
                        {isProposed && counters.length > 0 ? (
                            <View style={styles.counterWrap}>
                                {counters.map((c) => {
                                    const own = c.user_id === viewerId;
                                    const label = own ? 'you' : firstName(c.display_name) ?? 'someone';
                                    const chip = (
                                        <View
                                            style={[
                                                styles.counterChip,
                                                {
                                                    backgroundColor: own
                                                        ? palette.primaryMuted
                                                        : palette.surfaceContainerLow,
                                                },
                                            ]}
                                        >
                                            <Ionicons
                                                name="calendar-outline"
                                                size={12}
                                                color={own ? palette.primary : palette.textMuted}
                                            />
                                            <Text
                                                style={[
                                                    styles.counterChipText,
                                                    { color: own ? palette.primary : palette.textSecondary },
                                                ]}
                                            >
                                                {label} · {shortDate(c.counter_on)}
                                            </Text>
                                        </View>
                                    );
                                    return isHost ? (
                                        <Pressable
                                            key={c.user_id}
                                            onPress={() => handleMoveTo(c.counter_on)}
                                            disabled={reschedule.isPending}
                                            accessibilityRole="button"
                                            accessibilityLabel={`move to ${shortDate(c.counter_on)}`}
                                        >
                                            {chip}
                                        </Pressable>
                                    ) : (
                                        <View key={c.user_id}>{chip}</View>
                                    );
                                })}
                            </View>
                        ) : null}

                        {/* Alignment line (AC11) — host taps to move there in one tap. */}
                        {showAlignment && bestCounterDate ? (
                            isHost ? (
                                <Pressable
                                    onPress={() => handleMoveTo(bestCounterDate)}
                                    disabled={reschedule.isPending}
                                    style={({ pressed }) => [styles.alignRow, pressed && { opacity: 0.6 }]}
                                    accessibilityRole="button"
                                    accessibilityLabel={`move to ${shortDate(bestCounterDate)}, works for ${bestCounterN} of ${memberCount}`}
                                >
                                    <Text style={[styles.alignText, { color: palette.primary }]}>
                                        {shortDate(bestCounterDate)} works for {bestCounterN} of {memberCount}
                                    </Text>
                                    <Ionicons name="arrow-forward" size={14} color={palette.primary} />
                                </Pressable>
                            ) : (
                                <Text style={[styles.alignText, { color: palette.textSecondary }]}>
                                    {shortDate(bestCounterDate)} works for {bestCounterN} of {memberCount}
                                </Text>
                            )
                        ) : null}
                    </View>
                ) : null}

                {/* ── Footer zone ────────────────────────────────────────────── */}
                {isExpired ? (
                    <View style={styles.footerRow}>
                        <Text style={[styles.expired, styles.footerMeta, { color: palette.textMuted }]}>
                            didn&apos;t come together
                        </Text>
                        {canClear ? (
                            <Pressable
                                onPress={() => setOwnerSheet(true)}
                                disabled={del.isPending}
                                accessibilityRole="button"
                                accessibilityLabel="clear this gathering"
                                style={({ pressed }) => [
                                    styles.ghostPill,
                                    { borderColor: palette.ruleInkSoft, opacity: del.isPending ? 0.5 : pressed ? 0.7 : 1 },
                                ]}
                            >
                                <Text style={[styles.ghostPillText, { color: palette.textMuted }]}>clear</Text>
                            </Pressable>
                        ) : null}
                    </View>
                ) : null}

                {isDispatched ? (
                    supperCancelled ? (
                        <View style={styles.footerRow}>
                            <Text style={[styles.expired, styles.footerMeta, { color: palette.textMuted }]}>
                                supper cancelled
                            </Text>
                            {canClear ? (
                                <Pressable
                                    onPress={() => setOwnerSheet(true)}
                                    disabled={del.isPending}
                                    accessibilityRole="button"
                                    accessibilityLabel="clear this gathering"
                                    style={({ pressed }) => [
                                        styles.ghostPill,
                                        { borderColor: palette.ruleInkSoft, opacity: del.isPending ? 0.5 : pressed ? 0.7 : 1 },
                                    ]}
                                >
                                    <Text style={[styles.ghostPillText, { color: palette.textMuted }]}>clear</Text>
                                </Pressable>
                            ) : null}
                        </View>
                    ) : isHost || viewer_response === 'in' ? (
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
                        <Text style={[styles.expired, { color: palette.textMuted }]}>
                            gathered
                        </Text>
                    )
                ) : null}

                {isProposed && !isHost ? (
                    showControls ? (
                        <View style={styles.controlsWrap}>
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
                            {/* Third answer — sibling of "can't", carries a date (AC6). */}
                            <Pressable
                                onPress={() => setCounterPickerVisible(true)}
                                disabled={rsvp.isPending}
                                style={({ pressed }) => [styles.counterCta, pressed && { opacity: 0.6 }]}
                                accessibilityRole="button"
                                accessibilityLabel="can't — pick a date"
                            >
                                <Ionicons name="calendar-outline" size={14} color={palette.textMuted} />
                                <Text style={[styles.counterCtaText, { color: palette.textMuted }]}>
                                    can&apos;t — pick a date
                                </Text>
                            </Pressable>
                        </View>
                    ) : (
                        <View style={styles.footerRow}>
                            <View
                                style={[
                                    styles.stateChip,
                                    {
                                        backgroundColor:
                                            viewer_response === 'out'
                                                ? palette.surfaceContainerLow
                                                : palette.primaryMuted,
                                    },
                                ]}
                            >
                                <Ionicons
                                    name={
                                        viewer_response === 'in'
                                            ? 'checkmark-circle-outline'
                                            : viewer_response === 'counter'
                                              ? 'calendar-outline'
                                              : 'close-circle-outline'
                                    }
                                    size={14}
                                    color={viewer_response === 'out' ? palette.textMuted : palette.primary}
                                />
                                <Text
                                    style={[
                                        styles.stateChipText,
                                        { color: viewer_response === 'out' ? palette.textSecondary : palette.primary },
                                    ]}
                                >
                                    {viewer_response === 'in'
                                        ? "you're in"
                                        : viewer_response === 'counter'
                                          ? 'you countered'
                                          : "you can't make it"}
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
                            onPress={() => setOwnerSheet(true)}
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

            {/* Owner sheet — call it off while proposed, clear it once dead. */}
            <OwnerActionsSheet
                visible={ownerSheet}
                title={restaurantName}
                subtitle={isProposed ? 'Call off this gathering?' : 'Clear this from the table?'}
                actions={
                    isProposed
                        ? [{ label: 'Call it off', kind: 'destructive', onPress: handleCallItOff }]
                        : [{ label: 'Clear it', kind: 'destructive', onPress: handleClear }]
                }
                onCancel={() => setOwnerSheet(false)}
            />

            {/* Counter-date picker — same DateTimePicker family as GatherSheet
                (min today — same-day counters are the decide-tonight spirit; max +90d).
                iOS: inline in a sheet with a done button;
                Android: the system dialog confirms straight through handleCounterChange. */}
            {Platform.OS === 'ios' ? (
                <Modal
                    visible={counterPickerVisible}
                    transparent
                    animationType="slide"
                    onRequestClose={() => setCounterPickerVisible(false)}
                    statusBarTranslucent
                >
                    <Pressable
                        style={[styles.calendarScrim, { backgroundColor: palette.scrimDark }]}
                        onPress={() => setCounterPickerVisible(false)}
                        accessibilityLabel="close calendar"
                    />
                    <View style={[styles.calendarSheet, { backgroundColor: palette.surfaceNote }]}>
                        <View style={styles.calendarHeader}>
                            <Text style={[styles.calendarKicker, { color: palette.textMuted }]}>PICK A DATE</Text>
                            <Pressable onPress={() => submitCounter(counterDate)} hitSlop={14} accessibilityLabel="done">
                                <Text style={[styles.calendarDone, { color: palette.primary }]}>done</Text>
                            </Pressable>
                        </View>
                        <View style={styles.calendarPickerWrap}>
                            <DateTimePicker
                                value={counterDate}
                                mode="date"
                                display="inline"
                                minimumDate={dayFromNow(0)}
                                maximumDate={dayFromNow(MAX_DAYS_AHEAD)}
                                onChange={handleCounterChange}
                                accentColor={palette.primary}
                                themeVariant={scheme}
                            />
                        </View>
                    </View>
                </Modal>
            ) : counterPickerVisible ? (
                <DateTimePicker
                    value={counterDate}
                    mode="date"
                    display="calendar"
                    minimumDate={dayFromNow(1)}
                    maximumDate={dayFromNow(MAX_DAYS_AHEAD)}
                    onChange={handleCounterChange}
                />
            ) : null}
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
    // Source line — quiet Manrope meta, calendar/link icon; taps out to the clip.
    sourceRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginTop: -4,
    },
    sourceText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
        letterSpacing: 0.2,
    },
    dateMoved: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
        letterSpacing: 0.2,
        marginTop: -4,
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
    // Counter chips — one per member who proposed another date.
    counterWrap: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 6,
    },
    counterChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        height: 28,
        paddingHorizontal: 11,
        borderRadius: 999,
    },
    counterChipText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
    },
    alignRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    alignText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
        letterSpacing: 0.2,
    },
    footerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    footerMeta: {
        flex: 1,
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
    controlsWrap: {
        gap: 8,
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
    counterCta: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        height: 38,
    },
    counterCtaText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
    },
    // Counter-date picker overlay (mirrors GatherSheet's calendar sheet).
    calendarScrim: { ...StyleSheet.absoluteFillObject },
    calendarSheet: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        borderTopLeftRadius: Radius.xl,
        borderTopRightRadius: Radius.xl,
        paddingBottom: Spacing.xl,
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.08,
        shadowRadius: 24,
        elevation: 16,
    },
    calendarHeader: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.md,
        paddingBottom: Spacing.xs,
    },
    calendarKicker: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
    },
    calendarDone: { fontFamily: 'Manrope_700Bold', fontSize: 13 },
    calendarPickerWrap: {
        paddingHorizontal: Spacing.md,
        paddingTop: Spacing.xs,
    },
});
