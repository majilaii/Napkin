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
 * Canvas layout (reshaped 2026-06-15):
 *   Top bar: ‹ search breadcrumb + bookmark (save) icon, top-right
 *   Masthead: left-aligned italic 34 name · meta (no hairlines)
 *   Metadata: directions pill · call · website + hours (real Places rows only)
 *   Signal strip (letterpress variant: surface-journal-low pill, amber nums)
 *   CTA row: LOG THIS MEAL terracotta pill (full width)
 *   FROM YOUR TABLE — em-dash quotes + avatar · name · rating · month
 *   YOUR HISTORY — tick rows (rating · note/occasion · date)
 *   [below canvas, gated/quiet]:
 *     Distribution histogram
 *     Voices / public reviews stream
 *     Professional takes band
 *     Atlas cross-link chip
 *
 * Save: the bookmark (top-right) opens AddToListSheet — Wishlist + curated lists.
 *
 * All data hooks and TICKET-065 behaviors (collapse, lens) are preserved.
 * LogSheet replaces LogVisitSheet + FastLogSheet.
 */
import React, { useState, useMemo, useCallback } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    Linking,
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

import { Colors, Spacing } from '@/constants/theme';
import { pickDefaultTier, populatedTiers } from '@/lib/restaurantSignal';
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
    RatingPlate,
    BottomActionBar,
    resolveDirectionsUrl,
} from '@/components/restaurants';
import { AtlasCrossLinkChip } from '@/components/atlas';
import { AddToListSheet } from '@/components/lists';
import { SetTableSheet } from '@/components/suppers';
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
        hours: payload.hours ?? null, // { weekdayDescriptions } — no openNow
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
    // TICKET-081 fix-pass (Codex MEDIUM): gate the backfill on the DURABLE
    // `places_synced_at` sentinel, NOT on metadata-presence. The old
    // `missingMetadata = external_id && !phone && !hours` predicate stayed TRUE
    // forever for places that legitimately have no phone/hours, so every page
    // mount / cold start re-hit Place Details (real Google $). Once a row has been
    // synced, we do NOT re-fetch for 30 days even when phone/hours are absent —
    // the upsert stamps places_synced_at = now() on every Places write.
    // city/photo staleness still trigger (they heal pre-metadata rows on first view,
    // and that same upsert stamps the sentinel).
    const persistedRow = pageData?.restaurant ?? null;
    const SYNC_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
    const syncedAtMs = persistedRow?.places_synced_at
        ? Date.parse(persistedRow.places_synced_at)
        : NaN;
    const syncIsStale =
        Number.isNaN(syncedAtMs) || (Date.now() - syncedAtMs) > SYNC_TTL_MS;
    const isStale = !!persistedRow
        && !!persistedRow.external_id
        && (!persistedRow.city
            || (!persistedRow.photo_url && persistedRow.photo_source !== 'none')
            || syncIsStale);
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

    // ── Save wiring (wishlist + lists) ─────────────────────────────────────
    const persistedRestaurantId =
        pageData?.restaurant?.id ?? (isGhost ? undefined : restaurantId ?? undefined);
    // Fall back to external_id for ghosts so a freshly-saved ghost's bookmark
    // (and the sheet's Wishlist checkmark) fills in-session via the optimistic cache.
    const bookmarked = useIsWishlisted(persistedRestaurantId ?? restaurant?.external_id, user?.id);
    const wishlistAdd = useWishlistAdd(user?.id);
    const wishlistRemove = useWishlistRemove(user?.id);
    const { data: containingListIds = [] } = useListsContainingRestaurant(
        user?.id,
        persistedRestaurantId,
    );
    const bookmarkDisabled = !user?.id || !restaurant;
    // Pin reads "saved" when the restaurant is wishlisted OR in any curated list.
    const isSaved = bookmarked || containingListIds.length > 0;
    const [saveSheetOpen, setSaveSheetOpen] = useState(false);
    // Supper v2: "set a table" here (restaurant-anchored). Needs a persisted restaurant
    // + at least one Table.
    const [setTableSheetOpen, setSetTableSheetOpen] = useState(false);

    // Payload used for BOTH the wishlist toggle and list adds (ghost-safe: a
    // not-yet-persisted restaurant carries its Places payload so the server upserts).
    const savePayload: RestaurantPayload | null = useMemo(() => {
        if (ghostWishlistPayload) return ghostWishlistPayload;
        if (restaurant?.external_id) {
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
        }
        return null;
    }, [ghostWishlistPayload, restaurant]);

    const handleBookmarkPress = useCallback(() => {
        if (bookmarkDisabled || !restaurant) return;
        if (bookmarked) {
            const rid = persistedRestaurantId ?? wishlistAdd.data?.restaurant_id;
            if (!rid) return;
            wishlistRemove.mutate(rid, { onError: () => Alert.alert("Couldn't remove", 'Try again') });
        } else {
            const input = savePayload
                ? { restaurant: savePayload }
                : { restaurant_id: persistedRestaurantId! };
            wishlistAdd.mutate(input as any, { onError: () => Alert.alert("Couldn't save", 'Try again') });
        }
    }, [bookmarkDisabled, bookmarked, persistedRestaurantId, wishlistAdd, wishlistRemove, savePayload, restaurant]);

    // ── Relationship line — "pinned · been twice · last june" ────────────
    const relationshipLine = useMemo(() => {
        const parts: string[] = [];
        if (isSaved) parts.push('pinned');
        if (personalCount > 0) {
            parts.push(
                personalCount === 1
                    ? 'been once'
                    : personalCount === 2
                        ? 'been twice'
                        : `been ${personalCount} times`,
            );
            const latest = selfVisits.reduce<string | null>(
                (max, v) => (max == null || v.date > max ? v.date : max),
                null,
            );
            if (latest) {
                const mon = new Date(latest)
                    .toLocaleDateString('en-US', { month: 'long' })
                    .toLowerCase();
                parts.push(`last ${mon}`);
            }
        }
        return parts.length > 0 ? parts.join(' · ') : null;
    }, [isSaved, personalCount, selfVisits]);

    const handleDirections = useCallback(() => {
        if (!restaurant) return;
        Linking.openURL(
            resolveDirectionsUrl(restaurant.google_maps_uri ?? null, restaurant.name, restaurant.city ?? null),
        ).catch(() => {});
    }, [restaurant]);

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

    // Cold restaurant: no Napkin signal at all (no self/tablemate/public voices, no
    // you/table/napkin numbers). Google is external and never makes a page "warm".
    // When cold, suppress the lonely strip + the two apology murmurs and show one
    // warm "be the first" block instead.
    const napkinSignalCount = populatedTiers({
        you: youCell.hasData,
        table: yourTableCell.hasData,
        napkin: napkinCell.hasData,
        google: false,
    }).length;
    const isColdRestaurant = !!restaurant && !hasVoices && napkinSignalCount === 0;

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

                    {/* Top bar: ‹ search breadcrumb only — save lives in the dock now */}
                    {restaurant ? (
                        <View style={styles.topBar}>
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
                        </View>
                    ) : null}

                    {/* Masthead — name + meta left, the plate (your number) right.
                        The plate is the page's anchor object: rated = terracotta
                        numeral on a warm plate; unrated = dashed waiting plate. */}
                    {restaurant ? (
                        <View style={styles.mastheadRow}>
                            <View style={styles.mastheadText}>
                                <Text style={[styles.mastheadName, { color: palette.text }]} numberOfLines={3}>
                                    {restaurant.name}
                                </Text>
                                {buildMeta(restaurant) ? (
                                    <Text style={[styles.mastheadMeta, { color: palette.textMuted }]}>
                                        {buildMeta(restaurant)}
                                    </Text>
                                ) : null}
                                {relationshipLine ? (
                                    <Text style={[styles.relationshipLine, { color: palette.textSecondary }]}>
                                        {relationshipLine}
                                    </Text>
                                ) : null}
                            </View>
                            <RatingPlate rating={pageData?.personal?.average ?? null} palette={palette} />
                        </View>
                    ) : null}

                    {/* Metadata: directions · call · website + hours — right under the
                        masthead so directions isn't buried mid-stack. Real Places rows only;
                        MetaActions returns null when no datum exists. */}
                    {restaurant?.external_id ? (
                        <MetaActions
                            phone={restaurant.phone}
                            website={restaurant.website}
                            googleMapsUri={restaurant.google_maps_uri}
                            hours={restaurant.hours}
                            name={restaurant.name}
                            city={restaurant.city}
                            showDirections={false}
                        />
                    ) : null}

                    {/* Quiet save-provenance line — sits with the metadata, not as a
                        hero card. Only when this restaurant was saved from TikTok. */}
                    {restaurant && tiktokSource ? (
                        <SavedFromTikTokPanel source={tiktokSource.source} />
                    ) : null}

                    {/* Signal strip — letterpress variant with TICKET-065 collapse logic.
                        Hidden on a cold restaurant (a lonely 1-cell pill reads as a bug). */}
                    {restaurant && !isColdRestaurant ? (
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

                    {/* Cold restaurant — one confident line + the external number,
                        set quietly. The waiting plate above already carries the
                        invitation; no mournful murmurs, no Google-as-hero card. */}
                    {isColdRestaurant ? (
                        <View style={styles.coldBlock}>
                            <Text style={[styles.coldHeadline, { color: palette.text }]}>
                                No one you know has been.
                            </Text>
                            {googleCell.hasData ? (
                                <Text style={[styles.coldGoogle, { color: palette.textMuted }]}>
                                    {`Google · ${googleCell.value}${googleCell.sub ? ` (${googleCell.sub})` : ''}`}
                                </Text>
                            ) : null}
                        </View>
                    ) : null}

                    {/* FROM YOUR TABLE — only when there are real quotes. Absence is
                        stated once by the cold block, not per-section. */}
                    {restaurant && tablemateVisits.some(v => v.note) ? (
                        <View style={styles.section}>
                            <Text style={[styles.sectionKicker, { color: palette.textSecondary }]}>
                                FROM YOUR TABLE
                            </Text>
                            {tablemateVisits.filter(v => v.note).slice(0, 3).map((v) => (
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
                                ))}
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
                                /* Not been yet — hold the ledger's space with two
                                   ghosted rules instead of narrating the absence. */
                                <View style={styles.ghostRules}>
                                    <View style={[styles.ghostRule, { backgroundColor: palette.ruleWarmNib }]} />
                                    <View style={[styles.ghostRule, { backgroundColor: palette.ruleWarmNib }]} />
                                </View>
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

                {/* Action dock — log (sole primary) · save · directions · set a table */}
                {restaurant ? (
                    <BottomActionBar
                        onLogPress={handleLogPress}
                        saved={isSaved}
                        onSavePress={() => setSaveSheetOpen(true)}
                        saveDisabled={bookmarkDisabled}
                        onDirectionsPress={handleDirections}
                        showSetTable={!FRIEND_TEST.hideSuppers && hasAnyTable && !!persistedRestaurantId}
                        onSetTablePress={() => setSetTableSheetOpen(true)}
                    />
                ) : null}
            </View>

            {/* Save sheet — pin opens this: Wishlist + curated lists + new list */}
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
                    onToggleWishlist={handleBookmarkPress}
                />
            ) : null}

            {/* Supper v2: set a table here (restaurant-anchored creation) */}
            {restaurant && persistedRestaurantId && !FRIEND_TEST.hideSuppers ? (
                <SetTableSheet
                    visible={setTableSheetOpen}
                    onClose={() => setSetTableSheetOpen(false)}
                    restaurant={{
                        id: persistedRestaurantId,
                        name: restaurant.name,
                        city: restaurant.city ?? null,
                        photo_url: restaurant.photo_url ?? null,
                    }}
                    tableId={tableId ?? (tables?.[0]?.tables?.id ?? null)}
                />
            ) : null}
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollContent: {
        paddingBottom: 150, // clears the action dock + its fade
        gap: 18,
    },
    loadingCenter: {
        paddingVertical: Spacing.xxl,
        alignItems: 'center',
    },
    // Breadcrumb
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 24,
        paddingVertical: 8,
    },
    breadcrumb: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    breadcrumbLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
    // Masthead — name/meta/relationship left, the plate right
    mastheadRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 16,
        paddingHorizontal: 24,
        paddingTop: 4,
        paddingBottom: 2,
    },
    mastheadText: {
        flex: 1,
        alignItems: 'flex-start',
        gap: 6,
    },
    mastheadName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 30,
        lineHeight: 34,
        textAlign: 'left',
    },
    mastheadMeta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        textAlign: 'left',
    },
    relationshipLine: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
        marginTop: 4,
    },
    // Cold restaurant — one confident line + the external number, quiet
    coldBlock: {
        paddingHorizontal: 24,
        gap: 6,
    },
    coldHeadline: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 17,
        lineHeight: 24,
    },
    coldGoogle: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
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
    // Ghosted ledger rules — hold YOUR HISTORY's space before the first entry
    ghostRules: {
        gap: 16,
        paddingTop: 10,
        paddingBottom: 4,
        opacity: 0.5,
    },
    ghostRule: {
        height: 1,
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
