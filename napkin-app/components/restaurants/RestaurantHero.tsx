/**
 * RestaurantHero — photo band + name (Newsreader italic) + muted meta line.
 * Heart button overlay top-right.
 *
 * Works for both persisted restaurants (id present) and ghost restaurants
 * (pass `restaurant` Places payload to WishlistHeartButton instead of id).
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { WishlistHeartButton } from '@/components/wishlist';
import type { RestaurantPageRestaurant } from '@/hooks/restaurants/useRestaurantPage';
import type { RestaurantPayload } from '@/hooks/wishlist/useWishlistAdd';

type Palette = typeof Colors.light;

function priceTierLabel(level: number | null): string {
    if (level == null) return '';
    return '$'.repeat(Math.max(1, Math.min(4, level)));
}

interface Props {
    restaurant: RestaurantPageRestaurant;
    userId: string | null | undefined;
    /** Ghost Places payload — passed to WishlistHeartButton when restaurant.id is empty */
    restaurantPayloadForGhost?: RestaurantPayload;
}

export function RestaurantHero({
    restaurant,
    userId,
    restaurantPayloadForGhost,
}: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;

    const photoUri = restaurant.photo_url ?? null;

    const metaParts: string[] = [];
    if (restaurant.address) metaParts.push(restaurant.address);
    if (restaurant.city) metaParts.push(restaurant.city);
    if (restaurant.cuisine) metaParts.push(restaurant.cuisine);
    const priceTier = priceTierLabel(restaurant.price_level);
    if (priceTier) metaParts.push(priceTier);
    const metaLine = metaParts.join(' · ');

    const isGhost = !restaurant.id;

    return (
        <View>
            {/* Photo */}
            {photoUri ? (
                <View style={styles.photoContainer}>
                    <ExpoImage
                        source={{ uri: photoUri }}
                        style={styles.heroPhoto}
                        contentFit="cover"
                        transition={200}
                    />
                    {/* Scrim for heart legibility */}
                    <View style={styles.scrim} />
                    {/* Heart — overlaid top-right */}
                    <View style={styles.heartOverlay}>
                        <WishlistHeartButton
                            restaurantId={isGhost ? undefined : restaurant.id}
                            restaurant={isGhost ? restaurantPayloadForGhost : undefined}
                            userId={userId}
                            size={26}
                        />
                    </View>
                </View>
            ) : (
                /* No photo — heart sits in a bar above the name text */
                <View style={[styles.noPhotoBar, { backgroundColor: palette.surfaceContainerLow }]}>
                    <View style={styles.heartNoPhoto}>
                        <WishlistHeartButton
                            restaurantId={isGhost ? undefined : restaurant.id}
                            restaurant={isGhost ? restaurantPayloadForGhost : undefined}
                            userId={userId}
                            size={26}
                        />
                    </View>
                </View>
            )}

            {/* Name + meta */}
            <View style={styles.nameBlock}>
                <Text
                    style={[
                        Type.displayLarge,
                        {
                            color: palette.text,
                            fontFamily: 'Newsreader_400Regular_Italic',
                            fontSize: 34,
                            lineHeight: 40,
                        },
                    ]}
                    numberOfLines={3}
                >
                    {restaurant.name}
                </Text>
                {metaLine ? (
                    <Text
                        style={[
                            Type.bodySmall,
                            { color: palette.textMuted, marginTop: 4 },
                        ]}
                        numberOfLines={2}
                    >
                        {metaLine}
                    </Text>
                ) : null}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    photoContainer: {
        position: 'relative',
    },
    heroPhoto: {
        width: '100%',
        height: 220,
        borderRadius: 0,
    },
    scrim: {
        position: 'absolute',
        top: 0,
        right: 0,
        width: 80,
        height: 60,
        // subtle gradient-like fade at the corner for heart legibility
        backgroundColor: 'transparent',
    },
    heartOverlay: {
        position: 'absolute',
        top: Spacing.md,
        right: Spacing.md,
        backgroundColor: 'rgba(252,249,244,0.85)',
        borderRadius: Radius.full,
        padding: 8,
    },
    noPhotoBar: {
        height: 56,
        justifyContent: 'center',
        alignItems: 'flex-end',
        paddingHorizontal: Spacing.lg,
    },
    heartNoPhoto: {},
    nameBlock: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.md,
    },
});
