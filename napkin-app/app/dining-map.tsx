/**
 * /dining-map — everywhere a user has eaten, as geography (TICKET-092).
 * Reuses WishlistMapView (terracotta pins, peek card, lazy location) with the
 * list toggle omitted — back chevron is the way out.
 *
 * TICKET-124: on the SELF view (no userId param, or it's your own id), a
 * mine ↔ network segmented toggle switches the pins between your own logged
 * spots and restaurants logged by people you FOLLOW. Network pins peek to the
 * followee's review (not directions). Viewing someone else's map stays their
 * spots only — no toggle.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useUserSpots } from '@/hooks/users/useUserSpots';
import { useNetworkMapPins } from '@/hooks/users/useNetworkMapPins';
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
    // Network layer is self-only: never surface your follow graph on someone
    // else's map. (Their /dining-map shows their spots, per the palate gate.)
    const isSelf = !!user?.id && identifier === user.id;
    const [source, setSource] = useState<'mine' | 'network'>('mine');
    const showNetwork = isSelf && source === 'network';

    const { data: spots } = useUserSpots(identifier);
    // Caller-scoped RPC; only fetched on the self view (null identifier = disabled).
    const { data: networkPins } = useNetworkMapPins(isSelf ? user?.id : null);
    const { coords, status, request } = useNearbyLocation();

    const mineItems: WishlistMapItem[] = useMemo(
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

    // Network pins already carry non-null coords (RPC filters them); map to the
    // WishlistMapItem network shape (author/rating/note/entryId → peek variant).
    const networkItems: WishlistMapItem[] = useMemo(
        () =>
            (networkPins ?? []).map((p) => ({
                id: p.restaurant_id,
                name: p.name,
                city: p.city,
                cuisine: p.cuisine,
                lat: p.lat,
                lng: p.lng,
                author: p.author,
                rating: p.rating,
                note: p.note,
                entryId: p.entry_id,
                othersCount: p.others_count,
            })),
        [networkPins],
    );

    const items = showNetwork ? networkItems : mineItems;
    // Network pins are all mappable; only the mine layer has coord-less spots.
    const unmappable = showNetwork ? 0 : (spots?.length ?? 0) - mineItems.length;

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
                // Network pins tap through to the followee's review (public scope).
                onOpenReview={(entryId) =>
                    router.push({ pathname: '/entry-detail', params: { entryId, viewAs: 'public' } })
                }
                sourceToggle={isSelf ? { value: source, onChange: setSource } : undefined}
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
