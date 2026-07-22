/**
 * ComposerMasthead — canvas RestaurantHeader (logger-canvas.jsx).
 *
 * Layout: 48px rounded thumbnail | Newsreader-italic name (wraps 2 lines,
 * flex:1 minWidth:0) + uppercase meta line (cuisine · locality).
 *
 * "change" affordance (onClearPlace) is non-negotiable — preserved per
 * TICKET-064 ticket Notes. Tapping it returns to search mode.
 *
 * Stars are gone — rating moved to standalone RatingBand below.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Image } from 'react-native';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { resolveSourcedPhoto } from '@/components/ui/PlacesCredit';

interface Props {
    restaurantName: string;
    /** e.g. "Italian · Greenwich Village". Omit if unavailable. */
    meta?: string;
    /** Proxy or storage URL for the 48px thumbnail. Null shows a placeholder block. */
    thumbnailUri?: string | null;
    thumbnailPhotoSource?: 'places' | 'user' | 'table' | 'none' | null;
    thumbnailAttributionHtml?: string | null;
    /** When provided, renders the "change" affordance beneath the name. */
    onClearPlace?: () => void;
}

export function ComposerMasthead({
    restaurantName,
    meta,
    thumbnailUri,
    thumbnailPhotoSource,
    thumbnailAttributionHtml,
    onClearPlace,
}: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const resolvedThumbnail = resolveSourcedPhoto({
        url: thumbnailUri,
        photoSource: thumbnailPhotoSource,
        attributionHtml: thumbnailAttributionHtml,
        restaurantName,
    });
    const [failedThumbnail, setFailedThumbnail] = useState<string | null>(null);
    useEffect(() => setFailedThumbnail(null), [resolvedThumbnail.url]);
    const visibleThumbnail = resolvedThumbnail.url !== failedThumbnail
        ? resolvedThumbnail.url
        : null;

    return (
        <View style={styles.wrapper}>
            {/* 48px thumbnail */}
            <View
                style={[
                    styles.thumbnail,
                    { backgroundColor: palette.surfaceContainerHigh },
                ]}
            >
                {visibleThumbnail ? (
                    <Image
                        source={{ uri: visibleThumbnail }}
                        style={styles.thumbnailImage}
                        accessibilityRole="image"
                        accessibilityLabel={restaurantName}
                        onError={() => setFailedThumbnail(visibleThumbnail)}
                    />
                ) : null}
            </View>

            {/* Name + meta + change */}
            <View style={styles.nameContainer}>
                <Text
                    style={[styles.restaurantName, { color: palette.text }]}
                    numberOfLines={2}
                >
                    {restaurantName}
                </Text>

                {meta ? (
                    <Text
                        style={[styles.meta, { color: palette.textMuted }]}
                        numberOfLines={1}
                    >
                        {meta}
                    </Text>
                ) : null}

                {onClearPlace ? (
                    <Pressable
                        onPress={onClearPlace}
                        hitSlop={8}
                        style={({ pressed }) => [
                            styles.changeLink,
                            { opacity: pressed ? 0.6 : 1 },
                        ]}
                        accessibilityLabel="Change restaurant"
                        accessibilityRole="button"
                    >
                        <Text style={[styles.changeText, { color: palette.textMuted }]}>
                            change
                        </Text>
                    </Pressable>
                ) : null}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingBottom: Spacing.sm,
    },
    thumbnail: {
        width: 48,
        height: 48,
        borderRadius: Radius.sm,
        overflow: 'hidden',
        flexShrink: 0,
    },
    thumbnailImage: {
        width: 48,
        height: 48,
    },
    nameContainer: {
        flex: 1,
        minWidth: 0,
    },
    restaurantName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 20,
        lineHeight: 24,
        letterSpacing: -0.2,
        fontWeight: '400',
    },
    meta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        marginTop: 3,
    },
    changeLink: {
        marginTop: 4,
        alignSelf: 'flex-start',
    },
    changeText: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
    },
});
