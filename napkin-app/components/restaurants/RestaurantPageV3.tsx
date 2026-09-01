import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, IconSize, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import type {
    PublicReviewCard,
    RestaurantPageRestaurant,
    TableNoteRow,
} from '@/hooks/restaurants/useRestaurantPage';
import type { RestaurantFeaturedList } from '@/hooks/restaurants/useRestaurantFeaturedLists';
import type { FriendsCohortMember, TableNotesGroup } from '@/lib/restaurantPageV3';
import { monthLabel, restaurantClosingTime } from '@/lib/restaurantPageV3';
import { hasHours, todaysHoursLine, weekHoursLines } from '@/lib/restaurantHours';

type Palette = typeof Colors.light;

function quietOpen(url: string) {
    void Linking.openURL(url).catch(() => undefined);
}

function SectionHeading({
    label,
    action,
    onAction,
    palette,
}: {
    label: string;
    action?: string;
    onAction?: () => void;
    palette: Palette;
}) {
    return (
        <View style={styles.sectionHeading}>
            <Text style={[Type.feedSectionKicker, { color: palette.textMuted }]}>{label}</Text>
            {action && onAction ? (
                <Pressable
                    onPress={onAction}
                    accessibilityRole="button"
                    accessibilityLabel={action.replace('›', '').trim()}
                    style={({ pressed }) => [styles.headingActionHit, pressed && styles.pressed]}
                >
                    <Text style={[styles.headingAction, { color: palette.primary }]}>{action}</Text>
                </Pressable>
            ) : null}
        </View>
    );
}

export function RestaurantTop({
    restaurant,
    meta,
    saved,
    saveDisabled,
    onBack,
    onSave,
    topInset,
    palette,
}: {
    restaurant: RestaurantPageRestaurant;
    meta: string;
    saved: boolean;
    saveDisabled: boolean;
    onBack: () => void;
    onSave: () => void;
    topInset: number;
    palette: Palette;
}) {
    return (
        <>
            <View style={[styles.topBar, { paddingTop: topInset + Spacing.sm }]}>
                <Pressable
                    onPress={onBack}
                    accessibilityRole="button"
                    accessibilityLabel="back"
                    style={({ pressed }) => [styles.topButton, pressed && styles.pressed]}
                >
                    <Ionicons name="chevron-back" size={IconSize.lg} color={palette.textSecondary} />
                </Pressable>
                <Pressable
                    onPress={onSave}
                    disabled={saveDisabled}
                    accessibilityRole="button"
                    accessibilityLabel={saved ? 'edit saved lists' : 'save restaurant'}
                    style={({ pressed }) => [
                        styles.topButton,
                        saveDisabled && styles.disabled,
                        pressed && styles.pressed,
                    ]}
                >
                    <Ionicons
                        name={saved ? 'bookmark' : 'bookmark-outline'}
                        size={IconSize.lg}
                        color={palette.primary}
                    />
                </Pressable>
            </View>
            <View style={styles.masthead}>
                <Text style={[styles.restaurantName, { color: palette.text }]}>
                    {restaurant.name}
                </Text>
                {meta ? (
                    <Text style={[Type.metadata, styles.mastheadMeta, { color: palette.textMuted }]}>
                        {meta}
                    </Text>
                ) : null}
            </View>
        </>
    );
}

type NumberTier = { value: number | null; meta: string };

export function RestaurantNumbersBand({
    you,
    friends,
    google,
    palette,
}: {
    you: NumberTier;
    friends: NumberTier;
    google: NumberTier;
    palette: Palette;
}) {
    const cells = [
        { label: 'YOU', tier: you, color: palette.amberBright, kicker: palette.textMuted },
        { label: 'FRIENDS', tier: friends, color: palette.amberBright, kicker: palette.textMuted },
        { label: 'GOOGLE', tier: google, color: palette.textMuted, kicker: palette.textFaint },
    ];
    return (
        <View style={[styles.numbersBand, { backgroundColor: palette.surfaceJournalLow }]}>
            {cells.map((cell) => (
                <View key={cell.label} style={styles.numberCell}>
                    <Text style={[styles.numberKicker, { color: cell.kicker }]}>{cell.label}</Text>
                    <Text style={[Type.rating, { color: cell.color }]}>
                        {cell.tier.value == null ? '—' : cell.tier.value.toFixed(1)}
                    </Text>
                    <Text style={[Type.metadata, { color: palette.textFaint }]}>{cell.tier.meta}</Text>
                </View>
            ))}
        </View>
    );
}

