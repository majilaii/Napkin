/**
 * Restaurant detail page — v2.
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
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useTables } from '@/hooks/tables/useTables';
import { queryKeys } from '@/lib/queryKeys';
import { useMyWishlist } from '@/hooks/wishlist/useMyWishlist';
import {
    useRestaurantPage,
    restaurantFromPlace,
    type RestaurantPageRestaurant,
} from '@/hooks/restaurants/useRestaurantPage';
import {
    RestaurantHero,
    RestaurantNumbers,
    WhoBeenRow,
    RatingDistribution,
    LogVisitSheet,
    VisitListRow,
} from '@/components/restaurants';
import { FastLogSheet } from '@/components/logging';
import type { RestaurantPayload } from '@/hooks/wishlist/useWishlistAdd';
import type { Visit } from '@/hooks/restaurants/useRestaurantHistory';

type Palette = typeof Colors.light;

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Converts a Places payload shape (from search nav params) into a
 * RestaurantPayload for WishlistHeartButton.
 */
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

/**
 * Synthesise a partial RestaurantPageRestaurant from a parsed Places payload.
 * Used to render the hero immediately for ghosts.
 */
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

// ── Screen ─────────────────────────────────────────────────────────────────────

export default function RestaurantScreen() {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;
    const router = useRouter();
    const insets = useSafeAreaInsets();
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

    // ── Determine the restaurant ID to fetch ─────────────────────────────────
    // For ghost arrivals, the `id` param IS the Google Place ID; the server resolves by external_id.
    const restaurantId = id ?? null;
    const isGhost = !!placeId;

    // ── Data ─────────────────────────────────────────────────────────────────
    const { data: pageData, isLoading, error, fetchStatus } = useRestaurantPage(
        restaurantId,
        tableId ?? undefined,
    );
    const isActuallyLoading = isLoading && fetchStatus === 'fetching';

    // Tables — to determine if user has social Tables
    const { data: tables } = useTables(user?.id);
    const hasSocialTable = useMemo(
        () => (tables ?? []).some((m) => !m.tables.is_personal),
        [tables],
    );

    // Warm wishlist cache for heart button
    useMyWishlist(user?.id);

    // ── Ghost synthesis ───────────────────────────────────────────────────────
    // Use synthesised data when server hasn't returned a restaurant yet
    const ghostRestaurant: RestaurantPageRestaurant | null = useMemo(() => {
        if (!isGhost) return null;
        if (parsedPlacePayload) return ghostRestaurantFromPayload(parsedPlacePayload);
        return null;
    }, [isGhost, parsedPlacePayload]);

    const ghostWishlistPayload: RestaurantPayload | null = useMemo(() => {
        if (!isGhost || !parsedPlacePayload) return null;
        return placePayloadToWishlistPayload(parsedPlacePayload);
    }, [isGhost, parsedPlacePayload]);

    // Resolved restaurant — prefer server data, fall back to ghost synthesis
    const restaurant: RestaurantPageRestaurant | null =
        pageData?.restaurant ?? ghostRestaurant ?? null;

    // ── Log visit sheet state ─────────────────────────────────────────────────
    const [showLogSheet, setShowLogSheet] = useState(false);
    const [showFastLogSheet, setShowFastLogSheet] = useState(false);
    // Defer opening FastLogSheet until LogVisitSheet finishes dismissing (iOS flicker guard)
    const [pendingFastLog, setPendingFastLog] = useState(false);

    const qc = useQueryClient();

    // After fast-log submit, invalidate restaurant page so hero numbers refresh
    const handleFastLogSubmitted = useCallback((_entryId: string) => {
        if (restaurantId) {
            qc.invalidateQueries({ queryKey: queryKeys.restaurants.page(restaurantId, tableId ?? undefined) });
        }
    }, [qc, restaurantId, tableId]);

    // Build navigation params for create-entry, carrying the restaurant context.
    // We always pass placePayload when we have a restaurant object in hand — this avoids
    // a redundant fetch in create-entry. restaurantId is only passed as a fallback when
    // we have the UUID but the full payload hasn't arrived yet (edge case).
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
        // Fallback: server data not yet loaded; pass the Napkin id so create-entry
        // can fetch it independently (only reached in the persisted + slow-network case).
        if (!isGhost && restaurantId) {
            return { restaurantId };
        }
        // Ghost without any payload: pass the raw placePayload param through
        if (placePayload) {
            return { placePayload };
        }
        return {};
    }, [pageData?.restaurant, ghostRestaurant, isGhost, restaurantId, placePayload]);

    const handleSoloLog = () => {
        // iOS: Modal.onDismiss is supported — defer open until LogVisitSheet
        //      finishes dismissing to avoid two-modal flicker.
        // Android: onDismiss is not implemented on Modal; swap in-place.
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

    // ── Distribution ratings ──────────────────────────────────────────────────
    const allRatings = useMemo(
        () =>
            (pageData?.visits ?? [])
                .map((v) => v.rating)
                .filter((r): r is number => r != null),
        [pageData?.visits],
    );
    const showDistribution = allRatings.length >= 3;

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <View style={[styles.container, { backgroundColor: palette.background }]}>
                {/* Top bar */}
                <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
                    <Pressable onPress={() => router.back()} hitSlop={12}>
                        <Text style={[Type.body, { color: palette.primary }]}>← Back</Text>
                    </Pressable>
                    {/* Share placeholder — future */}
                    <View style={{ width: 40 }} />
                </View>

                <ScrollView
                    contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xxl }}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Loading state — shown only when we have nothing to display yet */}
                    {isActuallyLoading && !restaurant && (
                        <View style={styles.loadingCenter}>
                            <ActivityIndicator color={palette.primary} />
                        </View>
                    )}

                    {/* Hero band */}
                    {restaurant && (
                        <RestaurantHero
                            restaurant={restaurant}
                            userId={user?.id}
                            restaurantPayloadForGhost={ghostWishlistPayload ?? undefined}
                        />
                    )}

                    {/* Numbers band */}
                    {pageData && restaurant && (
                        <RestaurantNumbers
                            personal={pageData.personal}
                            tableChip={pageData.table_chip}
                            googleRating={restaurant.google_rating}
                            googleRatingCount={restaurant.google_rating_count}
                        />
                    )}

                    {/* Ghost: only hero + Google chip */}
                    {isGhost && !pageData && ghostRestaurant && (
                        <RestaurantNumbers
                            personal={{ average: null, visit_count: 0 }}
                            tableChip={null}
                            googleRating={ghostRestaurant.google_rating}
                            googleRatingCount={ghostRestaurant.google_rating_count}
                        />
                    )}

                    {/* Log CTA */}
                    {restaurant && (
                        <View style={styles.ctaSection}>
                            <Pressable
                                onPress={() => setShowLogSheet(true)}
                                style={({ pressed }) => [
                                    styles.logButton,
                                    {
                                        backgroundColor: pressed
                                            ? palette.primaryContainer
                                            : palette.primary,
                                    },
                                ]}
                            >
                                <Text style={[Type.titleMedium, { color: '#fff' }]}>
                                    Log a visit
                                </Text>
                            </Pressable>
                        </View>
                    )}

                    {/* Secondary loading for data-dependent sections */}
                    {isActuallyLoading && restaurant && (
                        <View style={styles.sectionSpinner}>
                            <ActivityIndicator size="small" color={palette.textMuted} />
                        </View>
                    )}

                    {/* Error degraded state — still shows hero + CTA above */}
                    {error && (
                        <View style={styles.section}>
                            <Text style={[Type.bodySmall, { color: palette.textMuted, fontStyle: 'italic' }]}>
                                Could not load visit history.
                            </Text>
                        </View>
                    )}

                    {/* Rating distribution */}
                    {showDistribution && pageData && (
                        <RatingDistribution ratings={allRatings} />
                    )}

                    {/* Who's been */}
                    {pageData && pageData.whos_been.length > 0 && (
                        <WhoBeenRow users={pageData.whos_been} />
                    )}

                    {/* Visits feed */}
                    {pageData && pageData.visits.length > 0 && (
                        <View style={styles.section}>
                            <Text
                                style={[
                                    Type.label,
                                    { color: palette.textSecondary, marginBottom: Spacing.md },
                                ]}
                            >
                                Visits
                            </Text>
                            <View style={{ gap: Spacing.sm }}>
                                {pageData.visits.map((v) => (
                                    <VisitListRow
                                        key={`${v.kind}-${v.id}`}
                                        visit={v as Visit}
                                        onPress={() => handleVisitPress(v)}
                                    />
                                ))}
                            </View>
                        </View>
                    )}
                </ScrollView>

                {/* Log visit sheet — choose between solo and round */}
                {restaurant && (
                    <LogVisitSheet
                        visible={showLogSheet}
                        onClose={() => setShowLogSheet(false)}
                        onDismiss={handleLogSheetDismiss}
                        onSoloLog={handleSoloLog}
                        onStartRound={handleStartRound}
                        showRoundOption={hasSocialTable}
                    />
                )}

                {/* Fast log sheet — solo log bottom sheet with restaurant locked */}
                {restaurant && (
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
                )}
            </View>
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    topBar: {
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    loadingCenter: {
        paddingVertical: Spacing.xxl,
        alignItems: 'center',
    },
    sectionSpinner: {
        paddingVertical: Spacing.lg,
        alignItems: 'center',
    },
    ctaSection: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.lg,
    },
    logButton: {
        paddingVertical: Spacing.md,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    section: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.xl,
    },
});
