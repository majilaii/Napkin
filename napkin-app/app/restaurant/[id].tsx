/**
 * Restaurant detail page — take B "letterpress" (TICKET-069 phase 2).
 *
 * Supports three arrival modes:
 *   1. Persisted restaurant — id is a Napkin UUID
 *   2. Ghost restaurant — id is a Google Place ID AND placeId param is present
 *   3. Ghost deep-link — only placeId param present
 *
 * Route: /restaurant/[id]?tableId=...&placeId=...&placePayload=...
 *
 * Canvas layout (take B letterpress):
 *   ‹ search breadcrumb
 *   Letterpress masthead: 56×1px hairline · italic 34 name · meta · hairline
 *   Signal strip (letterpress variant: surface-journal-low pill, amber nums)
 *   CTA row: LOG THIS MEAL terracotta pill + PIN outline pill
 *   Framed photo card 180px r16 (omitted when no photo)
 *   FROM YOUR TABLE — em-dash quotes + avatar · name · rating · month
 *   YOUR HISTORY — tick rows (rating · note/occasion · date)
 *   [below canvas, gated/quiet]:
 *     Distribution histogram
 *     Voices / public reviews stream
 *     Professional takes band
 *     Atlas cross-link chip
 *
 * All data hooks and TICKET-065 behaviors (collapse, lens) are preserved.
 * LogSheet replaces LogVisitSheet + FastLogSheet.
 */
import React, { useState, useMemo, useCallback } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing, Radius } from '@/constants/theme';
import { pickDefaultTier, populatedTiers } from '@/lib/restaurantSignal';
import { FRIEND_TEST } from '@/constants/flags';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useTables } from '@/hooks/tables/useTables';
import { useMyWishlist } from '@/hooks/wishlist/useMyWishlist';
import { useIsWishlisted } from '@/hooks/wishlist/useIsWishlisted';
import { useWishlistAdd } from '@/hooks/wishlist/useWishlistAdd';
import { useWishlistRemove } from '@/hooks/wishlist/useWishlistRemove';
import { useMyTikTokSourceForRestaurant } from '@/hooks/wishlist/useMyTikTokSourceForRestaurant';
import {
    useRestaurantPage,
    restaurantFromPlace,
    type RestaurantPageRestaurant,
    type PageVisit,
} from '@/hooks/restaurants/useRestaurantPage';
import {
    useLookupByPlaceId,
    useLazyBackfillRestaurant,
} from '@/hooks/search/useLookupByPlaceId';
import {
    SignalStrip,
    type SignalTier,
    type SignalCellData,
    SwitchableDistribution,
    VoicesStream,
    ProfessionalTakesBand,
    SavedFromTikTokPanel,
    MetaActions,
} from '@/components/restaurants';
import { AtlasCrossLinkChip } from '@/components/atlas';
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
        // TICKET-081: forward metadata to the ghost render when present.
        phone: payload.phone ?? null,
        website: payload.website ?? null,
        google_maps_uri: payload.google_maps_uri ?? payload.link ?? null,
        hours: payload.hours ?? null,
    });
}

/** Format a visit date for YOUR HISTORY rows: "sat 6 jun" / "14 dec" etc. */
function formatVisitDate(dateStr: string): string {
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
    if (diffDays < 7) {
        const dow = d.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
        const day = d.getDate();
        const mon = d.toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
        return `${dow} ${day} ${mon}`;
    }
    const day = d.getDate();
    const mon = d.toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
    return `${day} ${mon}`;
}

/** Format a voice date as short month: "may" / "dec" */
function formatVoiceMonth(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
}

/** Build a meta string from restaurant data: "Soho · Levantine · $$" */
function priceTierLabel(level: number | null): string {
    if (level == null) return '';
    return '$'.repeat(Math.max(1, Math.min(4, level)));
}