type UtilityAction = {
    key: string;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
};

export function RestaurantActions({
    saved,
    onLog,
    onPin,
    onDirections,
    onWebsite,
    onGather,
    palette,
}: {
    saved: boolean;
    onLog: () => void;
    onPin: () => void;
    onDirections: () => void;
    onWebsite?: () => void;
    onGather?: () => void;
    palette: Palette;
}) {
    const utilities: UtilityAction[] = [
        { key: 'pin', label: 'pin', icon: saved ? 'bookmark' : 'bookmark-outline', onPress: onPin },
        { key: 'directions', label: 'directions', icon: 'navigate-outline', onPress: onDirections },
        ...(onWebsite
            ? [{ key: 'website', label: 'website', icon: 'globe-outline' as const, onPress: onWebsite }]
            : []),
        ...(onGather
            ? [{ key: 'gather', label: 'gather', icon: 'people-outline' as const, onPress: onGather }]
            : []),
    ];
    const twoColumn = utilities.length === 4;
    return (
        <View style={styles.actions}>
            <Pressable
                onPress={onLog}
                accessibilityRole="button"
                accessibilityLabel="log this meal"
                style={({ pressed }) => [
                    styles.primaryAction,
                    { backgroundColor: palette.primary },
                    pressed && styles.ctaPressed,
                ]}
            >
                <Ionicons name="add" size={IconSize.md} color={palette.textInverse} />
                <Text style={[styles.primaryActionText, { color: palette.textInverse }]}>LOG THIS MEAL</Text>
            </Pressable>
            <View style={styles.utilityRow}>
                {utilities.map((action) => (
                    <Pressable
                        key={action.key}
                        onPress={action.onPress}
                        accessibilityRole="button"
                        accessibilityLabel={action.label}
                        style={({ pressed }) => [
                            styles.utilityAction,
                            twoColumn ? styles.utilityHalf : styles.utilityFlexible,
                            { backgroundColor: palette.surfaceJournal },
                            pressed && styles.pressed,
                        ]}
                    >
                        <Ionicons name={action.icon} size={IconSize.md} color={palette.textSecondary} />
                        <Text style={[styles.utilityActionText, { color: palette.textSecondary }]}>
                            {action.label}
                        </Text>
                    </Pressable>
                ))}
            </View>
        </View>
    );
}

function QuoteCard({
    note,
    name,
    rating,
    visitedAt,
    suffix,
    onPress,
    palette,
}: {
    note: string;
    name: string;
    rating: number | null;
    visitedAt: string;
    suffix?: string;
    onPress?: () => void;
    palette: Palette;
}) {
    const content = (
        <View style={[styles.quoteCard, { backgroundColor: palette.surfaceNote }, Shadow.ambient]}>
            <Text style={[Type.quote, styles.quoteBody, { color: palette.textSoft }]}>
                {`— ${note}`}
            </Text>
            <View style={styles.quoteAttribution}>
                <Text style={[styles.quoteName, { color: palette.text }]}>{name}</Text>
                <Text style={[styles.quoteRating, { color: palette.amberBright }]}>
                    {rating == null ? '—' : rating.toFixed(1)}
                </Text>
                <Text style={[Type.metadata, { color: palette.textFaint }]}>
                    {[monthLabel(visitedAt), suffix].filter(Boolean).join(' · ')}
                </Text>
            </View>
        </View>
    );
    if (!onPress) return content;
    return (
        <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
            {content}
        </Pressable>
    );
}

