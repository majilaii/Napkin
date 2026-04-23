/**
 * AtlasCrossLinkChip — shown on the restaurant page when the viewer's
 * active Table has ≥2 logged restaurants in the same city.
 *
 * Appearance: terracotta-bordered pill, "N of M in [city] →"
 * Taps to /table/[id]/atlas/[city].
 *
 * Wireframe: atlas-canvas.html .atlas-chip
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { PressableScale } from '@/components/ui/napkin';
import { useTableAtlas } from '@/hooks/tables/useTableAtlas';

interface Props {
    tableId: string | null | undefined;
    restaurantId: string | null | undefined;
    city: string | null | undefined;
    /** Restaurant's own visit count (for the "N of M" label) */
    visitCount?: number;
    palette?: typeof Colors.light;
}

export function AtlasCrossLinkChip({
    tableId,
    restaurantId,
    city,
    visitCount = 1,
    palette: paletteProp,
}: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = paletteProp ?? Colors[scheme];
    const router = useRouter();

    const { data } = useTableAtlas(tableId);

    if (!tableId || !city || !data) return null;

    // Find the city entry in the atlas
    const cityEntry = data.cities.find(
        (c) => c.name.toLowerCase() === city.toLowerCase(),
    );

    // Only render if ≥2 restaurants in that city
    if (!cityEntry || cityEntry.spot_count < 2) return null;

    const handlePress = () => {
        router.push({
            pathname: '/table/[id]/atlas/[city]',
            params: { id: tableId, city },
        });
    };

    const chipText = `${visitCount} of ${cityEntry.spot_count} in ${city}`;

    return (
        <PressableScale onPress={handlePress} haptic="light" scaleTo={0.97}>
            <View style={[styles.chip, { borderColor: palette.primary }]}>
                <Ionicons name="location-outline" size={14} color={palette.primary} />
                <Text style={[styles.label, { color: palette.primary }]}>{chipText}</Text>
                <Ionicons name="chevron-forward" size={14} color={palette.primary} />
            </View>
        </PressableScale>
    );
}

const styles = StyleSheet.create({
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        paddingHorizontal: 14,
        paddingLeft: 12,
        paddingVertical: 10,
        minHeight: 40,
        borderWidth: 1.5,
        borderRadius: Radius.full,
        backgroundColor: '#fdf6ec',
        alignSelf: 'flex-start',
    },
    label: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
        letterSpacing: 0.2,
        fontVariant: ['tabular-nums'],
    },
});

export default AtlasCrossLinkChip;