function buildMeta(r: RestaurantPageRestaurant | null): string {
    if (!r) return '';
    const parts: string[] = [];
    if (r.city) parts.push(r.city);
    if (r.cuisine) parts.push(r.cuisine);
    const price = priceTierLabel(r.price_level);
    if (price) parts.push(price);
    return parts.join(' · ');
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
    const isPageLoading = isLoading && fetchStatus === 'fetching';

    const { data: tables } = useTables(user?.id);
    const hasAnyTable = useMemo(() => (tables ?? []).length > 0, [tables]);

    useMyWishlist(user?.id);

    const earlyPersistedId =
        pageData?.restaurant?.id ?? (isGhost ? undefined : restaurantId ?? undefined);
    const tiktokSource = useMyTikTokSourceForRestaurant(earlyPersistedId, user?.id);

    // ── Ghost synthesis ───────────────────────────────────────────────────
    const needsPlaceLookup = isGhost && !parsedPlacePayload && !!placeId;
    const placeLookup = useLookupByPlaceId(placeId ?? null, {
        enabled: needsPlaceLookup,
    });
    const lookupPayload = placeLookup.data ?? null;

    const ghostRestaurant: RestaurantPageRestaurant | null = useMemo(() => {
        if (!isGhost) return null;
        const source = parsedPlacePayload ?? lookupPayload;
        if (!source) return null;
        return ghostRestaurantFromPayload(source);
    }, [isGhost, parsedPlacePayload, lookupPayload]);

    const ghostWishlistPayload: RestaurantPayload | null = useMemo(() => {
        if (!isGhost) return null;
        const source = parsedPlacePayload ?? lookupPayload;
        if (!source) return null;
        return placePayloadToWishlistPayload(source);
    }, [isGhost, parsedPlacePayload, lookupPayload]);

    const restaurant: RestaurantPageRestaurant | null =
        pageData?.restaurant ?? ghostRestaurant ?? null;

    // ── Lazy backfill ─────────────────────────────────────────────────────
    // TICKET-081: also heal rows that predate the metadata columns. A row with an
    // external_id but no phone AND no hours never had a Places-details lookup for
    // metadata — fire the same backfill (persist=true), which now persists
    // phone/website/google_maps_uri/hours alongside city/photo. Reuses the existing
    // trigger + upsert; no separate fetch.
    const persistedRow = pageData?.restaurant ?? null;
    const missingMetadata = !!persistedRow
        && !!persistedRow.external_id
        && !persistedRow.phone
        && !persistedRow.hours;
    const isStale = !!persistedRow
        && (!persistedRow.city
            || (!persistedRow.photo_url && persistedRow.photo_source !== 'none')
            || missingMetadata);
    useLazyBackfillRestaurant({
        enabled: isStale,
        externalId: persistedRow?.external_id ?? null,
        restaurantId: persistedRow?.id ?? null,
        tableId: tableId ?? null,
    });

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

    // ── Signal strip + histogram state ────────────────────────────────────
    const personalCount = pageData?.personal?.visit_count ?? 0;
    const tableCount = pageData?.table_chip?.visit_count ?? 0;
    const napkinCount = pageData?.napkin_aggregate?.count ?? 0;

    const [activeTier, setActiveTierRaw] = useState<SignalTier>(() =>
        pickDefaultTier({ you: personalCount > 0, table: tableCount > 0, napkin: napkinCount > 0, google: !!(restaurant?.google_rating) })
    );

    const tierUserSelectedRef = React.useRef(false);
    const setActiveTier = React.useCallback((tier: SignalTier) => {
        tierUserSelectedRef.current = true;
        setActiveTierRaw(tier);
    }, []);

    const derivedDefaultTier = useMemo(
        () => pickDefaultTier({
            you: personalCount > 0,
            table: tableCount > 0,
            napkin: napkinCount > 0,
            google: !!(restaurant?.google_rating),
        }),
        [personalCount, tableCount, napkinCount, restaurant?.google_rating],
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
        return { label: 'Table', value: chip.average, sub: memberStr, hasData: true };
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
            const payload = ghostWishlistPayload ?? (restaurant?.external_id
                ? placePayloadToWishlistPayload({
                    id: restaurant.external_id,
                    name: restaurant.name,
                    formattedAddress: restaurant.address,
                    city: restaurant.city,
                    country: restaurant.country,
                    cuisine: restaurant.cuisine,
                    priceLevel: restaurant.price_level,
                    googleRating: restaurant.google_rating,
                    googleRatingCount: restaurant.google_rating_count,
                })
                : null);
            const input = payload
                ? { restaurant: payload }
                : { restaurant_id: persistedRestaurantId! };
            wishlistAdd.mutate(input as any, { onError: () => Alert.alert("Couldn't save", 'Try again') });
        }
    }, [bookmarkDisabled, bookmarked, persistedRestaurantId, wishlistAdd, wishlistRemove, ghostWishlistPayload, restaurant]);

    // ── Signal strip collapse ─────────────────────────────────────────────
    const tiersWithData = [
        youCell.hasData,
        yourTableCell.hasData,
        napkinCell.hasData,
    ].filter(Boolean).length;

    const showCollapsedStrip = populatedTiers({
        you: youCell.hasData,
        table: yourTableCell.hasData,
        napkin: napkinCell.hasData,
        google: googleCell.hasData,
    }).length < 2;

    const hasVoices =
        selfVisits.length > 0 ||
        tablemateVisits.length > 0 ||
        (pageData?.public_reviews ?? []).length > 0;

    // ── Match-mine filter ──────────────────────────────────────────────────
    const [matchFilterOn, setMatchFilterOn] = useState(false);

    // ── Log sheet restaurant prop ─────────────────────────────────────────
    const logSheetRestaurant = useMemo(() => {
        const r = pageData?.restaurant ?? ghostRestaurant;
        if (r) {
            return {
                id: r.id ?? undefined,
                external_id: r.external_id ?? undefined,
                name: r.name,
                city: r.city,
                cuisine: r.cuisine,
                price_level: priceTierLabel(r.price_level) || null,
                placePayload: parsedPlacePayload ?? (() => {
                    if (!r) return undefined;
                    // Synthesised from DB row when no placePayload route param is present
                    // (direct navigation rather than search nav). DB rows do not store
                    // photoReference / photoAttributionHtml — TICKET-057 mirror already ran
                    // at first-log time, so photo_source != 'none' for these rows.
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
                        // photoReference / photoAttributionHtml intentionally absent:
                        // DB schema does not persist them; no re-mirror will fire.
                    };
                })(),
            };
        }
        return { name: 'Restaurant' };
    }, [pageData?.restaurant, ghostRestaurant, parsedPlacePayload]);

    // ── Log meal navigation — push to full-screen modal route ─────────────
    const handleLogPress = useCallback(() => {
        router.push({
            pathname: '/log-meal',
            params: {
                restaurant: JSON.stringify(logSheetRestaurant),
                // The page's own route id — log-meal invalidates THIS page's
                // cache on save (restaurant.id is undefined for ghost first-logs).
                ...(id ? { pageId: String(id) } : {}),
                ...(tableId ? { initialTableId: tableId } : {}),
            },
        });
    }, [router, logSheetRestaurant, tableId, id]);

    // ── Render ────────────────────────────────────────────────────────────
    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <StatusBar style="dark" />
            <View style={[styles.container, { backgroundColor: palette.background }]}>
                <ScrollView
                    contentContainerStyle={[
                        styles.scrollContent,
                        { paddingTop: insets.top + 4 },
                    ]}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Loading spinner — only when nothing to show yet */}
                    {(isPageLoading || (needsPlaceLookup && placeLookup.isLoading)) && !restaurant ? (
                        <View style={styles.loadingCenter}>
                            <ActivityIndicator color={palette.primary} />
                        </View>
                    ) : null}

                    {/* ‹ search breadcrumb */}
                    {restaurant ? (
                        <Pressable
                            onPress={() => router.back()}
                            style={styles.breadcrumb}
                            hitSlop={12}
                            accessibilityLabel="back to search"
                            accessibilityRole="button"
                        >
                            <Ionicons name="chevron-back" size={16} color={palette.textSecondary} />
                            <Text style={[styles.breadcrumbLabel, { color: palette.textSecondary }]}>
                                search
                            </Text>
                        </Pressable>
                    ) : null}

                    {/* Letterpress masthead */}
                    {restaurant ? (
                        <View style={styles.masthead}>
                            <View style={[styles.hairline, { backgroundColor: 'rgba(160,63,40,0.25)' }]} />
                            <Text style={[styles.mastheadName, { color: palette.text }]} numberOfLines={2}>
                                {restaurant.name}
                            </Text>
                            {buildMeta(restaurant) ? (
                                <Text style={[styles.mastheadMeta, { color: palette.textMuted }]}>
                                    {buildMeta(restaurant)}
                                </Text>
                            ) : null}
                            <View style={[styles.hairline, { backgroundColor: 'rgba(160,63,40,0.25)' }]} />
                        </View>
                    ) : null}

                    {/* Signal strip — letterpress variant with TICKET-065 collapse logic */}
                    {restaurant ? (
                        <SignalStrip
                            you={youCell}
                            yourTable={yourTableCell}
                            napkin={napkinCell}
                            google={googleCell}
                            activeTier={activeTier}
                            onTierChange={setActiveTier}
                            collapsed={showCollapsedStrip}
                            letterpress
                        />
                    ) : null}

                    {/* CTA row: LOG THIS MEAL + PIN */}
                    {restaurant ? (
                        <View style={styles.ctaRow}>
                            <Pressable
                                onPress={handleLogPress}
                                style={({ pressed }) => [
                                    styles.logBtn,
                                    { backgroundColor: palette.primary, opacity: pressed ? 0.85 : 1 },
                                ]}
                                accessibilityLabel="Log this meal"
                                accessibilityRole="button"
                            >
                                <Text style={styles.logBtnLabel}>LOG THIS MEAL</Text>
                            </Pressable>
                            <Pressable
                                onPress={bookmarkDisabled ? undefined : handleBookmarkPress}
                                style={({ pressed }) => [
                                    styles.pinBtn,
                                    {
                                        borderColor: 'rgba(160,63,40,0.35)',
                                        opacity: pressed ? 0.75 : 1,
                                    },
                                ]}
                                accessibilityLabel={bookmarked ? 'Unpin restaurant' : 'Pin restaurant'}
                                accessibilityRole="button"
                            >
                                <Ionicons
                                    name={bookmarked ? 'location' : 'location-outline'}
                                    size={14}
                                    color={palette.primary}
                                />
                                <Text style={[styles.pinBtnLabel, { color: palette.primary }]}>
                                    {bookmarked ? 'PINNED' : 'PIN'}
                                </Text>
                            </Pressable>
                        </View>
                    ) : null}

                    {/* Metadata: call · directions · website + hours.
                        Only for real Places restaurants (external_id present).
                        MetaActions itself returns null when no datum exists. */}
                    {restaurant?.external_id ? (
                        <MetaActions
                            phone={restaurant.phone}
                            website={restaurant.website}
                            googleMapsUri={restaurant.google_maps_uri}
                            hours={restaurant.hours}
                            name={restaurant.name}
                            city={restaurant.city}
                        />
                    ) : null}

                    {/* Framed photo card — omit when no photo */}
                    {restaurant?.photo_url ? (
                        <Image
                            source={{ uri: restaurant.photo_url }}
                            style={styles.photoCard}
                            accessibilityIgnoresInvertColors
                            resizeMode="cover"
                        />
                    ) : null}

                    {/* TikTok source panel — personal-first, before sibling voices */}
                    {restaurant && tiktokSource ? (
                        <SavedFromTikTokPanel source={tiktokSource.source} />
                    ) : null}

                    {/* FROM YOUR TABLE */}
                    {restaurant ? (
                        <View style={styles.section}>
                            <Text style={[styles.sectionKicker, { color: palette.textSecondary }]}>
                                FROM YOUR TABLE
                            </Text>
                            {tablemateVisits.filter(v => v.note).slice(0, 3).length > 0 ? (
                                tablemateVisits.filter(v => v.note).slice(0, 3).map((v) => (
                                    <View key={v.id} style={styles.voiceRow}>
                                        <Text
                                            style={[styles.voiceQuote, { color: palette.text }]}
                                            numberOfLines={3}
                                        >
                                            {`— ${v.note}`}
                                        </Text>
                                        <View style={styles.voiceMeta}>
                                            {v.avatar_url ? (
                                                <Image
                                                    source={{ uri: v.avatar_url }}
                                                    style={styles.voiceAvatar}
                                                />
                                            ) : (
                                                <View
                                                    style={[
                                                        styles.voiceAvatar,
                                                        { backgroundColor: palette.surfaceContainerHigh },
                                                    ]}
                                                />
                                            )}
                                            <Text
                                                style={[styles.voiceMetaLabel, { color: palette.textMuted }]}
                                            >
                                                {[
                                                    v.user_display_names[0],
                                                    v.rating != null ? v.rating.toFixed(1) : null,
                                                    formatVoiceMonth(v.date),
                                                ].filter(Boolean).join(' · ')}
                                            </Text>
                                        </View>
                                    </View>
                                ))
                            ) : (
                                <Text style={[styles.murmur, { color: palette.textMuted }]}>
                                    — nothing from your table yet.
                                </Text>
                            )}
                        </View>
                    ) : null}

                    {/* YOUR HISTORY */}
                    {restaurant ? (
                        <View style={styles.section}>
                            <Text style={[styles.sectionKicker, { color: palette.textSecondary }]}>
                                YOUR HISTORY
                            </Text>
                            {selfVisits.length > 0 ? (
                                selfVisits.slice(0, 5).map((v) => (
                                    <Pressable
                                        key={v.id}
                                        onPress={() => handleVisitPress(v)}
                                        style={styles.historyRow}
                                    >
                                        {v.rating != null ? (
                                            <Text style={[styles.historyRating, { color: '#d97706' }]}>
                                                {v.rating % 1 === 0 ? `${v.rating}.0` : `${v.rating}`}
                                            </Text>
                                        ) : null}
                                        <Text style={[styles.historyDot, { color: palette.textMuted }]}>·</Text>
                                        <Text
                                            style={[styles.historyNote, { color: palette.textMuted }]}
                                            numberOfLines={1}
                                        >
                                            {v.note ??
                                                (v.user_display_names.length > 1
                                                    ? `with ${v.user_display_names.slice(1).join(' & ')}`
                                                    : 'visited')}
                                        </Text>
                                        <View style={styles.historyDatePush} />
                                        <Text style={[styles.historyDate, { color: palette.textMuted }]}>
                                            {formatVisitDate(v.date)}
                                        </Text>
                                    </Pressable>
                                ))
                            ) : (
                                <Text style={[styles.murmur, { color: palette.textMuted }]}>
                                    {"— you haven’t been. or you haven’t said."}
                                </Text>
                            )}
                        </View>
                    ) : null}

                    {/* ── BELOW CANVAS — gated/quiet ────────────────────────────────── */}

                    {/* Distribution histogram */}
                    {restaurant && pageData && tiersWithData > 0 ? (
                        <View style={styles.belowSection}>
                            <SwitchableDistribution
                                activeTier={activeTier}
                                distributions={pageData.distributions}
                                showTapHint={tiersWithData >= 2}
                            />
                        </View>
                    ) : null}

                    {/* Voices stream — public reviews + tablemate visits */}
                    {restaurant && pageData && hasVoices ? (
                        <View style={styles.belowSection}>
                            <VoicesStream
                                selfVisits={[]}
                                tablemateVisits={tablemateVisits}
                                publicReviews={pageData.public_reviews ?? []}
                                viewerUserId={user?.id ?? null}
                                matchFilterOn={matchFilterOn}
                                onToggleMatchFilter={() => setMatchFilterOn((v) => !v)}
                                onVisitPress={handleVisitPress}
                                onPublicReviewPress={handlePublicReviewPress}
                                restaurantName={restaurant?.name ?? null}
                            />
                        </View>
                    ) : null}

                    {/* Professional takes */}
                    {!FRIEND_TEST.hideCritics && (
                        <View style={styles.belowSection}>
                            <ProfessionalTakesBand
                                critics={pageData?.professional_critics ?? []}
                            />
                        </View>
                    )}

                    {/* Atlas cross-link chip */}
                    {!FRIEND_TEST.hideAtlas && restaurant?.city && hasAnyTable ? (
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
                    {error && !isGhost ? (
                        <View style={styles.section}>
                            <Text style={[styles.murmur, { color: palette.textMuted }]}>
                                could not load visit history.
                            </Text>
                        </View>
                    ) : null}
                </ScrollView>

            </View>
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollContent: {
        paddingBottom: 120,
        gap: 18,
    },
    loadingCenter: {
        paddingVertical: Spacing.xxl,
        alignItems: 'center',
    },
    // Breadcrumb
    breadcrumb: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 24,
        paddingVertical: 8,
    },
    breadcrumbLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
    // Masthead
    masthead: {
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 24,
        paddingTop: 8,
        paddingBottom: 4,
    },
    hairline: {
        width: 56,
        height: 1,
    },
    mastheadName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 34,
        lineHeight: 38,
        textAlign: 'center',
    },
    mastheadMeta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        textAlign: 'center',
    },
    // CTA row
    ctaRow: {
        flexDirection: 'row',
        gap: 10,
        paddingHorizontal: 24,
        alignItems: 'stretch',
    },
    logBtn: {
        flex: 1,
        borderRadius: Radius.full,
        paddingVertical: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    logBtnLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 1.6,
        textTransform: 'uppercase',
        color: '#fffdf8',
    },
    pinBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderWidth: 1.5,
        borderRadius: Radius.full,
        paddingHorizontal: 18,
    },
    pinBtnLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
    },
    // Photo card
    photoCard: {
        marginHorizontal: 24,
        height: 180,
        borderRadius: 16,
    },
    // FROM YOUR TABLE + YOUR HISTORY
    section: {
        paddingHorizontal: 24,
        gap: 8,
    },
    sectionKicker: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
    },
    voiceRow: {
        gap: 6,
    },
    voiceQuote: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 16,
        lineHeight: 24,
    },
    voiceMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    voiceAvatar: {
        width: 20,
        height: 20,
        borderRadius: 10,
    },
    voiceMetaLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
    historyRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 8,
        paddingVertical: 8,
    },
    historyRating: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 17,
    },
    historyDot: {
        fontSize: 12,
    },
    historyNote: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        flex: 1,
    },
    historyDatePush: {
        flex: 1,
    },
    historyDate: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
    murmur: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
        lineHeight: 22,
    },
    // Below-canvas sections
    belowSection: {
        marginTop: 4,
    },
    chipRow: {
        paddingHorizontal: 22,
        marginTop: 14,
        marginBottom: 4,
    },
});
