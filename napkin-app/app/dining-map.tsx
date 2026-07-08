/**
 * /dining-map — everywhere a user has eaten, as geography (TICKET-092).
 * Reuses WishlistMapView (rec'd-shaped chrome, peek card, lazy location) with
 * the List pill omitted — back chevron is the way out.
 *
 * TICKET-124/131: on the SELF view (no userId param, or it's your own id),
 * Mine · Network source pills (floating top-left, below the title row) switch
 * the pins between your own logged spots (olive teardrops) and restaurants
 * logged by people you FOLLOW (avatar pins). A network peek taps through by
 * data: a review-eligible log → the followee's review (entry-detail, public
 * scope); a thin/rating-only log → the restaurant page. Viewing someone else's
 * map stays their spots only — no pills.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useUserSpots } from '@/hooks/users/useUserSpots';
import { useNetworkMapPins } from '@/hooks/users/useNetworkMapPins';
import { useNearbyLocation } from '@/hooks/useNearbyLocation';
import { useMyWishlist } from '@/hooks/wishlist/useMyWishlist';
import { useWishlistAdd } from '@/hooks/wishlist/useWishlistAdd';
import { WishlistMapView, type WishlistMapItem } from '@/components/wishlist/WishlistMapView';
import { spotsToMapItems, networkPinsToMapItems } from '@/components/wishlist/mapItems';

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

    // Shared mappers (TICKET-131, components/wishlist/mapItems.ts): logged spots
    // → olive "been" pins; network pins → avatar pins (entryId = network variant).
    const mineItems: WishlistMapItem[] = useMemo(() => spotsToMapItems(spots), [spots]);
    const networkItems: WishlistMapItem[] = useMemo(
        () => networkPinsToMapItems(networkPins),
        [networkPins],
    );

    const items = showNetwork ? networkItems : mineItems;
    // Network pins are all mappable; only the mine layer has coord-less spots.
    const unmappable = showNetwork ? 0 : (spots?.length ?? 0) - mineItems.length;

    // Save-from-the-map (network peek cards) — self view only. Loaded wishlist
    // pages are enough: a miss shows "Save" and the add is idempotent.
    const { data: wishlistPages } = useMyWishlist(isSelf ? user?.id : null);
    const wishlistAdd = useWishlistAdd(user?.id);
    const savedRestaurantIds = useMemo(
        () =>
            new Set(
                (wishlistPages?.pages ?? [])
                    .flatMap((p) => p.data ?? [])
                    .map((i) => i.restaurant?.id)
                    .filter((id): id is string => !!id),
            ),
        [wishlistPages],
    );
    // One-tap save on this self map (no save sheet here). The peek's own
    // optimistic flip + already-saved guard moved out in TICKET-137, so BOTH live
    // here now: a local just-saved set flips the pill instantly (useWishlistAdd
    // only patches the check keys — wishlist.personal waits for its invalidate
    // refetch), rolled back on error; the guard stops a double-add re-fire.
    const [justSavedIds, setJustSavedIds] = useState<ReadonlySet<string>>(new Set());
    const savedIds = useMemo(
        () =>
            justSavedIds.size === 0
                ? savedRestaurantIds
                : new Set([...savedRestaurantIds, ...justSavedIds]),
        [savedRestaurantIds, justSavedIds],
    );
    const handleMapSave = useCallback(
        (item: WishlistMapItem) => {
            if (savedIds.has(item.id)) return;
            setJustSavedIds((prev) => new Set(prev).add(item.id));
            wishlistAdd.mutate(
                { restaurant_id: item.id },
                {
                    onError: () =>
                        setJustSavedIds((prev) => {
                            const next = new Set(prev);
                            next.delete(item.id);
                            return next;
                        }),
                },
            );
        },
        [wishlistAdd, savedIds],
    );

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
                sources={
                    isSelf
                        ? {
                              options: [
                                  { key: 'mine', label: 'Mine' },
                                  { key: 'network', label: 'Network' },
                              ],
                              value: source,
                              onChange: (k) => setSource(k as 'mine' | 'network'),
                          }
                        : undefined
                }
                save={isSelf ? { savedIds, onSave: handleMapSave } : undefined}
                // Pills sit below the frosted back chevron + title chip row.
                chromeTopOffset={insets.top + 56}
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
