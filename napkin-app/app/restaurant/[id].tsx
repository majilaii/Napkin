/**
 * Restaurant detail page — V3 "Signal strip + content tabs".
 *
 * Supports three arrival modes:
 *   1. Persisted restaurant — id is a Napkin UUID
 *   2. Ghost restaurant — id is a Google Place ID AND placeId param is present
 *   3. Ghost deep-link — only placeId param present
 *
 * Route: /restaurant/[id]?tableId=...&placeId=...&placePayload=...
 *
 * Layout (top → bottom):
 *   1. Hero (photo, name, address, back, bookmark)
 *   2. Signal strip (You / Your table / Napkin / Google)
 *   3. Distribution histogram (tier-switchable)
 *   4. Tabs: Visits / Photos / Info
 *   5. Tab content
 *
 * Signal strip + tabs persist on all three tabs.
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

import { Colors, Spacing } from '@/constants/theme';
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
    type PageVisit,
} from '@/hooks/restaurants/useRestaurantPage';
import {
    RestaurantHero,
    RestaurantTabsV3,
    type RestaurantTabV3,
    FloatingLogButton,
    LogVisitSheet,
    SignalStrip,
    type SignalTier,
    type SignalCellData,
    SwitchableDistribution,
    VoicesStream,
    YourLastKicker,
    PhotosTab,
    InfoTab,
    ProfessionalTakesBand,
} from '@/components/restaurants';
import { AtlasCrossLinkChip } from '@/components/atlas';
import { FastLogSheet } from '@/components/logging';
import type { RestaurantPayload } from '@/hooks/wishlist/useWishlistAdd';

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

/** Determine the default active tier — richest available. */
function defaultTier(
    personalCount: number,
    tableCount: number,
    napkinCount: number,
): SignalTier {
    if (tableCount >= 3) return 'your_table';
    if (napkinCount > 0) return 'napkin';
    if (personalCount > 0) return 'you';
    return 'napkin';
}

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

    // ── Parse ghost payload ──────────────────────────────────────────────
    const parsedPlacePayload = useMemo(() => {
        if (!placePayload) return null;
        try { return JSON.parse(placePayload); } catch { return null; }
    }, [placePayload]);

    const restaurantId = id ?? null;
    const isGhost = !!placeId;

    // ── Data ─────────────────────────────────────────────────────────────
    const { data: pageData, isLoading, error, fetchStatus } = useRestaurantPage(
        restaurantId,
        tableId ?? undefined,
    );
    const isActuallyLoading = isLoading && fetchStatus === 'fetching';

    const { data: tables } = useTables(user?.id);
    const hasAnyTable = useMemo(() => (tables ?? []).length > 0, [tables]);

    useMyWishlist(user?.id);

    // ── Ghost synthesis ───────────────────────────────────────────────────
    const ghostRestaurant: RestaurantPageRestaurant | null = useMemo(() => {
        if (!isGhost || !parsedPlacePayload) return null;
        return ghostRestaurantFromPayload(parsedPlacePayload);
    }, [isGhost, parsedPlacePayload]);

    const ghostWishlistPayload: RestaurantPayload | null = useMemo(() => {
        if (!isGhost || !parsedPlacePayload) return null;
        return placePayloadToWishlistPayload(parsedPlacePayload);
    }, [isGhost, parsedPlacePayload]);

    const restaurant: RestaurantPageRestaurant | null =
        pageData?.restaurant ?? ghostRestaurant ?? null;

    // ── Log visit sheet state ─────────────────────────────────────────────
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
        if (!isGhost && restaurantId) return { restaurantId };
        if (placePayload) return { placePayload };
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
        router.push({ pathname: '/create-entry', params: { ...createEntryParams, mode: 'solo' } });
    };

    const handleStartRound = () => {
        setShowLogSheet(false);
        router.push({ pathname: '/create-entry', params: { ...createEntryParams, mode: 'round' } });
    };

    // ── Visit navigation ──────────────────────────────────────────────────
    const handleVisitPress = useCallback((visit: PageVisit) => {
        if (visit.kind === 'round' && visit.table_night_id) {
            router.push({ pathname: '/table-night-detail', params: { nightId: visit.table_night_id } });
        } else if (visit.kind === 'solo' && visit.entry_id) {
            router.push({ pathname: '/entry-detail', params: { entryId: visit.entry_id } });
        }
    }, [router]);

    const handlePublicReviewPress = useCallback((entryId: string) => {
        router.push({ pathname: '/entry-detail', params: { entryId, viewAs: 'public' } });
    }, [router]);

    // ── Tab state ──────────────────────────────────────────────────────────
    const [activeTab, setActiveTab] = useState<RestaurantTabV3>('visits');

    // ── "matches mine" filter for public reviews (TICKET-022 Surface C) ────
    const [matchFilterOn, setMatchFilterOn] = useState(false);

    // ── Signal strip + histogram state ────────────────────────────────────
    const personalCount = pageData?.personal?.visit_count ?? 0;
    const tableCount = pageData?.table_chip?.visit_count ?? 0;
    const napkinCount = pageData?.napkin_aggregate?.count ?? 0;

    const [activeTier, setActiveTierRaw] = useState<SignalTier>(() =>
        defaultTier(personalCount, tableCount, napkinCount)
    );

    // Track whether the user has manually tapped a tier — if so, never override with the default.
    const tierUserSelectedRef = React.useRef(false);
    const setActiveTier = React.useCallback((tier: SignalTier) => {
        tierUserSelectedRef.current = true;
        setActiveTierRaw(tier);
    }, []);

    // Re-derive default tier once data loads — but only if the user hasn't tapped yet.
    const derivedDefaultTier = useMemo(
        () => defaultTier(personalCount, tableCount, napkinCount),
        [personalCount, tableCount, napkinCount],
    );
    const tierDefaultAppliedRef = React.useRef(false);
    React.useEffect(() => {
        if (pageData && !tierDefaultAppliedRef.current && !tierUserSelectedRef.current) {
            tierDefaultAppliedRef.current = true;
            setActiveTierRaw(derivedDefaultTier);
        }
    }, [pageData, derivedDefaultTier]);

    // ── Signal cell data ──────────────────────────────────────────────────
    const youCell = useMemo((): SignalCellData => ({
        label: 'You',
        value: pageData?.personal?.average ?? null,
        sub: personalCount > 0 ? `${personalCount} visit${personalCount !== 1 ? 's' : ''}` : 'not yet',
        hasData: personalCount > 0,
    }), [pageData?.personal?.average, personalCount]);

    const yourTableCell = useMemo((): SignalCellData => {
        const chip = pageData?.table_chip;
        if (!chip) {
            return { label: 'Your table', value: null, sub: 'none been', hasData: false };
        }
        const memberStr = chip.member_count != null
            ? `${chip.member_count} of you`
            : `${chip.visit_count} visit${chip.visit_count !== 1 ? 's' : ''}`;
        return { label: 'Your table', value: chip.average, sub: memberStr, hasData: true };
    }, [pageData?.table_chip]);

    const napkinCell = useMemo((): SignalCellData => {
        const agg = pageData?.napkin_aggregate;
        if (!agg || agg.count === 0) {
            return { label: 'Napkin', value: null, sub: 'no data', hasData: false };
        }
        return {
            label: 'Napkin',
            value: agg.average,
            sub: `${agg.count} folk${agg.count !== 1 ? 's' : ''}`,
            hasData: true,
        };
    }, [pageData?.napkin_aggregate]);

    const googleCell = useMemo((): SignalCellData => {
        const r = restaurant;
        if (!r?.google_rating) {
            return { label: 'Google', value: null, sub: 'no data', hasData: false, inert: true };
        }
        const countStr = r.google_rating_count
            ? r.google_rating_count >= 1000
                ? `${(r.google_rating_count / 1000).toFixed(1)}k`
                : String(r.google_rating_count)
            : '';
        return { label: 'Google', value: r.google_rating, sub: countStr, hasData: true, inert: true };
    }, [restaurant]);

    // ── Derived: visits split by trust ring ───────────────────────────────
    const { selfVisits, tablemateVisits } = useMemo(() => {
        const visits = pageData?.visits ?? [];
        return {
            selfVisits: visits.filter(v => v.is_self),
            tablemateVisits: visits.filter(v => v.is_tablemate && !v.is_self),
        };
    }, [pageData?.visits]);

    // ── Wishlist wiring ────────────────────────────────────────────────────
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
            wishlistRemove.mutate(rid, { onError: () => Alert.alert("Couldn't remove", 'Try again') });
        } else {
            const input = persistedRestaurantId
                ? { restaurant_id: persistedRestaurantId }
                : {
                    restaurant: ghostWishlistPayload ?? placePayloadToWishlistPayload({
                        id: restaurant.external_id ?? '',
                        name: restaurant.name,
                        formattedAddress: restaurant.address,
                        city: restaurant.city,
                        country: restaurant.country,
                        cuisine: restaurant.cuisine,
                        priceLevel: restaurant.price_level,
                        googleRating: restaurant.google_rating,
                        googleRatingCount: restaurant.google_rating_count,
                    }),
                };
            wishlistAdd.mutate(input as any, { onError: () => Alert.alert("Couldn't save", 'Try again') });
        }
    }, [bookmarkDisabled, bookmarked, persistedRestaurantId, wishlistAdd, wishlistRemove, ghostWishlistPayload, restaurant]);

    const loggedBefore = personalCount > 0;

    // ── Derived: only show tap hint when ≥2 tiers have data ──────────────
    const tiersWithData = [
        youCell.hasData,
        yourTableCell.hasData,
        napkinCell.hasData,
    ].filter(Boolean).length;

    // ── Render ────────────────────────────────────────────────────────────
    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <StatusBar style="light" />
            <View style={[styles.container, { backgroundColor: palette.background }]}>
                <ScrollView
                    contentContainerStyle={{ paddingBottom: 120 }}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Loading — shown only when we have nothing yet */}
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

                    {/* Signal strip */}
                    {restaurant ? (
                        <SignalStrip
                            you={youCell}
                            yourTable={yourTableCell}
                            napkin={napkinCell}
                            google={googleCell}
                            activeTier={activeTier}
                            onTierChange={setActiveTier}
                        />
                    ) : null}

                    {/* Distribution histogram */}
                    {restaurant && pageData ? (
                        <SwitchableDistribution
                            activeTier={activeTier}
                            distributions={pageData.distributions}
                            showTapHint={tiersWithData >= 2}
                        />
                    ) : null}

                    {/* Tabs: Visits / Photos / Info */}
                    {restaurant ? (
                        <RestaurantTabsV3 active={activeTab} onChange={setActiveTab} />
                    ) : null}

                    {/* Atlas cross-link chip */}
                    {restaurant?.city && hasAnyTable && activeTab === 'visits' ? (
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

                    {/* Error state */}
                    {error ? (
                        <View style={styles.section}>
                            <Text style={[styles.mutedItalic, { color: palette.textMuted }]}>
                                Could not load visit history.
                            </Text>
                        </View>
                    ) : null}

                    {/* ── Visits tab ── */}
                    {restaurant && activeTab === 'visits' ? (
                        <View>
                            {/* Last-visit kicker */}
                            {loggedBefore && pageData?.personal?.last_visit ? (
                                <YourLastKicker
                                    date={pageData.personal.last_visit.date}
                                    rating={pageData.personal.last_visit.rating}
                                />
                            ) : null}

                            {/* Voices stream */}
                            {pageData ? (
                                <VoicesStream
                                    selfVisits={selfVisits}
                                    tablemateVisits={tablemateVisits}
                                    publicReviews={pageData.public_reviews ?? []}
                                    viewerUserId={user?.id ?? null}
                                    matchFilterOn={matchFilterOn}
                                    onToggleMatchFilter={() => setMatchFilterOn((v) => !v)}
                                    onVisitPress={handleVisitPress}
                                    onPublicReviewPress={handlePublicReviewPress}
                                />
                            ) : isActuallyLoading ? (
                                <View style={styles.sectionSpinner}>
                                    <ActivityIndicator size="small" color={palette.textMuted} />
                                </View>
                            ) : null}

                            {/* Professional takes band — TICKET-026 */}
                            <ProfessionalTakesBand
                                critics={pageData?.professional_critics ?? []}
                            />
                        </View>
                    ) : null}

                    {/* ── Photos tab ── */}
                    {restaurant && activeTab === 'photos' ? (
                        <PhotosTab
                            fromYourTable={pageData?.photos?.from_your_table ?? []}
                            fromOthers={pageData?.photos?.from_others ?? []}
                            hasTable={hasAnyTable}
                        />
                    ) : null}

                    {/* ── Info tab ── */}
                    {restaurant && activeTab === 'info' ? (
                        pageData ? (
                            <InfoTab
                                restaurant={restaurant}
                                placeDetails={pageData.place_details}
                                tablesCountWithLogs={pageData.tables_count_with_logs}
                                firstLoggedAtByYourTable={pageData.first_logged_at_by_your_table}
                            />
                        ) : (
                            <InfoTab
                                restaurant={restaurant}
                                placeDetails={{ hours_today: null, open_now: null, hours_week: null, website: null, phone: null, menu_url: null, lat: null, lng: null }}
                                tablesCountWithLogs={0}
                                firstLoggedAtByYourTable={null}
                            />
                        )
                    ) : null}
                </ScrollView>

                {/* Floating log pill */}
                {restaurant ? (
                    <FloatingLogButton
                        loggedBefore={loggedBefore}
                        onPress={() => setShowLogSheet(true)}
                    />
                ) : null}

                {/* Log visit sheet */}
                {restaurant ? (
                    <LogVisitSheet
                        visible={showLogSheet}
                        onClose={() => setShowLogSheet(false)}
                        onDismiss={handleLogSheetDismiss}
                        onQuickLog={handleQuickLog}
                        onWriteReview={handleWriteReview}
                        onStartRound={handleStartRound}
                        showRoundOption={hasAnyTable}
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
        paddingHorizontal: 22,
        paddingTop: Spacing.xl,
    },
    mutedItalic: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
    },
    chipRow: {
        paddingHorizontal: 22,
        marginTop: 14,
        marginBottom: 4,
    },
});
