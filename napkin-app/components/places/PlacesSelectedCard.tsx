import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, IconSize, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { resolveSourcedPhoto } from '@/components/ui/PlacesCredit';
import { mapPeekCuisine, resolveMapPeekMedia } from '@/components/map/mapPeekPresentation';
import { PEEK_MAX_FONT_SCALE } from '@/components/wishlist/peekLayout';
import type { WishlistMapItem } from '@/components/wishlist/mapShared';
import { peekCardContextForItem, usePeekCard } from '@/hooks/restaurants/usePeekCard';
import { priceTierLabel } from '@/lib/priceLevel';
import { todaysHoursLine } from '@/lib/restaurantHours';
import { PlacesRatingLabel } from './PlacesRow';
import { composeFriendCaptionMeta, type PlacesDisplayRow } from './placesPresentation';

interface Props {
    row: PlacesDisplayRow;
    item: WishlistMapItem;
    viewerId: string | null | undefined;
    distance: string | null;
    palette: typeof Colors.light;
    onOpen: () => void;
}

/** Mounted only for the selected pin; enrichment reads existing venue data. */
export function PlacesSelectedCard({ row, item, viewerId, distance, palette, onOpen }: Props) {
    const [failedUrls, setFailedUrls] = useState<ReadonlySet<string>>(new Set());
    const preview = usePeekCard({
        viewerId,
        restaurantId: row.searchRow?.placeId ?? row.id,
        context: peekCardContextForItem(item),
        isSelected: true,
    });
    const carried = resolveSourcedPhoto({
        url: row.photoUrl,
        photoSource: row.photoSource,
        attributionHtml: row.photoAttributionHtml,
        restaurantName: row.name,
    });
    const storedMedia = (preview.data?.media ?? [])
        .map((candidate) => resolveMapPeekMedia(candidate, row.name))
        .filter((candidate) => candidate !== null);
    const carriedMedia = carried.url
        ? [{ thumbnail: { url: carried.url, isPlaces: carried.isPlaces }, credit: carried.credit }]
        : [];
    // Venue photography leads; authorized meal/clip photos are a fallback.
    const candidates = [...carriedMedia, ...storedMedia];
    const photo = [
        ...candidates.filter((candidate) => candidate.thumbnail.isPlaces),
        ...candidates.filter((candidate) => !candidate.thumbnail.isPlaces),
    ].find((candidate) => !failedUrls.has(candidate.thumbnail.url));
    const credit = photo?.credit?.redundant ? null : photo?.credit;
    const cuisine = mapPeekCuisine(row.cuisine)?.toLowerCase();
    const price = priceTierLabel(preview.data?.price_level ?? row.priceLevel);
    const location = [preview.data?.address_short || row.city, distance].filter(Boolean).join(' · ');
    const hours = todaysHoursLine(preview.data?.hours);
    const relationship = row.network ? composeFriendCaptionMeta(row) : null;
    const photoLoading = !photo && preview.isLoading;

    return (
        <Pressable
            testID="places-selected-caption"
            accessibilityRole="button"
            accessibilityLabel={[
                `open ${row.name}`, cuisine, price && `price ${price}`, location,
                hours && `hours ${hours}`, relationship,
            ].filter(Boolean).join(', ')}
            onPress={onOpen}
            style={({ pressed }) => [
                styles.card, Shadow.ambient,
                { backgroundColor: palette.surfaceNote, opacity: pressed ? 0.85 : 1 },
            ]}
        >
            <View style={styles.summary}>
                <View style={[
                    styles.photoFrame,
                    { backgroundColor: palette.surfaceContainerLow, borderColor: palette.imageOutline },
                ]}>
                    {photo ? (
                        <Image
                            testID="places-selected-photo"
                            source={{ uri: photo.thumbnail.url }}
                            key={photo.thumbnail.url}
                            resizeMode="cover"
                            style={StyleSheet.absoluteFill}
                            onError={() => setFailedUrls((previous) => new Set([...previous, photo.thumbnail.url]))}
                        />
                    ) : photoLoading ? (
                        <ActivityIndicator testID="places-selected-photo-loading" color={palette.textMuted} />
                    ) : (
                        <View testID="places-selected-no-photo" style={styles.photoFallback}>
                            <Ionicons name="restaurant-outline" size={IconSize.lg} color={palette.primary} />
                            <Text style={[Type.metadata, { color: palette.textMuted }]} maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}>
                                no photo
                            </Text>
                        </View>
                    )}
                </View>
                <View style={styles.copy}>
                    <View style={styles.nameRow}>
                        <Text
                            style={[Type.mapPeekName, styles.name, { color: palette.text }]}
                            numberOfLines={2}
                            maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                        >
                            {row.name}
                        </Text>
                        <Ionicons name="chevron-forward-outline" size={IconSize.sm} color={palette.textMuted} />
                    </View>
                    {cuisine || price ? (
                        <View testID="places-selected-facts" style={styles.facts}>
                            {cuisine ? (
                                <Text style={[Type.metadata, { color: palette.textSecondary }]} maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}>
                                    {cuisine}
                                </Text>
                            ) : null}
                            {price ? (
                                <Text style={[Type.mapPeekMeta, { color: palette.textSecondary }]} maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}>
                                    {price}
                                </Text>
                            ) : null}
                        </View>
                    ) : null}
                    {location ? (
                        <Text style={[Type.metadata, { color: palette.textMuted }]} numberOfLines={2} maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}>
                            {location}
                        </Text>
                    ) : null}
                    <PlacesRatingLabel row={row} />
                </View>
            </View>
            {hours ? (
                <Text style={[Type.metadata, { color: palette.textSecondary }]} numberOfLines={2} maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}>
                    hours · {hours}
                </Text>
            ) : null}
            {relationship ? (
                <Text style={[Type.metadata, { color: palette.textMuted }]} numberOfLines={2} maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}>
                    {relationship}
                </Text>
            ) : null}
            {credit ? (
                <Text testID="places-selected-photo-credit" style={[Type.metadata, { color: palette.textMuted }]} maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}>
                    photo by {credit.label}
                </Text>
            ) : null}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: { borderRadius: Radius.lg, padding: Spacing.sm + Spacing.xs, gap: Spacing.sm },
    summary: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm + Spacing.xs },
    photoFrame: {
        width: Spacing.xxl * 2 + Spacing.md,
        height: Spacing.xxl * 2 + Spacing.lg,
        borderRadius: Radius.sm,
        borderWidth: StyleSheet.hairlineWidth,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    photoFallback: { alignItems: 'center', gap: Spacing.sm },
    copy: { flex: 1, gap: Spacing.xs },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
    name: { flex: 1 },
    facts: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.sm, rowGap: Spacing.xs },
});
