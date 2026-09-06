import React, { useEffect, useRef, useState } from 'react';
import {
    Linking,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { Colors, IconSize, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import type {
    PublicReviewCard,
    RestaurantPageRestaurant,
    TableNoteRow,
} from '@/hooks/restaurants/useRestaurantPage';
import type { RestaurantFeaturedList } from '@/hooks/restaurants/useRestaurantFeaturedLists';
import type { FriendsCohortMember, TableNotesGroup } from '@/lib/restaurantPageV3';
import {
    formatGoogleRatingCount,
    monthLabel,
    previewReviews,
    restaurantClosingTime,
} from '@/lib/restaurantPageV3';
import { hasHours, todaysHoursLine, weekHoursLines } from '@/lib/restaurantHours';
import { ReviewPhotoStrip, reviewPhotoUrls } from './ReviewPhotoStrip';
import type { MastheadPhoto } from '@/lib/restaurantPhoto';

type Palette = typeof Colors.light;

function quietOpen(url: string) {
    void Linking.openURL(url).catch(() => undefined);
}

export function SectionHeading({
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
            <Text
                accessibilityRole="header"
                style={[Type.feedSectionKicker, { color: palette.textMuted }]}
            >
                {label}
            </Text>
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
    onPhotoPress,
    topInset,
    photos = [],
    palette,
}: {
    restaurant: RestaurantPageRestaurant;
    meta: string;
    saved: boolean;
    saveDisabled: boolean;
    onBack: () => void;
    onSave: () => void;
    onPhotoPress?: (photo: MastheadPhoto) => void;
    topInset: number;
    photos?: readonly MastheadPhoto[];
    palette: Palette;
}) {
    const { width: windowWidth, height: windowHeight } = useWindowDimensions();
    const pagerRef = useRef<ScrollView>(null);
    const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
    const photoSignature = photos.map((photo) => photo.url).join('|');
    const mastheadHeight = Math.min(
        Spacing.restaurant.photoMastheadHeight,
        windowHeight * Spacing.restaurant.photoMastheadMaxWindowRatio,
    );

    useEffect(() => {
        setCurrentPhotoIndex(0);
        pagerRef.current?.scrollTo({ x: 0, animated: false });
    }, [photoSignature]);

    if (photos.length > 0) {
        const currentPhoto = photos[Math.min(currentPhotoIndex, photos.length - 1)];
        const entryChip = currentPhoto.kind === 'entry' && currentPhoto.label
            ? `${currentPhoto.label} · ${currentPhotoIndex + 1} / ${photos.length}`
            : null;
        return (
            <View
                testID="restaurant-photo-masthead"
                style={[
                    styles.photoMasthead,
                    { height: mastheadHeight, backgroundColor: palette.plateSlate },
                ]}
            >
                <ScrollView
                    ref={pagerRef}
                    testID="masthead-photo-pager"
                    horizontal
                    pagingEnabled
                    bounces={false}
                    showsHorizontalScrollIndicator={false}
                    onMomentumScrollEnd={(event) => {
                        const index = Math.round(event.nativeEvent.contentOffset.x / windowWidth);
                        setCurrentPhotoIndex(Math.max(0, Math.min(photos.length - 1, index)));
                    }}
                >
                    {photos.map((photo, index) => {
                        const image = (
                            <Image
                                testID={`masthead-photo-${index}`}
                                source={{ uri: photo.url }}
                                style={{ width: windowWidth, height: mastheadHeight }}
                                contentFit="cover"
                                transition={200}
                                accessible={false}
                            />
                        );
                        if (photo.kind !== 'entry' || !photo.entryId || !onPhotoPress) {
                            return (
                                <React.Fragment key={`masthead-photo-${index}`}>
                                    {image}
                                </React.Fragment>
                            );
                        }
                        return (
                            <Pressable
                                key={`masthead-photo-${index}`}
                                testID={`masthead-photo-link-${index}`}
                                onPress={() => onPhotoPress(photo)}
                                accessibilityRole="imagebutton"
                                accessibilityLabel="photo from a visit"
                                style={({ pressed }) => [
                                    { width: windowWidth, height: mastheadHeight },
                                    pressed && styles.pressed,
                                ]}
                            >
                                {image}
                            </Pressable>
                        );
                    })}
                </ScrollView>
                <LinearGradient
                    colors={[
                        palette.overlayPhoto,
                        palette.overlayClear,
                        palette.overlayClear,
                        palette.overlayHeavy,
                    ]}
                    locations={[
                        0,
                        Spacing.restaurant.photoGradientTopEnd,
                        Spacing.restaurant.photoGradientMiddleEnd,
                        1,
                    ]}
                    style={StyleSheet.absoluteFill}
                    pointerEvents="none"
                />
                <View style={[styles.photoTopBar, { top: topInset + Spacing.sm }]}>
                    <Pressable
                        onPress={onBack}
                        accessibilityRole="button"
                        accessibilityLabel="back"
                        style={({ pressed }) => [
                            styles.photoTopButton,
                            { backgroundColor: palette.scrimFrost },
                            Shadow.ambient,
                            pressed && styles.pressed,
                        ]}
                    >
                        <Ionicons name="chevron-back" size={IconSize.lg} color={palette.text} />
                    </Pressable>
                    <Pressable
                        onPress={onSave}
                        disabled={saveDisabled}
                        accessibilityRole="button"
                        accessibilityLabel={saved ? 'edit saved lists' : 'save restaurant'}
                        style={({ pressed }) => [
                            styles.photoTopButton,
                            { backgroundColor: palette.scrimFrost },
                            Shadow.ambient,
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
                {entryChip || currentPhoto.kind === 'places' ? (
                    <View
                        style={[
                            styles.photoSourceChip,
                            {
                                top: topInset
                                    + Spacing.sm
                                    + Spacing.restaurant.photoControlSize
                                    + Spacing.sm,
                                backgroundColor: palette.scrimDark,
                            },
                        ]}
                    >
                        <Text style={[Type.sectionKicker, { color: palette.textOnImage }]}>
                            {entryChip ?? currentPhoto.label}
                        </Text>
                        {currentPhoto.attribution ? (
                            <Text
                                style={[Type.metadata, { color: palette.textOnImageMuted }]}
                                numberOfLines={1}
                            >
                                {currentPhoto.attribution}
                            </Text>
                        ) : null}
                    </View>
                ) : null}
                <View style={styles.photoTitleBlock} pointerEvents="none">
                    <Text
                        style={[Type.restaurantName, { color: palette.textOnImage }]}
                        numberOfLines={3}
                    >
                        {restaurant.name}
                    </Text>
                    {meta ? (
                        <Text
                            style={[
                                Type.metadata,
                                styles.mastheadMeta,
                                { color: palette.textOnImageMuted },
                            ]}
                            numberOfLines={2}
                        >
                            {meta}
                        </Text>
                    ) : null}
                </View>
            </View>
        );
    }

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

type UtilityAction = {
    key: string;
    label: string;
    active?: boolean;
    onPress: () => void;
};

/** Lines of a previewed review before it clips; the folio shows the rest. */
const REVIEW_PREVIEW_LINES = 3;

export function RestaurantActions({
    saved,
    onLog,
    primaryActions,
    onPin,
    onDirections,
    onWebsite,
    onReserve,
    flushTop = false,
    palette,
}: {
    saved: boolean;
    onLog: () => void;
    primaryActions?: React.ReactNode;
    onPin: () => void;
    onDirections: () => void;
    onWebsite?: () => void;
    onReserve?: () => void;
    flushTop?: boolean;
    palette: Palette;
}) {
    const utilities: UtilityAction[] = [
        { key: 'pin', label: saved ? 'pinned' : 'pin', active: saved, onPress: onPin },
        { key: 'directions', label: 'directions', onPress: onDirections },
        ...(onWebsite ? [{ key: 'website', label: 'website', onPress: onWebsite }] : []),
        ...(onReserve ? [{ key: 'reserve', label: 'reserve', onPress: onReserve }] : []),
    ];
    return (
        <View style={[styles.actions, flushTop && styles.actionsFlushTop]}>
            {primaryActions ?? <Pressable
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
            </Pressable>}
            <View style={styles.quietRow} testID="restaurant-quiet-row">
                {utilities.map((action, index) => (
                    <React.Fragment key={action.key}>
                        {index > 0 ? (
                            <Text style={[Type.metadata, { color: palette.textFaint }]}>·</Text>
                        ) : null}
                        <Pressable
                            onPress={action.onPress}
                            accessibilityRole="button"
                            accessibilityLabel={action.label}
                            style={({ pressed }) => [styles.quietAction, pressed && styles.pressed]}
                        >
                            <Text style={[Type.metadata, { color: action.active ? palette.primary : palette.textMuted }]}>
                                {action.label}
                            </Text>
                        </Pressable>
                    </React.Fragment>
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
    clipped,
    photos,
    onPress,
    palette,
}: {
    note: string;
    name: string;
    rating: number | null;
    visitedAt: string | null;
    suffix?: string;
    clipped?: boolean;
    photos?: string[];
    onPress?: () => void;
    palette: Palette;
}) {
    const content = (
        <View style={[styles.quoteCard, { backgroundColor: palette.surfaceNote }, Shadow.ambient]}>
            <Text
                style={[Type.restaurantQuote, { color: palette.textSoft }]}
                numberOfLines={clipped ? REVIEW_PREVIEW_LINES : undefined}
            >
                {`— ${note}`}
            </Text>
            {photos && photos.length > 0 ? (
                <View style={styles.quotePhotos}>
                    <ReviewPhotoStrip
                        photos={photos}
                        author={name}
                        caption={[name, monthLabel(visitedAt)].filter(Boolean).join(' · ')}
                        palette={palette}
                    />
                </View>
            ) : null}
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
    reviews,
    viewerUserId,
    total,
    onSeeAll,
    onReviewPress,
    palette,
}: {
    cohort: FriendsCohortMember[];
    reviews: PublicReviewCard[];
    viewerUserId?: string | null;
    total: number;
    onSeeAll: () => void;
    onReviewPress: (review: PublicReviewCard) => void;
    palette: Palette;
}) {
    if (total <= 0) return null;
    const visible = previewReviews(cohort, reviews, viewerUserId);
    const action = `all ${total} reviews ›`;
    const actionLabel = `all ${total} reviews`;
    if (visible.length === 0) {
        return (
            <View style={styles.section}>
                <Pressable
                    onPress={onSeeAll}
                    accessibilityRole="button"
                    accessibilityLabel={actionLabel}
                    style={({ pressed }) => [styles.sectionHeading, pressed && styles.pressed]}
                >
                    <Text style={[Type.feedSectionKicker, { color: palette.textMuted }]}>REVIEWS</Text>
                    <Text style={[Type.restaurantSectionAction, { color: palette.primary }]}>
                        {action}
                    </Text>
                </Pressable>
            </View>
        );
    }
    const allFriends = visible.every((review) => review.is_followee);
    return (
        <View style={styles.section}>
            <SectionHeading label={allFriends ? 'FROM FRIENDS' : 'REVIEWS'} palette={palette} />
            {visible.map((review) => (
                <QuoteCard
                    key={review.entry_id}
                    note={review.note_excerpt}
                    name={review.display_name}
                    rating={review.rating}
                    visitedAt={review.created_at}
                    clipped
                    photos={reviewPhotoUrls(review)}
                    onPress={() => onReviewPress(review)}
                    palette={palette}
                />
            ))}
            <Pressable
                onPress={onSeeAll}
                accessibilityRole="button"
                accessibilityLabel={actionLabel}
                style={({ pressed }) => [styles.sectionDoorway, pressed && styles.pressed]}
            >
                <Text style={[Type.restaurantSectionAction, { color: palette.primary }]}>{action}</Text>
            </Pressable>
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
                                height: Math.max(Spacing.restaurant.spreadBarMin, (count / max) * Spacing.restaurant.spreadHeight),
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
    faint,
    palette,
}: {
    icon: keyof typeof Ionicons.glyphMap;
    copy: string;
    action?: string;
    onPress?: () => void;
    last?: boolean;
    faint?: boolean;
    palette: Palette;
}) {
    const contentColor = faint ? palette.textFaint : palette.text;
    const iconColor = faint ? palette.textFaint : palette.textSecondary;
    const row = (
        <View style={styles.detailRow}>
            <Ionicons name={icon} size={IconSize.md} color={iconColor} />
            <Text style={[styles.detailCopy, { color: contentColor }]}>{copy}</Text>
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
    openNow,
    onGather,
    palette,
}: {
    restaurant: RestaurantPageRestaurant;
    directionsUrl: string;
    openNow?: boolean | null;
    onGather?: () => void;
    palette: Palette;
}) {
    const [hoursExpanded, setHoursExpanded] = useState(false);
    const today = todaysHoursLine(restaurant.hours);
    const closes = restaurantClosingTime(restaurant.hours, new Date());
    const hoursCopy = closes && openNow === true
        ? `open · until ${closes}`
        : today || 'hours';
    const week = weekHoursLines(restaurant.hours);
    const rows = [
        restaurant.address ? 'address' : null,
        hasHours(restaurant.hours) ? 'hours' : null,
        restaurant.phone ? 'phone' : null,
        restaurant.website ? 'website' : null,
        onGather ? 'gather' : null,
        restaurant.google_rating != null ? 'google' : null,
    ].filter(Boolean);
    if (rows.length === 0) return null;
    const lastRow = rows.at(-1);
    const googleCount = restaurant.google_rating_count != null
        && restaurant.google_rating_count > 0
        ? formatGoogleRatingCount(restaurant.google_rating_count)
        : null;
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
                    last={lastRow === 'website'}
                    palette={palette}
                />
            ) : null}
            {onGather ? (
                <DetailRow
                    icon="people-outline"
                    copy="gather the table"
                    onPress={onGather}
                    last={lastRow === 'gather'}
                    palette={palette}
                />
            ) : null}
            {restaurant.google_rating != null ? (
                <DetailRow
                    icon="star-outline"
                    copy={`${Math.max(0, Math.min(5, restaurant.google_rating)).toFixed(1)} on google${googleCount ? ` · ${googleCount}` : ''}`}
                    last
                    faint
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
        minHeight: Spacing.restaurant.topBarHeight,
        paddingHorizontal: Spacing.restaurant.topBarGutter,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    topButton: {
        width: Spacing.restaurant.quietActionHeight,
        height: Spacing.restaurant.quietActionHeight,
        alignItems: 'center',
        justifyContent: 'center',
    },
    photoMasthead: {
        position: 'relative',
        overflow: 'hidden',
    },
    photoTopBar: {
        position: 'absolute',
        left: Spacing.restaurant.photoChromeGutter,
        right: Spacing.restaurant.photoChromeGutter,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    photoTopButton: {
        width: Spacing.restaurant.photoControlSize,
        height: Spacing.restaurant.photoControlSize,
        borderRadius: Radius.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
    photoSourceChip: {
        position: 'absolute',
        right: Spacing.restaurant.photoChromeGutter,
        minHeight: Spacing.restaurant.photoChipMinHeight,
        maxWidth: Spacing.restaurant.photoChipMaxWidth,
        borderRadius: Radius.full,
        paddingHorizontal: Spacing.restaurant.actionGap,
        paddingVertical: Spacing.xs,
        justifyContent: 'center',
        gap: Spacing.xs,
    },
    photoTitleBlock: {
        position: 'absolute',
        left: Spacing.restaurant.pageGutter,
        right: Spacing.restaurant.pageGutter,
        bottom: Spacing.restaurant.photoTitleBottom,
    },
    masthead: {
        paddingHorizontal: Spacing.restaurant.pageGutter,
        paddingTop: Spacing.restaurant.mastheadTop,
    },
    restaurantName: Type.restaurantName,
    mastheadMeta: { marginTop: Spacing.xs },
    actions: {
        paddingHorizontal: Spacing.restaurant.pageGutter,
        paddingTop: Spacing.restaurant.actionTop,
        gap: Spacing.restaurant.actionGap,
    },
    actionsFlushTop: { paddingTop: Spacing.restaurant.flushTop },
    primaryAction: {
        height: Spacing.restaurant.primaryActionHeight,
        borderRadius: Radius.full,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.sm,
    },
    primaryActionText: Type.restaurantPrimaryAction,
    quietRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        columnGap: Spacing.sm,
        marginLeft: -Spacing.xs,
    },
    quietAction: {
        minHeight: Spacing.restaurant.quietActionHeight,
        justifyContent: 'center',
        paddingHorizontal: Spacing.xs,
    },
    section: {
        paddingHorizontal: Spacing.restaurant.pageGutter,
        marginTop: Spacing.restaurant.sectionGap,
    },
    sectionHeading: {
        minHeight: Spacing.restaurant.sectionHeadingHeight,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: Spacing.sm,
    },
    headingActionHit: {
        minHeight: Spacing.restaurant.sectionHeadingHeight,
        justifyContent: 'center',
    },
    headingAction: Type.restaurantSectionAction,
    sectionDoorway: {
        minHeight: Spacing.restaurant.quietActionHeight,
        justifyContent: 'center',
    },
    quoteCard: {
        borderRadius: Radius.lg,
        paddingHorizontal: Spacing.restaurant.cardHorizontal,
        paddingVertical: Spacing.restaurant.cardVertical,
        marginBottom: Spacing.sm,
    },
    quotePhotos: { marginTop: Spacing.sm },
    quoteAttribution: {
        flexDirection: 'row',
        alignItems: 'baseline',
        flexWrap: 'wrap',
        gap: Spacing.sm,
        marginTop: Spacing.sm,
    },
    quoteName: Type.restaurantQuoteName,
    quoteRating: Type.restaurantRatingInline,
    spreadBars: {
        height: Spacing.restaurant.spreadHeight,
        marginTop: Spacing.sm,
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: Spacing.restaurant.spreadBarGap,
    },
    spreadBar: {
        flex: 1,
        borderTopLeftRadius: Spacing.restaurant.spreadBarRadius,
        borderTopRightRadius: Spacing.restaurant.spreadBarRadius,
    },
    spreadFooter: {
        marginTop: Spacing.restaurant.spreadFooterTop,
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
    },
    listChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    listChip: {
        borderRadius: Radius.sm,
        paddingHorizontal: Spacing.restaurant.listChipHorizontal,
        paddingVertical: Spacing.sm,
    },
    listTitle: Type.restaurantListTitle,
    detailsSection: { paddingBottom: Spacing.xxl },
    detailRow: {
        minHeight: Spacing.restaurant.quietActionHeight,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.restaurant.actionGap,
    },
    detailCopy: { flex: 1, ...Type.restaurantDetail },
    detailAction: Type.restaurantDetailAction,
    divider: { height: StyleSheet.hairlineWidth },
    weekBlock: {
        paddingLeft: IconSize.md + Spacing.restaurant.actionGap,
        paddingBottom: Spacing.sm,
        gap: Spacing.restaurant.compactGap,
    },
    weekRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
});
