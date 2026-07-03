/**
 * /dining-map — everywhere a user has eaten, as geography (TICKET-092).
 * Reuses WishlistMapView (terracotta pins, peek card, lazy location) with the
 * list toggle omitted — back chevron is the way out.
 */
import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useUserSpots } from '@/hooks/users/useUserSpots';
import { useNearbyLocation } from '@/hooks/useNearbyLocation';
import { WishlistMapView, type WishlistMapItem } from '@/components/wishlist/WishlistMapView';

export default function DiningMapScreen() {
    const { userId } = useLocalSearchParams<{ userId?: string }>();
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const identifier = userId ?? user?.id;
    const { data: spots } = useUserSpots(identifier);
    const { coords, status, request } = useNearbyLocation();

    const items: WishlistMapItem[] = useMemo(
        () =>
            (spots ?? [])
                .filter((s) => s.lat != null && s.lng != null)
                .map((s) => ({
                    id: s.restaurant_id,
                    name: s.name,
                    city: s.city,
                    cuisine: s.cuisine,
                    lat: s.lat!,
                    lng: s.lng!,
                })),
        [spots],
    );
    const unmappable = (spots?.length ?? 0) - items.length;

    return (
        <View style={[styles.container, { backgroundColor: palette.background }]}>
            <Stack.Screen options={{ headerShown: false }} />

            <WishlistMapView
                items={items}
                unmappableCount={unmappable}
                userCoords={coords}
                locationStatus={status}
                onRequestLocation={request}
                onOpenRestaurant={(id) =>
                    router.push({ pathname: '/restaurant/[id]', params: { id } })
                }
                palette={palette}
            />

            {/* Frosted back — floats over the map like MapHero's */}
            <Pressable
                onPress={() => router.back()}
                style={[styles.back, { top: insets.top + 8, backgroundColor: 'rgba(253,246,236,0.92)' }]}
                hitSlop={10}
                accessibilityLabel="back"
            >
                <Ionicons name="chevron-back" size={20} color={palette.text} />
            </Pressable>

            <View style={[styles.titleChip, { top: insets.top + 12, backgroundColor: 'rgba(253,246,236,0.92)' }]}>
                <Text style={[styles.titleText, { color: palette.text }]}>dining map</Text>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    back: {
        position: 'absolute',
        left: 14,
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    titleChip: {
        position: 'absolute',
        alignSelf: 'center',
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 999,
    },
    titleText: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 16 },
});
