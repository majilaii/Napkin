/**
 * EligibleRestaurantRow — row in the EditTopFourSheet pick list.
 * Shows thumbnail, name, rating chip, last logged.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { EligibleRestaurant } from '@/hooks/top-fours/useEligibleRestaurantsForCity';

interface Props {
    restaurant: EligibleRestaurant;
    isSelected: boolean;
    onPress: (restaurant: EligibleRestaurant) => void;
}

export function EligibleRestaurantRow({ restaurant, isSelected, onPress }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <Pressable
            onPress={() => onPress(restaurant)}
            style={({ pressed }) => [
                styles.row,
                {
                    borderBottomColor: palette.dividerSoft,
                    backgroundColor: isSelected ? palette.primaryMuted : 'transparent',
                    opacity: pressed ? 0.75 : 1,
                },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${restaurant.name}${restaurant.best_rating ? `, rated ${restaurant.best_rating}` : ''}`}
        >
            {/* Thumbnail */}
            <View
                style={[
                    styles.thumb,
                    {
                        backgroundColor: palette.surfaceJournalHi,
                        borderRadius: Radius.sm,
                    },
                ]}
            >
                {restaurant.photo_url ? (
                    <ExpoImage
                        source={{ uri: restaurant.photo_url }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                    />
                ) : null}
            </View>

            {/* Details */}
            <View style={{ flex: 1 }}>
                <Text
                    style={[
                        Type.headlineItalic,
                        {
                            fontFamily: 'Newsreader_400Regular_Italic',
                            fontStyle: 'italic',
                            fontSize: 15,
                            color: palette.text,
                        },
                    ]}
                    numberOfLines={1}
                >
                    {restaurant.name}
                </Text>
                {restaurant.best_rating != null && (
                    <Text style={[Type.caption, { color: palette.textMuted, marginTop: 2 }]}>
                        {restaurant.best_rating.toFixed(1)}
                        {' '}
                        <Text style={{ color: palette.amberBright }}>★</Text>
                    </Text>
                )}
            </View>

            {/* Selection indicator */}
            {isSelected && (
                <View
                    style={[
                        styles.checkBadge,
                        { backgroundColor: palette.primary, borderRadius: 10 },
                    ]}
                >
                    <Text style={[Type.labelSmall, { color: palette.textInverse, fontSize: 8 }]}>✓</Text>
                </View>
            )}

            {!isSelected && (
                <Text style={[Type.caption, { color: palette.primary, fontSize: 18 }]}>+</Text>
            )}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        paddingVertical: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        gap: Spacing.sm,
    },
    thumb: {
        width: 44,
        height: 44,
        borderRadius: 4,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    checkBadge: {
        width: 20,
        height: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
