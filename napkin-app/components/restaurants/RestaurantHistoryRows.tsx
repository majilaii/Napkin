import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import type { SelfLogRow } from '@/hooks/restaurants/useRestaurantPage';
import { tintIndex6 } from '@/lib/engraving';
import { shortLedgerDate } from '@/lib/restaurantHistoryLedger';

type Palette = typeof Colors.light;

export function formatHistoryDate(value: string): string {
    return shortLedgerDate(value).toUpperCase();
}

export function RestaurantHistoryMasthead({
    average,
    count,
    first,
    last,
    palette,
}: {
    average: number | null;
    count: number;
    first: string | null;
    last: string | null;
    palette: Palette;
}) {
    return (
        <View style={styles.masthead} testID="restaurant-history-masthead">
            <Text style={[Type.ratingLarge, { color: palette.amberBright }]}>
                {average == null ? '—' : average.toFixed(1)}
            </Text>
            {count > 0 && first && last ? (
                <View style={styles.mastheadCopy}>
                    <Text style={[Type.restaurantHistoryVisits, { color: palette.text }]}>
                        {`${count} visit${count === 1 ? '' : 's'}`}
                    </Text>
                    <Text style={[Type.caption, { color: palette.textMuted }]}>
                        {`first ${first} · last ${last}`}
                    </Text>
                </View>
            ) : null}
        </View>
    );
}

function HistoryPhotos({
    photos,
    tintSeed,
    palette,
}: {
    photos: SelfLogRow['photos'];
    tintSeed: string;
    palette: Palette;
}) {
    if (photos.length === 0) return null;

    const compact = photos.length <= 2;
    const visiblePhotos = photos.slice(0, compact ? 2 : 3);
    const plateTints = [
        palette.plateAmber,
        palette.plateOlive,
        palette.plateRose,
        palette.plateGrey,
        palette.plateSlate,
        palette.plateSand,
    ];
    const baseTintIndex = tintIndex6(tintSeed);

    return (
        <View
            testID="restaurant-history-photo-strip"
            style={[styles.photoStrip, compact ? styles.photoStripCompact : styles.photoStripFill]}
        >
            {visiblePhotos.map((photo, index) => (
                <View
                    key={photo.id}
                    testID="restaurant-history-photo-tile"
                    style={[
                        styles.photoTile,
                        compact ? styles.photoTileCompact : styles.photoTileFill,
                        {
                            backgroundColor: plateTints[(baseTintIndex + index) % plateTints.length],
                            borderColor: palette.imageOutline,
                        },
                    ]}
                >
                    <Image
                        source={{ uri: photo.url }}
                        style={StyleSheet.absoluteFillObject}
                        contentFit="cover"
                        transition={200}
                        accessible={false}
                    />
                    {index === 2 && photos.length > 3 ? (
                        <View
                            testID="restaurant-history-photo-scrim"
                            style={[
                                StyleSheet.absoluteFillObject,
                                styles.photoScrim,
                                { backgroundColor: palette.scrimDark },
                            ]}
                        >
                            <Text style={[Type.feedPhotoCount, { color: palette.textOnImage }]}>
                                {`+${photos.length - 3}`}
                            </Text>
                        </View>
                    ) : null}
                </View>
            ))}
        </View>
    );
}

export function RestaurantHistoryRow({
    row,
    tintSeed,
    showDivider,
    onPress,
    palette,
}: {
    row: SelfLogRow;
    tintSeed: string;
    showDivider: boolean;
    onPress?: () => void;
    palette: Palette;
}) {
    const content = (
        <View style={styles.row} testID="restaurant-history-row">
            <View style={styles.topLine}>
                <Text style={[Type.restaurantHistoryDateline, { color: palette.textMuted }]}>
                    {formatHistoryDate(row.visited_at)}
                </Text>
                {row.table_night_id ? (
                    <Text style={[Type.restaurantHistoryDateline, { color: palette.secondary }]}>
                        supper
                    </Text>
                ) : null}
                <View style={styles.spacer} />
                <Text style={[Type.feedCardRating, { color: palette.amberBright }]}>
                    {row.rating == null ? '—' : row.rating.toFixed(1)}
                </Text>
            </View>
            {row.note?.trim() ? (
                <Text style={[Type.restaurantHistoryNote, styles.note, { color: palette.text }]}>
                    {`— ${row.note.trim()}`}
                </Text>
            ) : null}
            {row.companions.length > 0 ? (
                <Text style={[Type.caption, styles.companions, { color: palette.textMuted }]}>
                    {`with ${row.companions.join(' & ')}`}
                </Text>
            ) : null}
            <HistoryPhotos photos={row.photos} tintSeed={tintSeed} palette={palette} />
        </View>
    );

    return (
        <>
            {onPress ? (
                <Pressable
                    onPress={onPress}
                    accessibilityRole="button"
                    accessibilityLabel={`visit on ${formatHistoryDate(row.visited_at)}`}
                    style={({ pressed }) => pressed && styles.pressed}
                >
                    {content}
                </Pressable>
            ) : content}
            {showDivider ? (
                <View
                    testID="restaurant-history-divider"
                    style={[styles.divider, { backgroundColor: palette.dividerSoft }]}
                />
            ) : null}
        </>
    );
}

const styles = StyleSheet.create({
    masthead: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: Spacing.md,
        paddingHorizontal: Spacing.restaurant.pageGutter,
        paddingTop: Spacing.lg,
        paddingBottom: Spacing.md,
    },
    mastheadCopy: {
        alignItems: 'flex-start',
    },
    row: {
        paddingHorizontal: Spacing.restaurant.pageGutter,
        paddingVertical: Spacing.restaurant.historyRowVertical,
    },
    topLine: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: Spacing.sm,
    },
    spacer: { flex: 1 },
    note: { marginTop: Spacing.xs },
    companions: { marginTop: Spacing.xs },
    photoStrip: {
        flexDirection: 'row',
        marginTop: Spacing.sm,
    },
    photoStripCompact: { gap: Spacing.sm },
    photoStripFill: { gap: Spacing.feed.stripGap },
    photoTile: {
        height: Spacing.restaurant.memoryPhotoSize,
        borderRadius: Radius.memory,
        borderWidth: StyleSheet.hairlineWidth,
        overflow: 'hidden',
    },
    photoTileCompact: { width: Spacing.restaurant.memoryPhotoSize },
    photoTileFill: { flex: 1 },
    photoScrim: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    divider: {
        height: StyleSheet.hairlineWidth,
        marginHorizontal: Spacing.restaurant.pageGutter,
    },
    pressed: { opacity: 0.8 },
});
