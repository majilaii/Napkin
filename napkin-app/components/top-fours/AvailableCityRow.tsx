/**
 * AvailableCityRow — row in the AddCityPicker sheet.
 * Shows city name + distinct restaurant count.
 */

import React from 'react';
import { Text, Pressable, StyleSheet } from 'react-native';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { AvailableCity } from '@/hooks/top-fours/useAvailableCities';

interface Props {
    city: AvailableCity;
    onPress: (city: AvailableCity) => void;
}

export function AvailableCityRow({ city, onPress }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <Pressable
            onPress={() => onPress(city)}
            style={({ pressed }) => [
                styles.row,
                {
                    borderBottomColor: palette.dividerSoft,
                    opacity: pressed ? 0.7 : 1,
                },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${city.city}, ${city.distinct_restaurant_count} places`}
        >
            <Text
                style={[
                    Type.headlineItalic,
                    {
                        fontFamily: 'Newsreader_400Regular_Italic',
                        fontStyle: 'italic',
                        fontSize: 18,
                        color: palette.text,
                        flex: 1,
                    },
                ]}
                numberOfLines={1}
            >
                {city.city}
            </Text>
            <Text style={[Type.caption, { color: palette.textMuted }]}>
                {city.distinct_restaurant_count}{' '}
                {city.distinct_restaurant_count === 1 ? 'place' : 'places'}
            </Text>
            <Text style={[Type.caption, { color: palette.textMuted, marginLeft: Spacing.sm, fontSize: 16 }]}>
                {'›'}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        paddingVertical: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
        gap: Spacing.sm,
    },
});
