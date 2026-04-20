/**
 * RestaurantHero — V1 "Dossier" full-bleed hero.
 *
 * Full-bleed photo (no horizontal padding) with dark gradient scrim top+bottom.
 * Chrome (back / bookmark / share / more) floats over the photo in a cream-on-
 * dark glass style. Title block sits bottom-left: UPPERCASE meta (cuisine ·
 * city) → italic serif name → italic serif address.
 *
 * Bookmark lives in the chrome (per logging-entry-canvas). Log affordance is
 * the floating pill bottom-right — not this component.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { RestaurantPageRestaurant } from '@/hooks/restaurants/useRestaurantPage';

type Palette = typeof Colors.light;

const HERO_HEIGHT = 340;
const CREAM = '#f6ecd9';

function priceTierLabel(level: number | null): string {
    if (level == null) return '';
    return '$'.repeat(Math.max(1, Math.min(4, level)));
}

interface Props {
    restaurant: RestaurantPageRestaurant;
    onBack?: () => void;
    onShare?: () => void;
    onMore?: () => void;
    bookmarked?: boolean;
    onBookmarkPress?: () => void;
}

export function RestaurantHero({
    restaurant,
    onBack,
    onShare,
    onMore,
    bookmarked = false,
    onBookmarkPress,
}: Props) {
    const insets = useSafeAreaInsets();
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;

    const photoUri = restaurant.photo_url ?? null;

    const metaParts: string[] = [];
    if (restaurant.cuisine) metaParts.push(restaurant.cuisine);
    if (restaurant.city) metaParts.push(restaurant.city);
    const priceTier = priceTierLabel(restaurant.price_level);
    if (priceTier) metaParts.push(priceTier);
    const metaLine = metaParts.join(' · ');

    return (
        <View style={[styles.hero, { backgroundColor: palette.surfaceContainerHigh }]}>
            {photoUri ? (
                <ExpoImage
                    source={{ uri: photoUri }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    transition={200}
                />
            ) : null}

            {/* Dark gradient scrim — top for chrome legibility, bottom for title */}
            <LinearGradient
                colors={[
                    'rgba(28,28,25,0.55)',
                    'rgba(28,28,25,0)',
                    'rgba(28,28,25,0)',
                    'rgba(28,28,25,0.85)',
                ]}
                locations={[0, 0.3, 0.55, 1]}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
            />

            {/* Chrome */}
            <View style={[styles.chrome, { top: insets.top + 8 }]}>
                <ChromeButton onPress={onBack}>
                    <Ionicons name="chevron-back" size={18} color={CREAM} />
                </ChromeButton>
                <View style={styles.chromeRight}>
                    {onBookmarkPress ? (
                        <ChromeButton onPress={onBookmarkPress}>
                            <Ionicons
                                name={bookmarked ? 'bookmark' : 'bookmark-outline'}
                                size={14}
                                color={CREAM}
                            />
                        </ChromeButton>
                    ) : null}
                    <ChromeButton onPress={onShare}>
                        <Ionicons name="share-outline" size={15} color={CREAM} />
                    </ChromeButton>
                    <ChromeButton onPress={onMore}>
                        <Ionicons name="ellipsis-horizontal" size={16} color={CREAM} />
                    </ChromeButton>
                </View>
            </View>

            {/* Title block */}
            <View style={styles.titleBlock}>
                {metaLine ? (
                    <Text style={styles.metaLine} numberOfLines={1}>
                        {metaLine.toUpperCase()}
                    </Text>
                ) : null}
                <Text style={styles.name} numberOfLines={3}>
                    {restaurant.name}
                </Text>
                {restaurant.address ? (
                    <Text style={styles.address} numberOfLines={2}>
                        {restaurant.address}
                    </Text>
                ) : null}
            </View>
        </View>
    );
}

function ChromeButton({
    children,
    onPress,
}: {
    children: React.ReactNode;
    onPress?: () => void;
}) {
    return (
        <Pressable
            onPress={onPress}
            hitSlop={8}
            disabled={!onPress}
            style={({ pressed }) => [styles.chromeBtn, { opacity: pressed ? 0.7 : 1 }]}
        >
            {children}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    hero: {
        height: HERO_HEIGHT,
        position: 'relative',
        overflow: 'hidden',
    },
    chrome: {
        position: 'absolute',
        left: Spacing.md - 2,
        right: Spacing.md - 2,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    chromeRight: {
        flexDirection: 'row',
        gap: 8,
    },
    chromeBtn: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: 'rgba(28,28,25,0.35)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    titleBlock: {
        position: 'absolute',
        left: 22,
        right: 22,
        bottom: 18,
    },
    metaLine: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10,
        letterSpacing: 1.5,
        color: CREAM,
        opacity: 0.75,
        marginBottom: 6,
    },
    name: {
        fontFamily: 'Newsreader_600SemiBold',
        fontSize: 36,
        lineHeight: 36,
        color: CREAM,
        letterSpacing: -0.8,
    },
    address: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
        color: CREAM,
        opacity: 0.8,
        marginTop: 5,
    },
});
