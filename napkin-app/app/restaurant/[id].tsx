/**
 * Restaurant detail page — V1 "Dossier" (Heirloom UI kit).
 *
 * Supports three arrival modes:
 *   1. Persisted restaurant — id is a Napkin UUID (arrives from feed / round / entry detail)
 *   2. Ghost restaurant — id is a Google Place ID AND placeId param is present
 *      (arrives from search via TICKET-017)
 *   3. Ghost deep-link — only placeId param present (cold path; shows spinner)
 *
 * Route: /restaurant/[id]?tableId=...&placeId=...&placePayload=...
 *
 * `tableId`     — optional; biases the Table chip in the numbers band
 * `placeId`     — present for ghost arrivals; tells the screen to treat id as external_id
 * `placePayload` — JSON-stringified Places result row from search (for immediate hero render)
 */
import React, { useState, useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
    ActivityIndicator,
    Alert,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useTables } from '@/hooks/tables/useTables';
import { queryKeys } from '@/lib/queryKeys';
import { useMyWishlist } from '@/hooks/wishlist/useMyWishlist';
import { useIsWishlisted } from '@/hooks/wishlist/useIsWishlisted';
import { useWishlistAdd } from '@/hooks/wishlist/useWishlistAdd';
import { useWishlistRemove } from '@/hooks/wishlist/useWishlistRemove';
import {
    useRestaurantPage,
    restaurantFromPlace,
    type RestaurantPageRestaurant,
} from '@/hooks/restaurants/useRestaurantPage';
import {
    RestaurantHero,
    RestaurantTabs,
    type RestaurantTab,
    TableRatingBlock,
    VoiceCard,
    FloatingLogButton,
    LogVisitSheet,
    CommunityTab,
} from '@/components/restaurants';
import { AtlasCrossLinkChip } from '@/components/atlas';
import { FastLogSheet } from '@/components/logging';
import type { RestaurantPayload } from '@/hooks/wishlist/useWishlistAdd';
import type { Visit } from '@/hooks/restaurants/useRestaurantHistory';

type Palette = typeof Colors.light;

// ── Helpers ────────────────────────────────────────────────────────────────────

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
        googleRating: payload.googleRating ?? undefined,
        googleRatingCount: payload.googleRatingCount ?? undefined,
    });
}

// Approximate RN pixel width of ~22 (canvas) with a Spacing token (Spacing.lg = 24).
const PAGE_H = 22;

