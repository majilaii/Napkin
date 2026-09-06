/**
 * ReviewPhotoStrip — the 1–3 inline photos under a public review, with an
 * overflow count on the third tile. Shared by the restaurant page preview
 * cards and the All reviews rows so the two never drift. Taps open the
 * read-only PhotoLightbox; the strip owns that state. Renders nothing when
 * the review has no photos.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import type { PublicReviewCard } from '@/hooks/restaurants/useRestaurantPage';
import { PhotoLightbox } from '@/components/photos/PhotoLightbox';

type Palette = typeof Colors.light;

const MAX_TILES = 3;

/** Every photo on a public review, deduped, falling back to the legacy single photo_url. */
export function reviewPhotoUrls(
    review: Pick<PublicReviewCard, 'photo_url'> & Partial<Pick<PublicReviewCard, 'photo_urls'>>,
): string[] {
    const urls = review.photo_urls?.length
        ? review.photo_urls
        : review.photo_url ? [review.photo_url] : [];
    return [...new Set(urls.filter(Boolean))];
}

function tileHeight(count: number) {
    return count === 1 ? 150 : count === 2 ? 128 : 116;
}

export function ReviewPhotoStrip({
    photos,
    author,
    caption,
    palette,
}: {
    photos: string[];
    author: string;
    caption: string;
    palette: Palette;
}) {
    const [photoIndex, setPhotoIndex] = useState<number | null>(null);
    if (photos.length === 0) return null;
    const height = tileHeight(photos.length);
    return (
        <View style={styles.strip} testID="review-photo-strip">
            {photos.slice(0, MAX_TILES).map((url, index) => (
                <Pressable
                    key={url}
                    onPress={() => setPhotoIndex(index)}
                    accessibilityRole="button"
                    accessibilityLabel={`Photo ${index + 1} of ${photos.length} by ${author}`}
                    style={[styles.tile, { height, borderColor: palette.imageOutline }]}
                >
                    <Image
                        source={{ uri: url }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        transition={200}
                        accessible={false}
                    />
                    {index === MAX_TILES - 1 && photos.length > MAX_TILES ? (
                        <View style={[styles.overflow, { backgroundColor: palette.overlayPhoto }]}>
                            <Text style={[Type.titleLarge, { color: palette.textOnImage }]}>
                                {`+${photos.length - MAX_TILES}`}
                            </Text>
                        </View>
                    ) : null}
                </Pressable>
            ))}
            {photoIndex != null ? (
                <PhotoLightbox
                    visible
                    photos={photos}
                    initialIndex={photoIndex}
                    caption={caption}
                    onClose={() => setPhotoIndex(null)}
                />
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    strip: { flexDirection: 'row', gap: Spacing.restaurant.compactGap },
    tile: { flex: 1, borderRadius: Radius.compact, overflow: 'hidden', borderWidth: 1 },
    overflow: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
