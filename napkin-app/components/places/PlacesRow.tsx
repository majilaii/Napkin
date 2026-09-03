import React, { useMemo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { resolveSourcedPhoto } from '@/components/ui/PlacesCredit';
import { Colors, IconSize, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    composeRowMeta,
    presentPlacesRating,
    type DecoratedPlacesRow,
    type PlacesDisplayRow,
} from './placesPresentation';

interface Props {
    item: DecoratedPlacesRow;
    onPress: (row: PlacesDisplayRow) => void;
    showThumbnail?: boolean;
}

export function PlacesRatingLabel({ row }: { row: PlacesDisplayRow }) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const rating = presentPlacesRating(row);

    if (!rating.value) {
        return rating.suffix ? (
            <Text
                numberOfLines={1}
                style={[Type.metadata, { color: palette.textMuted }]}
            >
                {rating.suffix}
            </Text>
        ) : null;
    }
    return (
        <Text numberOfLines={1} style={styles.ratingLine}>
            <Text style={[Type.feedLedgerRating, { color: palette.tertiary }]}>
                {rating.value}
            </Text>
            {rating.suffix ? (
                <Text style={[Type.metadata, { color: palette.textMuted }]}>
                    {rating.suffix}
                </Text>
            ) : null}
        </Text>
    );
}

export function PlacesRow({ item, onPress, showThumbnail = false }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const meta = composeRowMeta(item.row, item.distanceLabel);
    const photo = useMemo(() => {
        if (!showThumbnail) return null;
        return resolveSourcedPhoto({
            url: item.row.photoUrl,
            photoSource: item.row.photoSource,
            attributionHtml: item.row.photoAttributionHtml,
            restaurantName: item.row.name,
        });
    }, [
        item.row.name,
        item.row.photoAttributionHtml,
        item.row.photoSource,
        item.row.photoUrl,
        showThumbnail,
    ]);

    return (
        <Pressable
            onPress={() => onPress(item.row)}
            style={({ pressed }) => [
                styles.row,
                showThumbnail && styles.thumbnailRow,
                pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`open ${item.row.name}`}
        >
            {photo?.url ? (
                <View
                    testID={`places-row-thumbnail-${item.row.id}`}
                    style={[
                        styles.thumbnailFrame,
                        {
                            backgroundColor: palette.surfaceContainerLow,
                            borderColor: palette.imageOutline,
                        },
                    ]}
                >
                    <Image source={{ uri: photo.url }} style={styles.thumbnail} resizeMode="cover" />
                </View>
            ) : null}
            <View style={styles.copy}>
                <View style={styles.nameRatingLine}>
                    <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                        {item.row.name}
                    </Text>
                    <PlacesRatingLabel row={item.row} />
                </View>
                {meta || photo?.credit ? (
                    <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>
                        {meta}
                        {meta && photo?.credit ? ' · ' : null}
                        {photo?.credit ? (
                            <Text testID="places-row-photo-credit" style={styles.credit}>
                                photo by {photo.credit.label}
                            </Text>
                        ) : null}
                    </Text>
                ) : null}
            </View>
            <Ionicons
                name="chevron-forward-outline"
                size={IconSize.sm + 1}
                color={palette.textFaint}
            />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        minHeight: Spacing.xxl + Spacing.md + Spacing.xs / 4,
        paddingLeft: Spacing.pageGutter,
        paddingRight: Spacing.md,
        paddingVertical: Spacing.sm + Spacing.xs / 2,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm + Spacing.xs / 2,
    },
    thumbnailRow: {
        minHeight: Spacing.hitTarget + Spacing.md,
        paddingHorizontal: Spacing.pageGutter,
        paddingVertical: Spacing.sm,
        gap: Spacing.sm + Spacing.xs,
    },
    pressed: {
        opacity: 0.64,
    },
    thumbnailFrame: {
        width: Spacing.hitTarget,
        height: Spacing.hitTarget,
        borderRadius: Radius.memory,
        borderWidth: StyleSheet.hairlineWidth,
        overflow: 'hidden',
    },
    thumbnail: {
        width: '100%',
        height: '100%',
    },
    copy: {
        flex: 1,
        gap: Spacing.xs - 1,
    },
    nameRatingLine: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: Spacing.sm + Spacing.xs,
    },
    name: {
        ...Type.feedNoteRestaurant,
        flex: 1,
    },
    ratingLine: {
        maxWidth: '44%',
    },
    meta: {
        ...Type.feedMeta,
    },
    credit: {
        ...Type.caption,
    },
});