export default function RestaurantScreen() {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;
    const router = useRouter();
    const { user } = useAuth();

    const { id, tableId, placeId, placePayload } = useLocalSearchParams<{
        id: string;
        tableId?: string;
        placeId?: string;
        placePayload?: string;
    }>();

    // ── Parse ghost payload from search nav ──────────────────────────────────
    const parsedPlacePayload = useMemo(() => {
        if (!placePayload) return null;
        try {
            return JSON.parse(placePayload);
        } catch {
            return null;
        }
    }, [placePayload]);

    const restaurantId = id ?? null;
    const isGhost = !!placeId;

    // ── Data ─────────────────────────────────────────────────────────────────
    const { data: pageData, isLoading, error, fetchStatus } = useRestaurantPage(
        restaurantId,
        tableId ?? undefined,
    );
    const isActuallyLoading = isLoading && fetchStatus === 'fetching';

    const { data: tables } = useTables(user?.id);
    const hasSocialTable = useMemo(
        () => (tables ?? []).length > 0,
        [tables],
    );

    useMyWishlist(user?.id);

    // ── Ghost synthesis ───────────────────────────────────────────────────────
    const ghostRestaurant: RestaurantPageRestaurant | null = useMemo(() => {
        if (!isGhost) return null;
        if (parsedPlacePayload) return ghostRestaurantFromPayload(parsedPlacePayload);
        return null;
    }, [isGhost, parsedPlacePayload]);

    const ghostWishlistPayload: RestaurantPayload | null = useMemo(() => {
        if (!isGhost || !parsedPlacePayload) return null;
        return placePayloadToWishlistPayload(parsedPlacePayload);
    }, [isGhost, parsedPlacePayload]);

    const restaurant: RestaurantPageRestaurant | null =
        pageData?.restaurant ?? ghostRestaurant ?? null;

    // ── Log visit sheet state ─────────────────────────────────────────────────
    const [showLogSheet, setShowLogSheet] = useState(false);
    const [showFastLogSheet, setShowFastLogSheet] = useState(false);
    const [pendingFastLog, setPendingFastLog] = useState(false);

    const qc = useQueryClient();

    const handleFastLogSubmitted = useCallback((_entryId: string) => {
        if (restaurantId) {
            qc.invalidateQueries({ queryKey: queryKeys.restaurants.page(restaurantId, tableId ?? undefined) });
        }
    }, [qc, restaurantId, tableId]);

    const createEntryParams = useMemo(() => {
        const r = pageData?.restaurant ?? ghostRestaurant;
        if (r) {
            return {
                placePayload: JSON.stringify({
                    id: r.external_id ?? '',
                    name: r.name,
                    formattedAddress: r.address,
                    city: r.city,
                    country: r.country,
                    cuisine: r.cuisine,
                    priceLevel: r.price_level,
                    googleRating: r.google_rating,
                    googleRatingCount: r.google_rating_count,
                }),
            };
        }
        if (!isGhost && restaurantId) {
            return { restaurantId };
        }
        if (placePayload) {
            return { placePayload };
        }
        return {};
    }, [pageData?.restaurant, ghostRestaurant, isGhost, restaurantId, placePayload]);

    const handleQuickLog = () => {
        if (Platform.OS === 'ios') {
            setPendingFastLog(true);
            setShowLogSheet(false);
        } else {
            setShowLogSheet(false);
            setShowFastLogSheet(true);
        }
    };

    const handleLogSheetDismiss = () => {
        if (pendingFastLog) {
            setPendingFastLog(false);
            setShowFastLogSheet(true);
        }
    };

    const handleWriteReview = () => {
        setShowLogSheet(false);
        router.push({
            pathname: '/create-entry',
            params: { ...createEntryParams, mode: 'solo' },
        });
    };

    const handleStartRound = () => {
        setShowLogSheet(false);
        router.push({
            pathname: '/create-entry',
            params: { ...createEntryParams, mode: 'round' },
        });
    };

    // ── Visit navigation ──────────────────────────────────────────────────────
    const handleVisitPress = (visit: Visit | { kind: string; table_night_id?: string; entry_id?: string }) => {
        if (visit.kind === 'round' && visit.table_night_id) {
            router.push({
                pathname: '/table-night-detail',
                params: { nightId: visit.table_night_id },
            });
        } else if (visit.kind === 'solo' && visit.entry_id) {
            router.push({
                pathname: '/entry-detail',
                params: { entryId: visit.entry_id },
            });
        }
    };

    // ── Tab state ──────────────────────────────────────────────────────────────
    const [activeTab, setActiveTab] = useState<RestaurantTab>('our-table');

    // ── Derived data ──────────────────────────────────────────────────────────
    const allRatings = useMemo(
        () =>
            (pageData?.visits ?? [])
                .map((v) => v.rating)
                .filter((r): r is number => r != null),
        [pageData?.visits],
    );
    const whosBeenCount = pageData?.whos_been.length ?? 0;
    const loggedBefore = (pageData?.personal.visit_count ?? 0) > 0;

    // ── Wishlist wiring for the hero bookmark ─────────────────────────────
    const persistedRestaurantId =
        pageData?.restaurant?.id ?? (isGhost ? undefined : restaurantId ?? undefined);
    const bookmarked = useIsWishlisted(persistedRestaurantId, user?.id);
    const wishlistAdd = useWishlistAdd(user?.id);
    const wishlistRemove = useWishlistRemove(user?.id);
    const bookmarkDisabled = !user?.id || !restaurant;

    const handleBookmarkPress = useCallback(() => {
        if (bookmarkDisabled || !restaurant) return;
        if (bookmarked) {
            const rid = persistedRestaurantId ?? wishlistAdd.data?.restaurant_id;
            if (!rid) return;
            wishlistRemove.mutate(rid, {
                onError: () => Alert.alert("Couldn't remove", 'Try again'),
            });
        } else {
            const input = persistedRestaurantId
                ? { restaurant_id: persistedRestaurantId }
                : { restaurant: ghostWishlistPayload ?? placePayloadToWishlistPayload({
                    id: restaurant.external_id ?? '',
                    name: restaurant.name,
                    formattedAddress: restaurant.address,
                    city: restaurant.city,
                    country: restaurant.country,
                    cuisine: restaurant.cuisine,
                    priceLevel: restaurant.price_level,
                    googleRating: restaurant.google_rating,
                    googleRatingCount: restaurant.google_rating_count,
                }) };
            wishlistAdd.mutate(input as any, {
                onError: () => Alert.alert("Couldn't save", 'Try again'),
            });
        }
    }, [
        bookmarkDisabled,
        bookmarked,
        persistedRestaurantId,
        wishlistAdd,
        wishlistRemove,
        ghostWishlistPayload,
        restaurant,
    ]);

    // ── Info tab content ─────────────────────────────────────────────────────
    const infoRows = useMemo(() => {
        if (!restaurant) return [] as { label: string; value: string }[];
        const rows: { label: string; value: string }[] = [];
        const street = [restaurant.address, restaurant.city].filter(Boolean).join(', ');
        if (street) rows.push({ label: 'Address', value: street });
        if (restaurant.cuisine) rows.push({ label: 'Cuisine', value: restaurant.cuisine });
        if (restaurant.price_level != null) {
            rows.push({ label: 'Price', value: '$'.repeat(Math.max(1, Math.min(4, restaurant.price_level))) });
        }
        if (restaurant.google_rating != null) {
            const count = restaurant.google_rating_count
                ? ` · ${restaurant.google_rating_count.toLocaleString()} ratings`
                : '';
            rows.push({
                label: 'Google',
                value: `${restaurant.google_rating.toFixed(1)}${count}`,
            });
        }
        return rows;
    }, [restaurant]);

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <StatusBar style="light" />
            <View style={[styles.container, { backgroundColor: palette.background }]}>
                <ScrollView
                    contentContainerStyle={{ paddingBottom: 120 }}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Loading state — shown only when we have nothing to display yet */}
                    {isActuallyLoading && !restaurant ? (
                        <View style={styles.loadingCenter}>
                            <ActivityIndicator color={palette.primary} />
                        </View>
                    ) : null}

                    {/* Hero */}
                    {restaurant ? (
                        <RestaurantHero
                            restaurant={restaurant}
                            onBack={() => router.back()}
                            bookmarked={bookmarked}
                            onBookmarkPress={bookmarkDisabled ? undefined : handleBookmarkPress}
                        />
                    ) : null}

                    {/* Tabs */}
                    {restaurant ? (
                        <RestaurantTabs active={activeTab} onChange={setActiveTab} />
                    ) : null}

                    {/* Atlas cross-link chip — shown when Table has ≥2 logs in this city */}
                    {restaurant?.city && hasSocialTable ? (
                        <View style={styles.chipRow}>
                            <AtlasCrossLinkChip
                                tableId={tableId ?? (tables?.[0]?.tables?.id ?? null)}
                                restaurantId={persistedRestaurantId ?? null}
                                city={restaurant.city}
                                visitCount={pageData?.visit_count ?? 1}
                                palette={palette}
                            />
                        </View>
                    ) : null}

                    {/* Error degraded state */}
                    {error ? (
                        <View style={styles.section}>
                            <Text
                                style={[
                                    Type.bodySmall,
                                    { color: palette.textMuted, fontStyle: 'italic' },
                                ]}
                            >
                                Could not load visit history.
                            </Text>
                        </View>
                    ) : null}

                    {/* Our Table */}
                    {restaurant && activeTab === 'our-table' ? (
                        <View>
                            {pageData ? (
                                <TableRatingBlock
                                    personal={pageData.personal}
                                    tableChip={pageData.table_chip}
                                    whosBeenCount={whosBeenCount}
                                    ratings={allRatings}
                                />
                            ) : isGhost ? null : (
                                <View style={styles.sectionSpinner}>
                                    <ActivityIndicator size="small" color={palette.textMuted} />
                                </View>
                            )}

                            {pageData && pageData.visits.length > 0 ? (
                                <View style={styles.voicesSection}>
                                    <Text
                                        style={[
                                            styles.sectionLabel,
                                            { color: palette.textMuted },
                                        ]}
                                    >
                                        Voices
                                    </Text>
                                    <View style={{ gap: 18 }}>
                                        {pageData.visits.slice(0, 8).map((v) => (
                                            <VoiceCard
                                                key={`${v.kind}-${v.id}`}
                                                voice={{
                                                    avatarUrl: v.avatar_url,
                                                    displayName:
                                                        v.user_display_names[0] ?? 'Tablemate',
                                                    rating: v.rating,
                                                    date: v.date,
                                                    note: v.note,
                                                }}
                                                onPress={() => handleVisitPress(v)}
                                            />
                                        ))}
                                    </View>
                                </View>
                            ) : pageData ? (
                                <View style={styles.section}>
                                    <Text
                                        style={[
                                            Type.bodySmall,
                                            {
                                                color: palette.textMuted,
                                                fontFamily: 'Newsreader_400Regular_Italic',
                                                fontSize: 14,
                                            },
                                        ]}
                                    >
                                        Nobody at your tables has been yet.
                                    </Text>
                                </View>
                            ) : null}
                        </View>
                    ) : null}

                    {/* Everyone — V4c structure, Google as external sibling signal */}
                    {restaurant && activeTab === 'critics' ? (
                        <CommunityTab
                            googleRating={restaurant.google_rating}
                            googleRatingCount={restaurant.google_rating_count}
                        />
                    ) : null}

                    {/* Info */}
                    {restaurant && activeTab === 'info' ? (
                        <View style={styles.infoSection}>
                            {infoRows.length === 0 ? (
                                <Text
                                    style={[
                                        Type.bodySmall,
                                        {
                                            color: palette.textMuted,
                                            fontFamily: 'Newsreader_400Regular_Italic',
                                        },
                                    ]}
                                >
                                    No practical info on file.
                                </Text>
                            ) : (
                                infoRows.map((row, i) => (
                                    <View
                                        key={row.label}
                                        style={[
                                            styles.infoRow,
                                            i < infoRows.length - 1 && {
                                                borderBottomColor: palette.divider,
                                                borderBottomWidth: StyleSheet.hairlineWidth,
                                            },
                                        ]}
                                    >
                                        <Text
                                            style={[
                                                styles.infoLabel,
                                                { color: palette.textMuted },
                                            ]}
                                        >
                                            {row.label}
                                        </Text>
                                        <Text
                                            style={[
                                                styles.infoValue,
                                                { color: palette.text },
                                            ]}
                                            numberOfLines={2}
                                        >
                                            {row.value}
                                        </Text>
                                    </View>
                                ))
                            )}
                        </View>
                    ) : null}
                </ScrollView>

                {/* Floating log pill */}
                {restaurant ? (
                    <FloatingLogButton
                        loggedBefore={loggedBefore}
                        onPress={() => setShowLogSheet(true)}
                    />
                ) : null}

                {/* Log visit sheet (Quick log / Write a review / Start a Round) */}
                {restaurant ? (
                    <LogVisitSheet
                        visible={showLogSheet}
                        onClose={() => setShowLogSheet(false)}
                        onDismiss={handleLogSheetDismiss}
                        onQuickLog={handleQuickLog}
                        onWriteReview={handleWriteReview}
                        onStartRound={handleStartRound}
                        showRoundOption={hasSocialTable}
                        restaurantName={restaurant.name}
                    />
                ) : null}

                {/* Fast log sheet */}
                {restaurant ? (
                    <FastLogSheet
                        visible={showFastLogSheet}
                        onClose={() => setShowFastLogSheet(false)}
                        restaurant={{
                            id: pageData?.restaurant?.id ?? undefined,
                            external_id: restaurant.external_id ?? undefined,
                            name: restaurant.name,
                            placePayload: parsedPlacePayload ?? (() => {
                                const r = pageData?.restaurant ?? ghostRestaurant;
                                if (!r) return undefined;
                                return {
                                    id: r.external_id ?? '',
                                    name: r.name,
                                    formattedAddress: r.address,
                                    city: r.city,
                                    country: r.country,
                                    cuisine: r.cuisine,
                                    priceLevel: r.price_level,
                                    googleRating: r.google_rating,
                                    googleRatingCount: r.google_rating_count,
                                };
                            })(),
                        }}
                        initialTableId={tableId}
                        onSubmitted={handleFastLogSubmitted}
                    />
                ) : null}
            </View>
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    loadingCenter: {
        paddingVertical: Spacing.xxl,
        alignItems: 'center',
    },
    sectionSpinner: {
        paddingVertical: Spacing.lg,
        alignItems: 'center',
    },
    section: {
        paddingHorizontal: PAGE_H,
        paddingTop: Spacing.xl,
    },
    voicesSection: {
        paddingHorizontal: PAGE_H,
        paddingTop: Spacing.xl,
    },
    sectionLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        marginBottom: 12,
    },
    infoSection: {
        paddingHorizontal: PAGE_H,
        paddingTop: Spacing.lg,
    },
    infoRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        paddingVertical: 14,
        gap: 16,
    },
    infoLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        flexShrink: 0,
        paddingTop: 2,
    },
    infoValue: {
        flex: 1,
        textAlign: 'right',
        fontFamily: 'Newsreader_400Regular',
        fontSize: 15,
        lineHeight: 22,
    },
    chipRow: {
        paddingHorizontal: PAGE_H,
        marginTop: 14,
        marginBottom: 4,
    },
});
