/**
 * RecentlyLoggedGrid — up to 12 restaurant tiles in a 3-column grid.
 * Tap routes to /restaurant/[id]. No rating, no prose, no Table chrome.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { RestaurantTile } from '@/hooks/users/useUserProfile';

interface Props {
    restaurants: RestaurantTile[];
}

export function RecentlyLoggedGrid({ restaurants }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    if (restaurants.length === 0) return null;

    return (
        <View style={styles.section}>
            <Text style={[Type.label, styles.sectionLabel, { color: palette.textSecondary }]}>
                Recently Logged
            </Text>
            <View style={styles.grid}>
                {restaurants.map((r) => (
                    <Pressable
                        key={r.id}
                        onPress={() => router.push({ pathname: '/restaurant/[id]', params: { id: r.id } })}
                        style={({ pressed }) => [
                            styles.tile,
                            {
                                backgroundColor: pressed
                                    ? palette.surfaceContainerHigh
                                    : palette.surfaceContainerLow,
                            },
                        ]}
                    >
                        {/* Photo placeholder / initials fallback */}
                        <View style={[styles.photoBox, { backgroundColor: palette.surfaceContainerHigh }]}>
                            <Text style={[Type.labelSmall, { color: palette.textMuted }]} numberOfLines={1}>
                                {r.name.slice(0, 2).toUpperCase()}
                            </Text>
                        </View>
                        <Text style={[Type.caption, styles.tileName, { color: palette.text }]} numberOfLines={2}>
                            {r.name}
                        </Text>
                        {r.city && (
                            <Text style={[Type.caption, { color: palette.textMuted, fontSize: 10 }]} numberOfLines={1}>
                                {r.city}
                            </Text>
                        )}
                    </Pressable>
                ))}
            </View>
        </View>
    );
}

const TILE_SIZE = 100; // approximate; flex handles exact widths

const styles = StyleSheet.create({
    section: {
        marginTop: Spacing.xl,
    },
    sectionLabel: {
        marginBottom: Spacing.sm,
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: Spacing.sm,
    },
    tile: {
        width: TILE_SIZE,
        borderRadius: Radius.md,
        padding: Spacing.sm,
        alignItems: 'center',
    },
    photoBox: {
        width: TILE_SIZE - Spacing.md,
        height: TILE_SIZE - Spacing.md,
        borderRadius: Radius.md,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: Spacing.xs,
    },
    tileName: {
        textAlign: 'center',
        lineHeight: 15,
    },
});
