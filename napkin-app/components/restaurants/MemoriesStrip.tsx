import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type {
    PublicReviewCard,
    RestaurantPageData,
    SelfLogRow,
} from '@/hooks/restaurants/useRestaurantPage';
import { tintIndex6 } from '@/lib/engraving';

type MemoriesPayload = {
    self_log?: SelfLogRow[];
    public_reviews?: PublicReviewCard[];
    /** Optional here so a legacy page response can degrade to no strip. */
    photos?: RestaurantPageData['photos'];
};

export type MemoryTile = {
    url: string;
    entryId: string | null;
    viewAs: 'public' | null;
};

export function buildMemoryTiles(
    payload: MemoriesPayload,
    excludedUrls: readonly string[] = [],
): MemoryTile[] {
    if (!payload.photos) return [];

    const tiles: MemoryTile[] = [];
    const seen = new Set(excludedUrls.map((url) => url.trim()).filter(Boolean));
    const add = (
        url: string | null | undefined,
        entryId?: string | null,
        viewAs: MemoryTile['viewAs'] = null,
    ) => {
        const normalizedUrl = url?.trim();
        if (!normalizedUrl || seen.has(normalizedUrl) || tiles.length >= 12) return;
        seen.add(normalizedUrl);
        tiles.push({ url: normalizedUrl, entryId: entryId ?? null, viewAs });
    };

    const selfLog = [...(payload.self_log ?? [])].sort((a, b) => {
        if (a.visited_at !== b.visited_at) return a.visited_at < b.visited_at ? 1 : -1;
        return b.id.localeCompare(a.id);
    });
    for (const row of selfLog) {
        for (const photo of row.photos) add(photo.url, row.entry_id);
    }
    for (const photo of payload.photos.from_your_table ?? []) add(photo.url, photo.entry_id);
    for (const photo of payload.photos.from_others ?? []) {
        add(photo.url, photo.entry_id, 'public');
    }
    for (const review of payload.public_reviews ?? []) {
        add(review.photo_url, review.entry_id, 'public');
    }

    return tiles;
}

export function MemoriesStrip({
    restaurantId,
    payload,
    excludedUrls = [],
}: {
    restaurantId: string;
    payload: MemoriesPayload;
    excludedUrls?: readonly string[];
}) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const tiles = useMemo(
        () => buildMemoryTiles(payload, excludedUrls),
        [excludedUrls, payload],
    );

    if (tiles.length === 0) return null;

    const plateTints = [
        palette.plateAmber,
        palette.plateOlive,
        palette.plateRose,
        palette.plateGrey,
        palette.plateSlate,
        palette.plateSand,
    ];
    const baseTintIndex = tintIndex6(restaurantId);

    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.scroll}
            contentContainerStyle={styles.content}
            testID="memories-strip"
        >
            {tiles.map((tile, index) => {
                const tileStyle = [
                    styles.tile,
                    {
                        backgroundColor: plateTints[(baseTintIndex + index) % plateTints.length],
                        borderColor: palette.imageOutline,
                    },
                ];
                const image = (
                    <Image
                        testID={`memory-photo-${index}`}
                        source={{ uri: tile.url }}
                        style={StyleSheet.absoluteFillObject}
                        contentFit="cover"
                        transition={200}
                        accessible={false}
                    />
                );

                if (!tile.entryId) {
                    return (
                        <View
                            key={tile.url}
                            style={tileStyle}
                            accessible
                            accessibilityLabel="photo from a visit"
                        >
                            {image}
                        </View>
                    );
                }

                return (
                    <Pressable
                        key={tile.url}
                        onPress={() => router.push({
                            pathname: '/entry-detail',
                            params: {
                                entryId: tile.entryId!,
                                ...(tile.viewAs ? { viewAs: tile.viewAs } : {}),
                            },
                        })}
                        accessibilityLabel="photo from a visit"
                        accessibilityRole="imagebutton"
                        style={({ pressed }) => [tileStyle, pressed && styles.pressed]}
                    >
                        {image}
                    </Pressable>
                );
            })}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    scroll: {
        marginTop: Spacing.md,
        marginBottom: Spacing.lg,
    },
    content: {
        paddingHorizontal: Spacing.restaurant.pageGutter,
        gap: Spacing.sm,
    },
    tile: {
        width: Spacing.restaurant.memoryPhotoSize,
        height: Spacing.restaurant.memoryPhotoSize,
        borderRadius: Radius.memory,
        borderWidth: StyleSheet.hairlineWidth,
        overflow: 'hidden',
    },
    pressed: { opacity: 0.8 },
});
