/**
 * Restaurant detail — v3 one-grammar page (TICKET-227 + TICKET-222).
 *
 * Arrival modes retained:
 *   1. persisted restaurant id
 *   2. Places ghost with placeId + payload
 *   3. Places ghost deep-link requiring a lookup
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Linking,
    Pressable,
    ScrollView,
    StyleSheet,
    View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, IconSize, Spacing } from '@/constants/theme';
import { ErrorState } from '@/components/ErrorState';
import { FRIEND_TEST } from '@/constants/flags';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useTables } from '@/hooks/tables/useTables';
import { useMyWishlist } from '@/hooks/wishlist/useMyWishlist';
import { useIsWishlisted } from '@/hooks/wishlist/useIsWishlisted';
import { useWishlistAdd } from '@/hooks/wishlist/useWishlistAdd';
import { useWishlistRemove } from '@/hooks/wishlist/useWishlistRemove';
import { useListsContainingRestaurant } from '@/hooks/lists/useListsContainingRestaurant';
import { useMyTikTokSourceForRestaurant } from '@/hooks/wishlist/useMyTikTokSourceForRestaurant';
import {
    restaurantFromPlace,
    useRestaurantPage,
    type RestaurantPageRestaurant,
} from '@/hooks/restaurants/useRestaurantPage';
import {
    useLazyBackfillRestaurant,
    useLookupByPlaceId,
} from '@/hooks/search/useLookupByPlaceId';
import {
    FeaturedListsSection,
    FriendsNotesSection,
    FriendsSpread,
    OnSocialsRail,
    RestaurantActions,
    RestaurantDetails,
    RestaurantNumbersBand,
    RestaurantTop,
    SavedFromTikTokPanel,
    TableNotesSection,
    YourHistoryDoorway,
    shouldShowHistoryDoorway,
} from '@/components/restaurants';
import { useRestaurantClippings } from '@/hooks/restaurants/useRestaurantClippings';
import { useRestaurantFeaturedLists } from '@/hooks/restaurants/useRestaurantFeaturedLists';
import { isInstagramSource } from '@/components/wishlist/importSourceLabel';
import { AtlasCrossLinkChip } from '@/components/atlas';
import { AddToListSheet } from '@/components/lists';
import { GatherSheet } from '@/components/gatherings';
import type { RestaurantPayload } from '@/hooks/wishlist/useWishlistAdd';
import { shouldShowRestaurantErrorShell } from '@/lib/screenLoadState';
import {
    buildFriendsSpread,
    buildRestaurantMeta,
    chooseTableNotesGroup,
    deriveNumberTiers,
} from '@/lib/restaurantPageV3';

function placePayloadToWishlistPayload(place: any): RestaurantPayload {
    return {
        external_id: place.id ?? place.external_id ?? place.placeId ?? '',
        name: place.name ?? '',
        location: {
            address: place.formattedAddress ?? undefined,
            locality: place.city ?? undefined,
            country: place.country ?? undefined,
        },
        types: place.categories ?? [],
        latitude: place.latitude ?? undefined,
        longitude: place.longitude ?? undefined,
        photoReference: place.photoReference ?? undefined,
        photoAttributionHtml: place.photoAttributionHtml ?? undefined,
        googleRating: place.googleRating ?? undefined,
        googleRatingCount: place.googleRatingCount ?? undefined,
        priceLevel: place.priceLevel ?? undefined,
        cuisine: place.cuisine ?? undefined,
    };
}

function ghostRestaurantFromPayload(payload: any): RestaurantPageRestaurant {
    return restaurantFromPlace({
        external_id: payload.id ?? payload.external_id ?? payload.placeId ?? '',
        name: payload.name ?? 'Restaurant',
        formattedAddress: payload.formattedAddress ?? undefined,
        city: payload.city ?? undefined,
        country: payload.country ?? undefined,
        cuisine: payload.cuisine ?? undefined,
        priceLevel: payload.priceLevel ?? undefined,
        photoReference: payload.photoReference ?? undefined,
        photoAttributionHtml: payload.photoAttributionHtml ?? null,
        googleRating: payload.googleRating ?? undefined,
        googleRatingCount: payload.googleRatingCount ?? undefined,
        phone: payload.phone ?? null,
        website: payload.website ?? null,
        google_maps_uri: payload.google_maps_uri ?? payload.link ?? null,
        hours: payload.hours ?? null,
    });
}

function quietOpen(url: string) {
    void Linking.openURL(url).catch(() => undefined);
}

function resolveDirectionsUrl(
    googleMapsUri: string | null,
    name: string,
    city: string | null,
): string {
    if (googleMapsUri?.trim()) return googleMapsUri;
    const query = encodeURIComponent([name, city].filter(Boolean).join(' '));
    return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

export default function RestaurantScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { user } = useAuth();
    const { id, tableId, placeId, placePayload } = useLocalSearchParams<{
        id?: string;
        tableId?: string;
        placeId?: string;
        placePayload?: string;
    }>();

    const parsedPlacePayload = useMemo(() => {
        if (!placePayload) return null;
        try {
            return JSON.parse(placePayload);
        } catch {
            return null;
        }
    }, [placePayload]);
    const restaurantId = id ?? placeId ?? null;
    const isGhost = !!placeId;
    const page = useRestaurantPage(restaurantId, tableId ?? undefined);
    const isPageLoading = page.isLoading && page.fetchStatus === 'fetching';
    const { data: tables } = useTables(user?.id);
    const hasAnyTable = (tables ?? []).length > 0;

    useMyWishlist(user?.id);
    const earlyPersistedId = page.data?.restaurant?.id
        ?? (isGhost ? undefined : restaurantId ?? undefined);
    const tiktokSource = useMyTikTokSourceForRestaurant(earlyPersistedId, user?.id);

    const payloadIsThin = !!parsedPlacePayload
        && (parsedPlacePayload.latitude == null || parsedPlacePayload.googleRating === undefined);
    const needsPlaceLookup = isGhost && !!placeId && (!parsedPlacePayload || payloadIsThin);
    const placeLookup = useLookupByPlaceId(placeId ?? null, { enabled: needsPlaceLookup });
    const ghostSource = useMemo(() => {
        if (!isGhost || (!parsedPlacePayload && !placeLookup.data)) return null;
        const merged: Record<string, unknown> = { ...(placeLookup.data ?? {}) };
        for (const [key, value] of Object.entries(parsedPlacePayload ?? {})) {
            if (value != null) merged[key] = value;
        }
        return merged as any;
    }, [isGhost, parsedPlacePayload, placeLookup.data]);
    const ghostRestaurant = useMemo(
        () => ghostSource ? ghostRestaurantFromPayload(ghostSource) : null,
        [ghostSource],
    );
    const ghostWishlistPayload = useMemo(
        () => ghostSource ? placePayloadToWishlistPayload(ghostSource) : null,
        [ghostSource],
    );
    const restaurant = page.data?.restaurant ?? ghostRestaurant;
    const ghostLookupFailed = needsPlaceLookup && placeLookup.isError;
    const showRestaurantErrorShell = shouldShowRestaurantErrorShell({
        hasError: !!page.error || ghostLookupFailed,
        hasRestaurant: !!restaurant,
        isGhost: isGhost && !ghostLookupFailed,
        isResolvedEmpty: !isPageLoading && page.data !== undefined && !page.data?.restaurant,
    });

    const persistedRow = page.data?.restaurant ?? null;
    const syncTtlMs = 30 * 24 * 60 * 60 * 1000;
    const syncedAt = persistedRow?.places_synced_at
        ? Date.parse(persistedRow.places_synced_at)
        : NaN;
    const isStale = !!persistedRow
        && !!persistedRow.external_id
        && (
            !persistedRow.city
            || (!persistedRow.photo_url && persistedRow.photo_source !== 'none')
            || persistedRow.google_rating == null
            || Number.isNaN(syncedAt)
            || Date.now() - syncedAt > syncTtlMs
        );
    useLazyBackfillRestaurant({
        enabled: isStale,
        externalId: persistedRow?.external_id ?? null,
        restaurantId: persistedRow?.id ?? null,
        tableId: tableId ?? null,
    });

    const persistedRestaurantId = page.data?.restaurant?.id
        ?? (isGhost ? undefined : restaurantId ?? undefined);
    const { data: featuredListsData } = useRestaurantFeaturedLists(
        persistedRestaurantId,
        user?.id,
    );
    const { data: clippingsData } = useRestaurantClippings(persistedRestaurantId, user?.id);
    const clippings = clippingsData?.rows ?? [];
    const bookmarked = useIsWishlisted(
        persistedRestaurantId ?? restaurant?.external_id,
        user?.id,
    );
    const wishlistAdd = useWishlistAdd(user?.id);
    const wishlistRemove = useWishlistRemove(user?.id);
    const { data: containingListIds = [] } = useListsContainingRestaurant(
        user?.id,
        persistedRestaurantId,
    );
    const bookmarkDisabled = !user?.id || !restaurant || bookmarked === undefined;
    const isSaved = bookmarked === true || containingListIds.length > 0;
    const [saveSheetOpen, setSaveSheetOpen] = useState(false);
    const [gatherSheetOpen, setGatherSheetOpen] = useState(false);

    const savePayload = useMemo<RestaurantPayload | null>(() => {
        if (ghostWishlistPayload) return ghostWishlistPayload;
        if (!restaurant?.external_id) return null;
        return placePayloadToWishlistPayload({
            id: restaurant.external_id,
            name: restaurant.name,
            formattedAddress: restaurant.address,
            city: restaurant.city,
            country: restaurant.country,
            cuisine: restaurant.cuisine,
            priceLevel: restaurant.price_level,
            googleRating: restaurant.google_rating,
            googleRatingCount: restaurant.google_rating_count,
        });
    }, [ghostWishlistPayload, restaurant]);

    const handleBookmarkToggle = useCallback(() => {
        if (bookmarkDisabled || !restaurant) return;
        if (bookmarked) {
            const targetId = persistedRestaurantId ?? wishlistAdd.data?.restaurant_id;
            if (!targetId) return;
            wishlistRemove.mutate(targetId, {
                onError: () => Alert.alert("Couldn't remove", 'Try again'),
            });
            return;
        }
        wishlistAdd.mutate(
            savePayload
                ? { restaurant: savePayload }
                : { restaurant_id: persistedRestaurantId! },
            { onError: () => Alert.alert("Couldn't save", 'Try again') },
        );
    }, [
        bookmarkDisabled,
        restaurant,
        bookmarked,
        persistedRestaurantId,
        wishlistAdd,
        wishlistRemove,
        savePayload,
    ]);

    const logSheetRestaurant = useMemo(() => {
        const row = page.data?.restaurant ?? ghostRestaurant;
        if (!row) return { name: 'Restaurant' };
        return {
            id: row.id || undefined,
            external_id: row.external_id ?? undefined,
            name: row.name,
            city: row.city,
            cuisine: row.cuisine,
            price_level: row.price_level == null ? null : '£'.repeat(row.price_level),
            placePayload: parsedPlacePayload ?? {
                id: row.external_id ?? '',
                name: row.name,
                formattedAddress: row.address,
                city: row.city,
                country: row.country,
                cuisine: row.cuisine,
                priceLevel: row.price_level,
                googleRating: row.google_rating,
                googleRatingCount: row.google_rating_count,
            },
        };
    }, [page.data?.restaurant, ghostRestaurant, parsedPlacePayload]);
    const handleLogPress = useCallback(() => {
        router.push({
            pathname: '/log-meal',
            params: {
                restaurant: JSON.stringify(logSheetRestaurant),
                ...(id ? { pageId: id } : {}),
                ...(tableId ? { initialTableId: tableId } : {}),
            },
        });
    }, [router, logSheetRestaurant, id, tableId]);

    const numberTiers = useMemo(
        () => restaurant
            ? deriveNumberTiers(page.data, restaurant, user?.id)
            : null,
        [page.data, restaurant, user?.id],
    );
    const spread = useMemo(
        () => buildFriendsSpread(numberTiers?.friendsCohort ?? []),
        [numberTiers?.friendsCohort],
    );
    const tableNotesGroup = useMemo(
        () => chooseTableNotesGroup(page.data?.table_notes ?? [], tableId),
        [page.data?.table_notes, tableId],
    );
    const directionsUrl = restaurant
        ? resolveDirectionsUrl(restaurant.google_maps_uri, restaurant.name, restaurant.city)
        : '';
    const gatherVisible = !FRIEND_TEST.hideSuppers && hasAnyTable && !!persistedRestaurantId;
    const selfLogCount = page.data?.self_log?.length ?? 0;

    if (showRestaurantErrorShell) {
        return (
            <View style={[styles.container, { backgroundColor: palette.background }]}>
                <Stack.Screen options={{ headerShown: false }} />
                <StatusBar style="dark" />
                <Pressable
                    onPress={() => router.back()}
                    accessibilityRole="button"
                    accessibilityLabel="back"
                    style={[styles.errorBack, { marginTop: insets.top + Spacing.sm }]}
                >
                    <Ionicons name="chevron-back" size={IconSize.lg} color={palette.textMuted} />
                </Pressable>
                <View style={styles.errorBody}>
                    <ErrorState
                        message="could not load this restaurant."
                        onRetry={() => {
                            if (ghostLookupFailed) void placeLookup.refetch();
                            if (restaurantId) void page.refetch();
                        }}
                    />
                </View>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: palette.background }]}>
            <Stack.Screen options={{ headerShown: false }} />
            <StatusBar style="dark" />
            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xxl }}
            >
                {(isPageLoading || (needsPlaceLookup && placeLookup.isLoading)) && !restaurant ? (
                    <View style={[styles.loading, { paddingTop: insets.top + 100 }]}>
                        <ActivityIndicator color={palette.primary} />
                    </View>
                ) : null}

                {restaurant && numberTiers ? (
                    <>
                        <RestaurantTop
                            restaurant={restaurant}
                            meta={buildRestaurantMeta(restaurant)}
                            saved={isSaved}
                            saveDisabled={bookmarkDisabled}
                            onBack={() => router.back()}
                            onSave={() => setSaveSheetOpen(true)}
                            topInset={insets.top}
                            palette={palette}
                        />
                        <RestaurantNumbersBand
                            you={numberTiers.you}
                            friends={numberTiers.friends}
                            google={numberTiers.google}
                            palette={palette}
                        />
                        <RestaurantActions
                            saved={isSaved}
                            onLog={handleLogPress}
                            onPin={() => setSaveSheetOpen(true)}
                            onDirections={() => quietOpen(directionsUrl)}
                            onWebsite={restaurant.website
                                ? () => quietOpen(
                                    restaurant.website!.startsWith('http')
                                        ? restaurant.website!
                                        : `https://${restaurant.website}`,
                                )
                                : undefined}
                            onGather={gatherVisible ? () => setGatherSheetOpen(true) : undefined}
                            palette={palette}
                        />

                        {shouldShowHistoryDoorway(selfLogCount, persistedRestaurantId) ? (
                            <YourHistoryDoorway
                                restaurantName={restaurant.name}
                                visitCount={selfLogCount}
                                regular={page.data?.regular ?? null}
                                onPress={() => router.push({
                                    pathname: '/restaurant-history',
                                    params: {
                                        id: persistedRestaurantId!,
                                        name: restaurant.name,
                                        ...(tableId ? { tableId } : {}),
                                    },
                                })}
                                palette={palette}
                            />
                        ) : null}

                        <FriendsNotesSection
                            cohort={numberTiers.friendsCohort}
                            total={page.data?.public_reviews_total ?? 0}
                            onSeeAll={() => {
                                if (!persistedRestaurantId) return;
                                router.push({
                                    pathname: '/restaurant-reviews',
                                    params: { id: persistedRestaurantId, name: restaurant.name },
                                });
                            }}
                            onReviewPress={(review) => router.push({
                                pathname: '/entry-detail',
                                params: { entryId: review.entry_id, viewAs: 'public' },
                            })}
                            palette={palette}
                        />

                        <TableNotesSection
                            group={tableNotesGroup}
                            onSeeAll={(selected) => router.push({
                                pathname: '/(tabs)/tables',
                                params: { selected, section: 'activity' },
                            })}
                            onNotePress={(note) => router.push({
                                pathname: '/entry-detail',
                                params: { entryId: note.entry_id },
                            })}
                            palette={palette}
                        />

                        {spread.visible ? (
                            <FriendsSpread bins={spread.bins} mode={spread.mode} palette={palette} />
                        ) : null}

                        <FeaturedListsSection
                            rows={featuredListsData?.rows ?? []}
                            onPress={(listId) => router.push({
                                pathname: '/list/[id]',
                                params: { id: listId },
                            })}
                            palette={palette}
                        />

                        {clippings.length === 0
                            && tiktokSource?.source.type === 'web'
                            && !isInstagramSource(tiktokSource.source) ? (
                            <SavedFromTikTokPanel source={tiktokSource.source} />
                        ) : null}
                        {clippings.length > 0 ? <OnSocialsRail clippings={clippings} /> : null}
                        {!FRIEND_TEST.hideAtlas && restaurant.city && hasAnyTable ? (
                            <View style={styles.passenger}>
                                <AtlasCrossLinkChip
                                    tableId={tableId ?? (tables?.[0]?.tables?.id ?? null)}
                                    restaurantId={persistedRestaurantId ?? null}
                                    city={restaurant.city}
                                    visitCount={page.data?.visit_count ?? 0}
                                    palette={palette}
                                />
                            </View>
                        ) : null}

                        <RestaurantDetails
                            restaurant={restaurant}
                            directionsUrl={directionsUrl}
                            palette={palette}
                        />
                    </>
                ) : null}
            </ScrollView>

            {restaurant ? (
                <AddToListSheet
                    visible={saveSheetOpen}
                    onClose={() => setSaveSheetOpen(false)}
                    userId={user?.id}
                    restaurantId={persistedRestaurantId}
                    restaurantPayload={savePayload ?? undefined}
                    restaurantName={restaurant.name}
                    showWishlist
                    isWishlisted={bookmarked}
                    onToggleWishlist={handleBookmarkToggle}
                />
            ) : null}
            {restaurant && persistedRestaurantId && gatherVisible ? (
                <GatherSheet
                    visible={gatherSheetOpen}
                    onClose={() => setGatherSheetOpen(false)}
                    restaurant={{
                        id: persistedRestaurantId,
                        name: restaurant.name,
                        city: restaurant.city ?? null,
                        photo_url: restaurant.photo_url ?? null,
                    }}
                    tableId={tableId ?? (tables?.[0]?.tables?.id ?? null)}
                />
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    loading: { alignItems: 'center' },
    errorBack: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    errorBody: { flex: 1, justifyContent: 'center' },
    passenger: { paddingHorizontal: 20, marginTop: Spacing.lg + 2 },
});
