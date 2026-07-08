/**
 * GatheringDetail — the gathering card, unfolded (TICKET-136).
 *
 * The full-fidelity detail for a proposed/dispatched/expired gathering: who /
 * when / where / why, over the SAME GatheringCardActivity shape and the SAME
 * mutation hooks the feed card uses. Seven sections (masthead · host note · why
 * this place · when · who's coming · the spot · pinned in-flow footer) and the
 * full state/role footer matrix (spec §7). The restaurant is a deliberate
 * drill-in from "the spot" (`open restaurant →`) — never the tap target.
 *
 * Derivations come from the shared useGatheringViewModel (one brain with the
 * card). The picker is the shared CounterDatePicker. Cancel/delete call onBack on
 * success (the gathering is gone; feed invalidation removes it).
 *
 * Heirloom: warm cream surfaces, terracotta accent, Newsreader italic for
 * names/date/ratings, Manrope for kickers/labels/status, ghosted warm rules —
 * no 1px sectioning borders, no emoji in chrome, Colors[scheme] tokens only.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Alert, Linking, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { InitialsAvatar } from '@/components/suppers';
import { OwnerActionsSheet } from '@/components/common';
import {
    useRsvpGathering,
    useCancelGathering,
    useDeleteGathering,
    useRescheduleGathering,
    useGatheringViewModel,
} from '@/hooks/gatherings';
import { useRestaurantPage } from '@/hooks/restaurants/useRestaurantPage';
import type { GatheringCardActivity, GatheringSeat } from '@/hooks/tables/useTableActivity';
import { CounterDatePicker } from './CounterDatePicker';
import { dayFromNow, firstName, shortDate, toYMD } from './gatheringFormat';

type Palette = typeof Colors.light;

interface GatheringDetailProps {
    gathering: GatheringCardActivity;
    viewerId?: string;
    onBack: () => void;
    onOpenRestaurant: (restaurantId: string) => void;
    onOpenSupper: (supperId: string) => void;
}

/** 'YYYY-MM-DD' → "Sunday, July 12" (the big current-date line). */
function longDate(ymd: string): string {
    const d = new Date(`${ymd}T00:00:00`);
    if (Number.isNaN(d.getTime())) return ymd;
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

/** One rounded rating numeral (4 → "4.0"), or null. */
function tier(value: number | null | undefined): string | null {
    if (value == null) return null;
    return value % 1 === 0 ? `${value}.0` : value.toFixed(1);
}

/** who's-coming order: host → in → counter → undecided → out. */
function comingRank(s: GatheringSeat): number {
    if (s.is_host) return 0;
    if (s.response === 'in') return 1;
    if (s.response === 'counter') return 2;
    if (s.response == null) return 3;
    return 4;
}

export function GatheringDetail({
    gathering,
    viewerId,
    onBack,
    onOpenRestaurant,
    onOpenSupper,
}: GatheringDetailProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;

    const rsvp = useRsvpGathering();
    const cancel = useCancelGathering();
    const del = useDeleteGathering();
    const reschedule = useRescheduleGathering();

    const {
        id,
        table_id,
        restaurant,
        gather_on,
        supper_id,
        in_count,
        viewer_response,
        counters = [],
        source_url = null,
        seats,
        rescheduled_from = null,
    } = gathering;

    const vm = useGatheringViewModel(gathering, viewerId);
    const {
        isHost,
        isProposed,
        isDispatched,
        isExpired,
        supperCancelled,
        canClear,
        leaf,
        waiting,
        memberCount,
        bestCounterDate,
        bestCounterN,
        showAlignment,
        showDateMoved,
        sourceLabel,
        restaurantName,
        murmur,
    } = vm;

    // "change" re-opens the controls after the viewer already answered.
    const [changing, setChanging] = useState(false);
    const showControls = isProposed && !isHost && (viewer_response === null || changing);

    const [counterPickerVisible, setCounterPickerVisible] = useState(false);
    const [counterDate] = useState<Date>(() => dayFromNow(1));
    const [ownerSheet, setOwnerSheet] = useState(false);

    // "the spot" tiers — the full restaurant page (cached; doubles as a prefetch
    // making the `open restaurant →` tap instant). Monogram only, never photo_url.
    const { data: page } = useRestaurantPage(restaurant?.id ?? null, table_id);

    const counterByUser = useMemo(
        () => new Map(counters.map((c) => [c.user_id, c.counter_on])),
        [counters],
    );
    const comingSeats = useMemo(
        () => [...seats].sort((a, b) => comingRank(a) - comingRank(b)),
        [seats],
    );

    const answer = (response: 'in' | 'out') => {
        setChanging(false);
        rsvp.mutate({ gathering_id: id, table_id, response });
    };

    const submitCounter = (d: Date) => {
        setCounterPickerVisible(false);
        setChanging(false);
        rsvp.mutate({ gathering_id: id, table_id, response: 'counter', counter_on: toYMD(d) });
    };

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
            { onSuccess: onBack, onError: () => Alert.alert("Couldn't call it off", 'Try again.') },
        );
    };

    const handleClear = () => {
        setOwnerSheet(false);
        del.mutate(
            { gathering_id: id, table_id },
            { onSuccess: onBack, onError: () => Alert.alert("Couldn't clear it", 'Try again.') },
        );
    };

    const openSource = () => {
        if (source_url) Linking.openURL(source_url).catch(() => undefined);
    };

    // "the spot" tiers (omit a tier with no value).
    const youTier = tier(page?.personal.average);
    const tableTier = tier(page?.table_chip?.average);
    const googleTier = tier(page?.restaurant?.google_rating);
    const beenCount = page?.whos_been.length ?? 0;
    const cuisine = page?.restaurant?.cuisine ?? null;
    const metaBits = [restaurant?.city, cuisine].filter(Boolean) as string[];

    return (
        <View style={[styles.screen, { backgroundColor: palette.surface }]}>
            <Pressable
                onPress={onBack}
                hitSlop={10}
                style={styles.backRow}
                accessibilityRole="button"
                accessibilityLabel="back to the feed"
            >
                <Ionicons name="chevron-back" size={22} color={palette.text} />
                <Text style={[styles.backText, { color: palette.textMuted }]}>back</Text>
            </Pressable>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
                {/* 1 · Masthead */}
                <View style={styles.masthead}>
                    {leaf ? (
                        <View style={[styles.leaf, { backgroundColor: palette.surfaceJournalLow }]}>
                            <Text style={[styles.leafCap, { color: palette.textMuted }]}>{leaf.wd}</Text>
                            <Text style={[styles.leafDay, { color: palette.primary }]}>{leaf.day}</Text>
                            <Text style={[styles.leafCap, { color: palette.textMuted }]}>{leaf.mo}</Text>
                        </View>
                    ) : null}
                    <View style={styles.mastheadText}>
                        <Text style={[styles.kicker, { color: palette.textMuted }]}>gathering</Text>
                        <Text style={[styles.restaurant, { color: palette.text }]}>{restaurantName}</Text>
                        {metaBits.length > 0 ? (
                            <Text style={[styles.cityMeta, { color: palette.textMuted }]} numberOfLines={1}>
                                {metaBits.join(' · ')}
                            </Text>
                        ) : null}
                    </View>
                </View>

                {/* 2 · Host note */}
                <View style={styles.block}>
                    <Text style={[styles.murmur, { color: palette.textSecondary }]}>
                        <Text style={{ color: palette.primary }}>— </Text>
                        {murmur}
                    </Text>
                    <Text style={[styles.attribution, { color: palette.textMuted }]}>
                        {firstName(gathering.host_name) ?? 'someone'} · host
                    </Text>
                </View>

                {/* 3 · Why this place */}
                {sourceLabel ? (
                    <Pressable onPress={openSource} hitSlop={6} style={[styles.block, styles.sourceRow]}>
                        <Ionicons name="link-outline" size={14} color={palette.textMuted} />
                        <Text style={[styles.sourceText, { color: palette.textMuted }]} numberOfLines={1}>
                            {sourceLabel}
                        </Text>
                    </Pressable>
                ) : null}

                {/* 4 · when */}
                <View style={styles.section}>
                    <Text style={[styles.sectionKicker, { color: palette.textMuted }]}>when</Text>
                    <Text style={[styles.whenDate, { color: palette.text }]}>{longDate(gather_on)}</Text>
                    {isProposed ? (
                        <Text style={[styles.whenMeta, { color: palette.textMuted }]}>
                            {in_count} in{waiting.length > 0 ? ` · ${waiting.length} waiting` : ''}
                        </Text>
                    ) : null}

                    {showDateMoved && rescheduled_from ? (
                        <Text style={[styles.dateMoved, { color: palette.textMuted }]}>
                            date moved · was {shortDate(rescheduled_from)}
                        </Text>
                    ) : null}

                    {/* Counter chips — host can tap one to move the gather there. */}
                    {isProposed && counters.length > 0 ? (
                        <View style={styles.counterWrap}>
                            {counters.map((c) => {
                                const own = c.user_id === viewerId;
                                const label = own ? 'you' : firstName(c.display_name) ?? 'someone';
                                const chip = (
                                    <View
                                        style={[
                                            styles.counterChip,
                                            { backgroundColor: own ? palette.primaryMuted : palette.surfaceContainerLow },
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

                    {/* Alignment nudge — host taps to move there in one tap. */}
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
                            <Text style={[styles.alignText, styles.alignSolo, { color: palette.textSecondary }]}>
                                {shortDate(bestCounterDate)} works for {bestCounterN} of {memberCount}
                            </Text>
                        )
                    ) : null}
                </View>

                {/* 5 · who's coming */}
                <View style={styles.section}>
                    <Text style={[styles.sectionKicker, { color: palette.textMuted }]}>who&rsquo;s coming</Text>
                    {comingSeats.map((seat, i) => {
                        const isYou = seat.user_id === viewerId;
                        const name = isYou ? 'you' : seat.display_name ?? 'Member';
                        const solid = seat.response === 'in';
                        return (
                            <View
                                key={seat.user_id}
                                style={[
                                    styles.seatRow,
                                    i > 0 ? { borderTopWidth: 1, borderTopColor: palette.dividerSoft } : undefined,
                                ]}
                            >
                                <View style={{ opacity: solid ? 1 : 0.4 }}>
                                    <InitialsAvatar name={seat.display_name} avatarUrl={seat.avatar_url} size={34} palette={palette} />
                                </View>
                                <Text style={[styles.seatName, { color: palette.text }]} numberOfLines={1}>
                                    {name}
                                    {seat.is_host ? (
                                        <Text style={[styles.seatHostTag, { color: palette.textMuted }]}> · host</Text>
                                    ) : null}
                                </Text>
                                <SeatStatus seat={seat} counterOn={counterByUser.get(seat.user_id)} palette={palette} />
                            </View>
                        );
                    })}
                </View>

                {/* 6 · the spot */}
                {restaurant?.id ? (
                    <View style={styles.section}>
                        <Text style={[styles.sectionKicker, { color: palette.textMuted }]}>the spot</Text>
                        <View style={[styles.spotCard, { backgroundColor: palette.surfaceNote }, Shadow.note]}>
                            <View style={styles.spotHead}>
                                <InitialsAvatar name={restaurantName} avatarUrl={null} size={44} palette={palette} />
                                <View style={{ flex: 1, minWidth: 0 }}>
                                    <Text style={[styles.spotName, { color: palette.text }]} numberOfLines={1}>
                                        {restaurantName}
                                    </Text>
                                    {beenCount > 0 ? (
                                        <Text style={[styles.spotBeen, { color: palette.textMuted }]}>
                                            {beenCount} of you {beenCount === 1 ? 'has' : 'have'} been
                                        </Text>
                                    ) : null}
                                </View>
                            </View>

                            {youTier || tableTier || googleTier ? (
                                <View style={styles.tiers}>
                                    {youTier ? (
                                        <Text style={styles.tier}>
                                            <Text style={[styles.tierLabel, { color: palette.textMuted }]}>you </Text>
                                            <Text style={[styles.tierVal, { color: palette.primary }]}>{youTier}</Text>
                                        </Text>
                                    ) : null}
                                    {tableTier ? (
                                        <Text style={styles.tier}>
                                            <Text style={[styles.tierLabel, { color: palette.textMuted }]}>table </Text>
                                            <Text style={[styles.tierVal, { color: palette.secondary }]}>{tableTier}</Text>
                                        </Text>
                                    ) : null}
                                    {googleTier ? (
                                        <Text style={styles.tier}>
                                            <Text style={[styles.tierLabel, { color: palette.textMuted }]}>google </Text>
                                            <Text style={[styles.tierVal, { color: palette.tertiary }]}>{googleTier}</Text>
                                        </Text>
                                    ) : null}
                                </View>
                            ) : null}

                            <Pressable
                                onPress={() => onOpenRestaurant(restaurant.id)}
                                style={({ pressed }) => [styles.openSpot, pressed && { opacity: 0.6 }]}
                                accessibilityRole="button"
                                accessibilityLabel={`open ${restaurantName}`}
                            >
                                <Text style={[styles.openSpotText, { color: palette.primary }]}>open restaurant →</Text>
                            </Pressable>
                        </View>
                    </View>
                ) : null}

                {/* 7 · Pinned in-flow footer (top rule, not a fixed overlay) */}
                <View style={[styles.footer, { borderTopColor: palette.ruleInkSoft }]}>
                    {/* member · proposed · unanswered → I'm in · can't · pick another date */}
                    {isProposed && !isHost && showControls ? (
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
                                    accessibilityLabel="can't"
                                >
                                    <Text style={[styles.outBtnText, { color: palette.textSecondary }]}>can&apos;t</Text>
                                </Pressable>
                            </View>
                            <Pressable
                                onPress={() => setCounterPickerVisible(true)}
                                disabled={rsvp.isPending}
                                style={({ pressed }) => [styles.counterCta, pressed && { opacity: 0.6 }]}
                                accessibilityRole="button"
                                accessibilityLabel="can't — pick another date"
                            >
                                <Ionicons name="calendar-outline" size={14} color={palette.textMuted} />
                                <Text style={[styles.counterCtaText, { color: palette.textMuted }]}>
                                    can&apos;t — pick another date
                                </Text>
                            </Pressable>
                        </View>
                    ) : null}

                    {/* member · proposed · answered → state chip + change */}
                    {isProposed && !isHost && !showControls ? (
                        <View style={styles.footerRow}>
                            <View
                                style={[
                                    styles.stateChip,
                                    {
                                        backgroundColor:
                                            viewer_response === 'out' ? palette.surfaceContainerLow : palette.primaryMuted,
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
                                    size={15}
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
                    ) : null}

                    {/* host · proposed → call it off */}
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

                    {/* dispatched */}
                    {isDispatched ? (
                        supperCancelled ? (
                            <View style={styles.footerRow}>
                                <Text style={[styles.deadMeta, styles.footerMeta, { color: palette.textMuted }]}>
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
                            <Pressable
                                onPress={() => (supper_id ? onOpenSupper(supper_id) : undefined)}
                                accessibilityRole="button"
                                accessibilityLabel="see the table"
                                style={({ pressed }) => [
                                    styles.seeTable,
                                    { backgroundColor: palette.primary, opacity: pressed ? 0.9 : 1 },
                                ]}
                            >
                                <Text style={styles.seeTableText}>see the table →</Text>
                            </Pressable>
                        ) : (
                            <Text style={[styles.deadMeta, { color: palette.textMuted }]}>gathered</Text>
                        )
                    ) : null}

                    {/* expired */}
                    {isExpired ? (
                        <View style={styles.footerRow}>
                            <Text style={[styles.deadMeta, styles.footerMeta, { color: palette.textMuted }]}>
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
                </View>
            </ScrollView>

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

            <CounterDatePicker
                visible={counterPickerVisible}
                value={counterDate}
                onPick={submitCounter}
                onClose={() => setCounterPickerVisible(false)}
                palette={palette}
                scheme={scheme}
            />
        </View>
    );
}

/** Right-aligned per-seat status pill: in / hasn't answered / countered / can't. */
function SeatStatus({
    seat,
    counterOn,
    palette,
}: {
    seat: GatheringSeat;
    counterOn: string | undefined;
    palette: Palette;
}) {
    if (seat.response === 'in') {
        return (
            <View style={styles.statusWrap}>
                <Ionicons name="checkmark-circle-outline" size={15} color={palette.primary} />
                <Text style={[styles.statusText, { color: palette.primary }]}>in</Text>
            </View>
        );
    }
    if (seat.response === 'counter') {
        return (
            <Text style={[styles.statusText, { color: palette.tertiary }]}>
                countered{counterOn ? ` · ${shortDate(counterOn)}` : ''}
            </Text>
        );
    }
    if (seat.response === 'out') {
        return <Text style={[styles.statusText, { color: palette.textMuted }]}>can&apos;t</Text>;
    }
    return <Text style={[styles.statusText, { color: palette.textMuted }]}>hasn&rsquo;t answered</Text>;
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: Spacing.md, paddingVertical: 10 },
    backText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },

    // Masthead
    masthead: { flexDirection: 'row', gap: 14, paddingHorizontal: Spacing.lg, paddingTop: 4 },
    leaf: { width: 60, borderRadius: 14, paddingVertical: 11, alignItems: 'center', gap: 1 },
    leafCap: { fontFamily: 'Manrope_700Bold', fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase' },
    leafDay: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 32, lineHeight: 35, letterSpacing: -0.5 },
    mastheadText: { flex: 1, gap: 3, justifyContent: 'center' },
    kicker: { fontFamily: 'Manrope_700Bold', fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase' },
    restaurant: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 30, letterSpacing: -0.4, lineHeight: 34 },
    cityMeta: { fontFamily: 'Manrope_600SemiBold', fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', marginTop: 2 },

    // Host note
    block: { paddingHorizontal: Spacing.lg, marginTop: 20 },
    murmur: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 19, lineHeight: 27 },
    attribution: { fontFamily: 'Manrope_600SemiBold', fontSize: 11, letterSpacing: 0.4, marginTop: 8, textTransform: 'lowercase' },

    // Why this place
    sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    sourceText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 0.2 },

    // Sections
    section: { paddingHorizontal: Spacing.lg, marginTop: 26 },
    sectionKicker: { fontFamily: 'Manrope_700Bold', fontSize: 10, letterSpacing: 1.8, textTransform: 'uppercase', marginBottom: 10 },

    // when
    whenDate: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 24, letterSpacing: -0.3 },
    whenMeta: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 0.2, marginTop: 6 },
    dateMoved: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, letterSpacing: 0.2, marginTop: 8 },
    counterWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
    counterChip: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 30, paddingHorizontal: 12, borderRadius: 999 },
    counterChipText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
    alignRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
    alignText: { fontFamily: 'Manrope_700Bold', fontSize: 13, letterSpacing: 0.2 },
    alignSolo: { marginTop: 12 },

    // who's coming
    seatRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
    seatName: { flex: 1, fontFamily: 'Newsreader_400Regular_Italic', fontSize: 17 },
    seatHostTag: { fontFamily: 'Manrope_600SemiBold', fontSize: 11 },
    statusWrap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    statusText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },

    // the spot
    spotCard: { borderRadius: 18, padding: 15, gap: 14 },
    spotHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    spotName: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 20, letterSpacing: -0.2 },
    spotBeen: { fontFamily: 'Manrope_500Medium', fontSize: 12, marginTop: 3 },
    tiers: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
    tier: {},
    tierLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6 },
    tierVal: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 18 },
    openSpot: { alignSelf: 'flex-start' },
    openSpotText: { fontFamily: 'Manrope_700Bold', fontSize: 13, letterSpacing: 0.2 },

    // Footer
    footer: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, marginTop: 28, borderTopWidth: 1 },
    footerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    footerMeta: { flex: 1 },
    deadMeta: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 15 },
    controlsWrap: { gap: 10 },
    rsvpRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    inBtn: { flex: 1, height: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
    inBtnText: { fontFamily: 'Manrope_700Bold', fontSize: 15, color: '#fff' },
    outBtn: { flex: 1, height: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
    outBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
    counterCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 40 },
    counterCtaText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
    stateChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 14, borderRadius: 999 },
    stateChipText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
    ghostPill: { height: 38, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    ghostPillText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
    seeTable: { height: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
    seeTableText: { fontFamily: 'Manrope_700Bold', fontSize: 15, color: '#fff' },
});