export function FriendsNotesSection({
    cohort,
    total,
    onSeeAll,
    onReviewPress,
    palette,
}: {
    cohort: FriendsCohortMember[];
    total: number;
    onSeeAll: () => void;
    onReviewPress: (review: PublicReviewCard) => void;
    palette: Palette;
}) {
    if (total <= 0) return null;
    const visible = cohort.slice(0, 2);
    return (
        <View style={styles.section}>
            <SectionHeading
                label={visible.length > 0 ? 'FROM FRIENDS' : 'REVIEWS'}
                action={`all ${total} reviews ›`}
                onAction={onSeeAll}
                palette={palette}
            />
            {visible.map(({ review }) => (
                <QuoteCard
                    key={review.entry_id}
                    note={review.note_excerpt}
                    name={review.display_name}
                    rating={review.rating}
                    visitedAt={review.created_at}
                    onPress={() => onReviewPress(review)}
                    palette={palette}
                />
            ))}
        </View>
    );
}

export function TableNotesSection({
    group,
    onSeeAll,
    onNotePress,
    palette,
}: {
    group: TableNotesGroup | null;
    onSeeAll: (tableId: string) => void;
    onNotePress: (row: TableNoteRow) => void;
    palette: Palette;
}) {
    if (!group) return null;
    return (
        <View style={styles.section}>
            <SectionHeading
                label={group.table_name ? `FROM ${group.table_name.toUpperCase()}` : 'FROM YOUR TABLE'}
                action={`all ${group.rows.length} ›`}
                onAction={() => onSeeAll(group.table_id)}
                palette={palette}
            />
            {group.visibleRows.map((row) => (
                <QuoteCard
                    key={`${row.entry_id}:${row.table_id}`}
                    note={row.note}
                    name={row.author.display_name}
                    rating={row.rating}
                    visitedAt={row.visited_at}
                    suffix="gathered"
                    onPress={() => onNotePress(row)}
                    palette={palette}
                />
            ))}
        </View>
    );
}

export function FriendsSpread({
    bins,
    mode,
    palette,
}: {
    bins: number[];
    mode: number | null;
    palette: Palette;
}) {
    const max = Math.max(...bins, 1);
    const modeIndex = mode == null ? -1 : Math.round(mode * 2) - 1;
    return (
        <View style={styles.section}>
            <SectionHeading label="THE SPREAD" palette={palette} />
            <View style={styles.spreadBars}>
                {bins.map((count, index) => (
                    <View
                        key={index}
                        style={[
                            styles.spreadBar,
                            {
                                height: Math.max(4, (count / max) * 64),
                                backgroundColor: count === 0
                                    ? palette.surfaceJournalHi
                                    : index === modeIndex
                                        ? palette.amberBright
                                        : palette.tertiaryFixed,
                            },
                        ]}
                    />
                ))}
            </View>
            <View style={styles.spreadFooter}>
                <Text style={[Type.metadata, { color: palette.textFaint }]}>1</Text>
                <Text style={[Type.metadata, { color: palette.textFaint }]}>
                    friends land on{' '}
                    <Text style={[Type.ratingCompact, { color: palette.amberBright }]}>
                        {mode == null ? '—' : Number.isInteger(mode) ? mode.toFixed(0) : mode.toFixed(1)}
                    </Text>
                </Text>
                <Text style={[Type.metadata, { color: palette.textFaint }]}>5</Text>
            </View>
        </View>
    );
}

export function FeaturedListsSection({
    rows,
    onPress,
    palette,
}: {
    rows: RestaurantFeaturedList[];
    onPress: (listId: string) => void;
    palette: Palette;
}) {
    if (rows.length === 0) return null;
    const tints = [
        palette.plateAmber,
        palette.plateOlive,
        palette.plateRose,
        palette.plateGrey,
        palette.plateSlate,
        palette.plateSand,
    ];
    return (
        <View style={styles.section}>
            <SectionHeading label="IN LISTS" palette={palette} />
            <View style={styles.listChips}>
                {rows.map((list, index) => {
                    const owner = list.owner_display_name
                        ?? (list.owner_username ? `@${list.owner_username}` : 'someone');
                    return (
                        <Pressable
                            key={list.id}
                            onPress={() => onPress(list.id)}
                            accessibilityRole="button"
                            accessibilityLabel={`${list.title}, ${list.entry_count} spots, ${owner}`}
                            style={({ pressed }) => [
                                styles.listChip,
                                { backgroundColor: tints[index % tints.length] },
                                pressed && styles.pressed,
                            ]}
                        >
                            <Text style={[styles.listTitle, { color: palette.text }]}>{list.title}</Text>
                            <Text style={[Type.metadata, { color: palette.textMuted }]}>
                                {`${list.entry_count} spots · ${owner}`}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}

function DetailRow({
    icon,
    copy,
    action,
    onPress,
    last,
    palette,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    copy: string;
    action?: string;
    onPress?: () => void;
    last?: boolean;
    palette: Palette;
}) {
    const row = (
        <View style={styles.detailRow}>
            <Ionicons name={icon} size={18} color={palette.textSecondary} />
            <Text style={[styles.detailCopy, { color: palette.text }]}>{copy}</Text>
            {action ? <Text style={[styles.detailAction, { color: palette.primary }]}>{action}</Text> : null}
        </View>
    );
    return (
        <>
            {onPress ? (
                <Pressable
                    onPress={onPress}
                    accessibilityRole="button"
                    accessibilityLabel={`${copy}${action ? `, ${action}` : ''}`}
                    style={({ pressed }) => pressed && styles.pressed}
                >
                    {row}
                </Pressable>
            ) : row}
            {!last ? <View style={[styles.divider, { backgroundColor: palette.dividerSoft }]} /> : null}
        </>
    );
}

export function RestaurantDetails({
    restaurant,
    directionsUrl,
    palette,
}: {
    restaurant: RestaurantPageRestaurant;
    directionsUrl: string;
    palette: Palette;
}) {
    const [hoursExpanded, setHoursExpanded] = useState(false);
    const today = todaysHoursLine(restaurant.hours);
    const closes = restaurantClosingTime(restaurant.hours, new Date());
    const hoursCopy = closes
        ? `open · until ${closes}`
        : today === 'closed'
            ? 'closed'
            : today || 'hours';
    const week = weekHoursLines(restaurant.hours);
    const rows = [
        restaurant.address ? 'address' : null,
        hasHours(restaurant.hours) ? 'hours' : null,
        restaurant.phone ? 'phone' : null,
        restaurant.website ? 'website' : null,
    ].filter(Boolean);
    if (rows.length === 0) return null;
    const lastRow = rows.at(-1);
    return (
        <View style={[styles.section, styles.detailsSection]}>
            <SectionHeading label="DETAILS" palette={palette} />
            {restaurant.address ? (
                <DetailRow
                    icon="location-outline"
                    copy={restaurant.address}
                    action="directions"
                    onPress={() => quietOpen(directionsUrl)}
                    last={lastRow === 'address'}
                    palette={palette}
                />
            ) : null}
            {hasHours(restaurant.hours) ? (
                <>
                    <DetailRow
                        icon="time-outline"
                        copy={hoursCopy}
                        action={hoursExpanded ? 'less' : 'more'}
                        onPress={() => setHoursExpanded((value) => !value)}
                        last={hoursExpanded || lastRow === 'hours'}
                        palette={palette}
                    />
                    {hoursExpanded ? (
                        <View style={styles.weekBlock}>
                            {week.map((line) => (
                                <View key={`${line.day}:${line.hours}`} style={styles.weekRow}>
                                    <Text style={[Type.metadata, { color: line.isToday ? palette.text : palette.textMuted }]}>
                                        {line.day}
                                    </Text>
                                    <Text style={[Type.metadata, { color: line.isToday ? palette.text : palette.textMuted }]}>
                                        {line.hours}
                                    </Text>
                                </View>
                            ))}
                            {lastRow !== 'hours' ? (
                                <View style={[styles.divider, { backgroundColor: palette.dividerSoft }]} />
                            ) : null}
                        </View>
                    ) : null}
                </>
            ) : null}
            {restaurant.phone ? (
                <DetailRow
                    icon="call-outline"
                    copy={restaurant.phone}
                    onPress={() => quietOpen(`tel:${restaurant.phone!.replace(/\s/g, '')}`)}
                    last={lastRow === 'phone'}
                    palette={palette}
                />
            ) : null}
            {restaurant.website ? (
                <DetailRow
                    icon="globe-outline"
                    copy="website"
                    onPress={() => quietOpen(
                        restaurant.website!.startsWith('http')
                            ? restaurant.website!
                            : `https://${restaurant.website}`,
                    )}
                    last
                    palette={palette}
                />
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    pressed: { opacity: 0.8 },
    ctaPressed: { opacity: 0.85 },
    disabled: { opacity: 0.5 },
    topBar: {
        minHeight: 52,
        paddingHorizontal: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    topButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    masthead: { paddingHorizontal: 20, paddingTop: Spacing.xs },
    restaurantName: {
        fontFamily: 'Newsreader_600SemiBold',
        fontSize: 34,
        lineHeight: 38,
        letterSpacing: -0.4,
    },
    mastheadMeta: { marginTop: Spacing.xs },
    numbersBand: {
        marginHorizontal: 20,
        marginTop: 18,
        borderRadius: Radius.lg,
        paddingHorizontal: Spacing.md,
        paddingVertical: 14,
        flexDirection: 'row',
        alignItems: 'baseline',
    },
    numberCell: { flex: 1, gap: 1 },
    numberKicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        lineHeight: 15,
        letterSpacing: 1.2,
    },
    actions: { paddingHorizontal: 20, paddingTop: 18, gap: 10 },
    primaryAction: {
        height: Spacing.xxl,
        borderRadius: Radius.full,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.sm,
    },
    primaryActionText: {
        fontFamily: 'Manrope_800ExtraBold',
        fontSize: 13,
        letterSpacing: 0.6,
    },
    utilityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    utilityAction: {
        height: 44,
        borderRadius: Radius.full,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingHorizontal: Spacing.sm,
    },
    utilityFlexible: { flex: 1 },
    utilityHalf: { flexBasis: '48%', flexGrow: 1 },
    utilityActionText: { fontFamily: 'Manrope_700Bold', fontSize: 13 },
    section: { paddingHorizontal: 20, marginTop: Spacing.lg + 2 },
    sectionHeading: {
        minHeight: 40,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: Spacing.sm,
    },
    headingActionHit: { minHeight: 40, justifyContent: 'center' },
    headingAction: { fontFamily: 'Manrope_700Bold', fontSize: 13, lineHeight: 19 },
    quoteCard: {
        borderRadius: Radius.lg,
        paddingHorizontal: 14,
        paddingVertical: 13,
        marginBottom: Spacing.sm,
    },
    quoteBody: { lineHeight: 22 },
    quoteAttribution: {
        flexDirection: 'row',
        alignItems: 'baseline',
        flexWrap: 'wrap',
        gap: Spacing.sm,
        marginTop: Spacing.sm,
    },
    quoteName: { fontFamily: 'Manrope_700Bold', fontSize: 13, lineHeight: 19 },
    quoteRating: {
        ...Type.ratingCompact,
        fontSize: 15,
        lineHeight: 19,
    },
    spreadBars: {
        height: 64,
        marginTop: Spacing.sm,
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 5,
    },
    spreadBar: { flex: 1, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
    spreadFooter: {
        marginTop: 6,
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
    },
    listChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    listChip: { borderRadius: Radius.sm, paddingHorizontal: 12, paddingVertical: Spacing.sm },
    listTitle: { fontFamily: 'Newsreader_400Regular', fontSize: 15, lineHeight: 19 },
    detailsSection: { paddingBottom: Spacing.xxl },
    detailRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
    detailCopy: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 15, lineHeight: 20 },
    detailAction: { fontFamily: 'Manrope_700Bold', fontSize: 13, lineHeight: 19 },
    divider: { height: StyleSheet.hairlineWidth },
    weekBlock: { paddingLeft: IconSize.md + 10, paddingBottom: Spacing.sm, gap: 6 },
    weekRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
});
