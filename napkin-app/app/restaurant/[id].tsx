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
 *     Reviews stream + all-reviews doorway
 *     Featured-in-lists band
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
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Colors, IconSize, Spacing } from '@/constants/theme';
import { ErrorState } from '@/components/ErrorState';
import { pickDefaultTier, populatedTiers } from '@/lib/restaurantSignal';
import { derivePlaceTags } from '@/lib/placeTags';
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
import { useReserveLink } from '@/hooks/restaurants/useReserveLink';
import { findBookingUrl } from '@/lib/reserveLink';
import {
    type SignalTier,
    type SignalCellData,
    SwitchableDistribution,
    VoicesStream,
    AllReviewsFolio,
    FeaturedInListsBand,
    SavedFromTikTokPanel,
    OnSocialsRail,
    MapHero,
    UtilityPills,
    ScoreBand,
    BottomActionBar,
} from '@/components/restaurants';
import { useRestaurantClippings } from '@/hooks/restaurants/useRestaurantClippings';
import { useRestaurantFeaturedLists } from '@/hooks/restaurants/useRestaurantFeaturedLists';
import { isInstagramSource } from '@/components/wishlist/importSourceLabel';
import { AtlasCrossLinkChip } from '@/components/atlas';
import { AddToListSheet } from '@/components/lists';
import { SetTableSheet } from '@/components/suppers';
// TICKET-095: gather the table (propose a future date here)
import { GatherSheet } from '@/components/gatherings';
import type { RestaurantPayload } from '@/hooks/wishlist/useWishlistAdd';
import { shouldShowRestaurantErrorShell } from '@/lib/screenLoadState';

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

/** Format a visit date for YOUR HISTORY rows (design 2a): "16 APR". */
function formatVisitDate(dateStr: string): string {
    const d = new Date(dateStr);
    const day = d.getDate();
    const mon = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    return `${day} ${mon}`;
}

/** Review-line date: "16 Apr". */
function formatQuoteDate(dateStr: string): string {
    const d = new Date(dateStr);
    return `${d.getDate()} ${d.toLocaleDateString('en-US', { month: 'short' })}`;
}

/** Build a meta string from restaurant data: "Soho · Levantine · $$" */
function priceTierLabel(level: number | null): string {
    if (level == null) return '';
    return '$'.repeat(Math.max(1, Math.min(4, level)));
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
    const { data: pageData, isLoading, error, fetchStatus, refetch } = useRestaurantPage(
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
    // Thin payload (old deep link, stale search cache, pre-fix row) → heal via
    // Place Details and merge. `latitude`/`googleRating` are the canaries: the
    // full sanitized object always carries both keys.
    const payloadIsThin =
        !!parsedPlacePayload &&
        (parsedPlacePayload.latitude == null || parsedPlacePayload.googleRating === undefined);
    const needsPlaceLookup = isGhost && !!placeId && (!parsedPlacePayload || payloadIsThin);
    const placeLookup = useLookupByPlaceId(placeId ?? null, {
        enabled: needsPlaceLookup,
    });
    const lookupPayload = placeLookup.data ?? null;

    // Merged ghost source: lookup fills anything the payload lacks; the
    // payload's non-null fields win (it's what the user tapped on).
    const ghostSource = useMemo(() => {
        if (!isGhost) return null;
        if (!parsedPlacePayload && !lookupPayload) return null;
        const base: Record<string, unknown> = { ...(lookupPayload ?? {}) };
        for (const [k, v] of Object.entries(parsedPlacePayload ?? {})) {
            if (v != null) base[k] = v;
        }
        return base as any;
    }, [isGhost, parsedPlacePayload, lookupPayload]);

    const ghostRestaurant: RestaurantPageRestaurant | null = useMemo(() => {
        if (!ghostSource) return null;
        return ghostRestaurantFromPayload(ghostSource);
    }, [ghostSource]);

    const ghostWishlistPayload: RestaurantPayload | null = useMemo(() => {
        if (!ghostSource) return null;
        return placePayloadToWishlistPayload(ghostSource);
    }, [ghostSource]);

    const restaurant: RestaurantPageRestaurant | null =
        pageData?.restaurant ?? ghostRestaurant ?? null;
    // TICKET-217 adversarial review: a ghost deep link whose Place lookup
    // failed has nothing to render either — the ghost exemption only holds
    // while the payload/lookup path is still viable.
    const ghostLookupFailed = needsPlaceLookup && placeLookup.isError;
    const showRestaurantErrorShell = shouldShowRestaurantErrorShell({
        hasError: !!error || ghostLookupFailed,
        hasRestaurant: !!restaurant,
        isGhost: isGhost && !ghostLookupFailed,
        // A deleted/unknown id resolves 200 with restaurant: null — not an
        // error — and used to paint blank paper with no back control.
        isResolvedEmpty: !isPageLoading && pageData !== undefined && !pageData?.restaurant,
    });

    // ── Lazy backfill ─────────────────────────────────────────────────────
    // TICKET-081 fix-pass (Codex MEDIUM): gate the backfill on the DURABLE
    // `places_synced_at` sentinel, NOT on metadata-presence. The old
    // `missingMetadata = external_id && !phone && !hours` predicate stayed TRUE
    // forever for places that legitimately have no phone/hours, so every page
    // mount / cold start re-hit Place Details (real Google $). Once a row has been
    // synced, we do NOT re-fetch for 30 days merely because phone/hours are absent.
    // Rating absence deliberately overrides that sentinel so rows written by the
    // skinny attestation regression heal on view; the 24h attestation cache bounds
    // paid Details cost. City/photo staleness still trigger as before.
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
            || persistedRow.google_rating == null
            || syncIsStale);
    useLazyBackfillRestaurant({
        enabled: isStale,
        externalId: persistedRow?.external_id ?? null,
        restaurantId: persistedRow?.id ?? null,
        tableId: tableId ?? null,
    });

    // ── Reserve link (TICKET-149) ─────────────────────────────────────────
    // Places exposes no booking field, so the server resolves the venue's
    // real booking page from its own website and caches it on the row. Fire
    // the resolver only when the row was never checked (or a null check went
    // stale — same 30-day TTL as the metadata backfill). Ghosts and
    // not-yet-resolved rows fall back to a client-side tier-0 check: the
    // stored website itself being a booking page. No URL → no Reserve pill.
    const reserveCheckedMs = persistedRow?.reserve_url_checked_at
        ? Date.parse(persistedRow.reserve_url_checked_at)
        : NaN;
    const reserveCheckIsStale =
        Number.isNaN(reserveCheckedMs) || (Date.now() - reserveCheckedMs) > SYNC_TTL_MS;
    const reserveLink = useReserveLink(
        persistedRow?.id ?? null,
        !!persistedRow && !persistedRow.reserve_url && reserveCheckIsStale,
    );
    const reserveUrl =
        persistedRow?.reserve_url
        ?? reserveLink.data?.reserve_url
        ?? findBookingUrl(restaurant?.website);

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

    // TICKET-154: the all-reviews page (Letterboxd film → Reviews).
    const handleSeeAllReviews = useCallback(() => {
        const targetId = pageData?.restaurant?.id;
        if (!targetId) return;
        router.push({
            pathname: '/restaurant-reviews',
            params: { id: targetId, name: pageData?.restaurant?.name ?? '' },
        });
    }, [router, pageData?.restaurant?.id, pageData?.restaurant?.name]);

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
    const { data: featuredListsData } = useRestaurantFeaturedLists(
        persistedRestaurantId,
        user?.id,
    );
    // TICKET-156: ON SOCIALS rail — its OWN independent query (never blocks the
    // page's hero / score / CTA). clippings gates BOTH the rail and the
    // SavedFromTikTokPanel fallback (the panel survives only when the rail is empty
    // AND the viewer has their own plain non-IG web source).
    const { data: clippingsData } = useRestaurantClippings(persistedRestaurantId, user?.id);
    const clippings = clippingsData?.rows ?? [];
    // Fall back to external_id for ghosts so a freshly-saved ghost's bookmark
    // (and the sheet's Wishlist checkmark) fills in-session via the optimistic cache.
    const bookmarked = useIsWishlisted(persistedRestaurantId ?? restaurant?.external_id, user?.id);
    const wishlistAdd = useWishlistAdd(user?.id);
    const wishlistRemove = useWishlistRemove(user?.id);
    const { data: containingListIds = [] } = useListsContainingRestaurant(
        user?.id,
        persistedRestaurantId,
    );
    const bookmarkDisabled = !user?.id || !restaurant || bookmarked === undefined;
    // Pin reads "saved" when the restaurant is wishlisted OR in any curated list.
    const isSaved = bookmarked || containingListIds.length > 0;
    const [saveSheetOpen, setSaveSheetOpen] = useState(false);
    // Supper v2: "set a table" here (restaurant-anchored). Needs a persisted restaurant
    // + at least one Table.
    const [setTableSheetOpen, setSetTableSheetOpen] = useState(false);
    // TICKET-095: "gather the table" — same gate as set-a-table (persisted
    // restaurant + at least one Table; hidden with the supper curtain).
    const [gatherSheetOpen, setGatherSheetOpen] = useState(false);

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

    // ── Hero data (design 2a) ─────────────────────────────────────────────
    // Coordinates: persisted place_details first, then the merged ghost source.
    const heroCoords = useMemo(() => {
        const pd = pageData?.place_details;
        if (pd?.lat != null && pd?.lng != null) return { lat: pd.lat, lng: pd.lng };
        if (ghostSource?.latitude != null && ghostSource?.longitude != null) {
            return { lat: ghostSource.latitude as number, lng: ghostSource.longitude as number };
        }
        return null;
    }, [pageData?.place_details, ghostSource]);

    // Tag chips: persisted place_types (stored at upsert), else the ghost's
    // Places categories. Cuisine is excluded (the kicker already says it).
    const tagChips = useMemo(
        () => derivePlaceTags(
            ((pageData?.restaurant as any)?.place_types as string[] | null | undefined)
                ?? (ghostSource?.categories as string[] | undefined)
                ?? null,
            restaurant?.cuisine ?? null,
        ),
        [pageData?.restaurant, ghostSource, restaurant?.cuisine],
    );

    const heroKicker = restaurant
        ? [restaurant.cuisine, restaurant.city].filter(Boolean).join(' · ') || null
        : null;
    const heroPrice = restaurant ? priceTierLabel(restaurant.price_level) || null : null;

    // The single review line (design 2a): newest visit note from you or a
    // tablemate; "no one's written…" invitation otherwise.
    const reviewQuote = useMemo(() => {
        const visits = pageData?.visits ?? [];
        return visits.find((v) => v.note && v.note.trim() !== '') ?? null;
    }, [pageData?.visits]);

    // ── Signal strip collapse ─────────────────────────────────────────────
    const hasVoices =
        selfVisits.length > 0 ||
        tablemateVisits.length > 0 ||
        (pageData?.public_reviews ?? []).length > 0;
    // Your own written reviews belong in the REVIEWS band (founder, 2026-07-22 —
    // "I've reviewed Tenmaru a few times, why is it not under reviews?"). The old
    // split (self history ONLY in YOUR HISTORY) left the note text with no home
    // on the page. Note-bearing self visits now feed the band; noteless visits
    // stay ledger-only.
    const selfReviewVisits = useMemo(
        () => selfVisits.filter((v) => !!v.note?.trim()),
        [selfVisits],
    );
    // TICKET-168 [review-1 FAIL-1]: this MUST stay the band's REAL render
    // predicate (exactly what VoicesStream is fed), never a superset — the
    // stream mount + the quiet all-reviews fallback both key on THIS.
    const voicesVisible =
        selfReviewVisits.length > 0 ||
        tablemateVisits.length > 0 ||
        (pageData?.public_reviews ?? []).length > 0;

    // Any rating anywhere? Gates the histogram — a zeroed frame is scaffolding,
    // not signal (founder, 2026-07-22).
    const hasAnyRatings = useMemo(() => {
        const d = pageData?.distributions_half;
        if (!d) return false;
        return [d.you, d.your_table, d.napkin].some(
            (bins) => Array.isArray(bins) && bins.some((n) => n > 0),
        );
    }, [pageData?.distributions_half]);

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

    if (showRestaurantErrorShell) {
        return (
            <>
                <Stack.Screen options={{ headerShown: false }} />
                <StatusBar style="dark" />
                <View
                    style={[
                        styles.errorShell,
                        { backgroundColor: palette.background, paddingTop: insets.top + Spacing.sm },
                    ]}
                >
                    <Pressable
                        onPress={() => router.back()}
                        hitSlop={12}
                        style={styles.errorBack}
                        accessibilityRole="button"
                        accessibilityLabel="back"
                    >
                        <Ionicons name="chevron-back" size={IconSize.lg} color={palette.textMuted} />
                    </Pressable>
                    <View style={styles.errorBody}>
                        <ErrorState
                            message="could not load this restaurant."
                            onRetry={() => {
                                if (ghostLookupFailed) void placeLookup.refetch();
                                if (restaurantId) void refetch();
                            }}
                        />
                    </View>
                </View>
            </>
        );
    }

    // ── Render ────────────────────────────────────────────────────────────
    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <StatusBar style="dark" />
            <View style={[styles.container, { backgroundColor: palette.background }]}>
                <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Loading spinner — only when nothing to show yet */}
                    {(isPageLoading || (needsPlaceLookup && placeLookup.isLoading)) && !restaurant ? (
                        <View style={[styles.loadingCenter, { paddingTop: insets.top + 60 }]}>
                            <ActivityIndicator color={palette.primary} />
                        </View>
                    ) : null}

                    {/* Map hero (design 2a) — faded warm map keeps the page's geographic
                        identity and left-masthead hierarchy. Falls back to flat paper
                        when there are no coordinates. */}
                    {restaurant ? (
                        <MapHero
                            lat={heroCoords?.lat ?? null}
                            lng={heroCoords?.lng ?? null}
                            kicker={heroKicker}
                            priceLabel={heroPrice}
                            name={restaurant.name}
                            relationshipLine={relationshipLine}
                            onBack={() => router.back()}
                            topInset={insets.top}
                            palette={palette}
                        />
                    ) : null}

                    {/* Call · Website · Directions pills + quiet hours line */}
                    {restaurant ? (
                        <UtilityPills
                            phone={restaurant.phone}
                            website={restaurant.website}
                            googleMapsUri={restaurant.google_maps_uri}
                            name={restaurant.name}
                            city={restaurant.city}
                            hours={restaurant.hours}
                            reserveUrl={reserveUrl}
                            palette={palette}
                        />
                    ) : null}

                    {/* Tag chips — what kind of place this is (Places taxonomy) */}
                    {restaurant && tagChips.length > 0 ? (
                        <View style={styles.tagRow}>
                            {tagChips.map((t) => (
                                <View
                                    key={t}
                                    style={[styles.tagChip, { backgroundColor: palette.surfaceJournalLow }]}
                                >
                                    <Text style={[styles.tagChipText, { color: palette.textSecondary }]}>
                                        {t}
                                    </Text>
                                </View>
                            ))}
                        </View>
                    ) : null}

                    {/* Quiet save-provenance line — sits with the metadata, not as a
                        hero card. TICKET-156: the ON SOCIALS rail replaces this
                        whenever it has ≥1 card; the quiet line survives ONLY for the
                        one case the rail structurally can't cover — the viewer's own
                        plain (non-Instagram) web link. */}
                    {restaurant
                        && clippings.length === 0
                        && tiktokSource
                        && tiktokSource.source.type === 'web'
                        && !isInstagramSource(tiktokSource.source) ? (
                        <SavedFromTikTokPanel source={tiktokSource.source} />
                    ) : null}

                    {/* Score band (design 2a) — always renders its skeleton; empty
                        tiers show ghosted "—" so a cold page keeps the warm bones. */}
                    {restaurant ? (
                        <ScoreBand
                            you={youCell}
                            yourTable={yourTableCell}
                            napkin={napkinCell}
                            google={googleCell}
                            palette={palette}
                        />
                    ) : null}

                    {/* YOUR HISTORY (design 2a) — amber numeral · companions · caps
                        date. Hidden with zero visits: the empty-ledger ghost rows
                        read as old-design scaffolding next to the rebuilt bands
                        (founder, 2026-07-22 — cold pages collapse to essentials). */}
                    {restaurant && selfVisits.length > 0 ? (
                        <View style={styles.section}>
                            <View style={styles.sectionHead}>
                                <Text style={[styles.sectionKicker, { color: palette.textMuted }]}>
                                    YOUR HISTORY
                                </Text>
                                <Text style={[styles.sectionCount, { color: palette.textMuted }]}>
                                    {`${selfVisits.length} visit${selfVisits.length !== 1 ? 's' : ''}`}
                                </Text>
                            </View>
                            {selfVisits.slice(0, 5).map((v, i, arr) => (
                                <Pressable
                                    key={v.id}
                                    onPress={() => handleVisitPress(v)}
                                    style={[
                                        styles.historyRow,
                                        i < arr.length - 1 && {
                                            borderBottomWidth: 1,
                                            borderBottomColor: 'rgba(28,28,25,0.06)',
                                        },
                                    ]}
                                >
                                    <Text style={[styles.historyRating, { color: palette.amberBright }]}>
                                        {v.rating != null ? v.rating.toFixed(1) : '—'}
                                    </Text>
                                    <Text
                                        style={[styles.historyNote, { color: palette.textSecondary }]}
                                        numberOfLines={1}
                                    >
                                        {v.user_display_names.length > 1
                                            ? `with ${v.user_display_names.slice(1).join(' & ')}`
                                            : 'on your own'}
                                    </Text>
                                    <Text style={[styles.historyDate, { color: palette.textMuted }]}>
                                        {formatVisitDate(v.date)}
                                    </Text>
                                </Pressable>
                            ))}
                        </View>
                    ) : null}

                    {/* Ratings histogram (design 2a) — amber bars, pill tier toggle.
                        Hidden until ANY tier has a rating: the zeroed frame read
                        as old-design scaffolding on cold pages (founder, 2026-07-22). */}
                    {restaurant && hasAnyRatings ? (
                        <SwitchableDistribution
                            activeTier={activeTier}
                            distributions={pageData?.distributions_half ?? { you: new Array(10).fill(0), your_table: null, napkin: new Array(10).fill(0) }}
                            onTierChange={setActiveTier}
                        />
                    ) : null}

                    {/* One review line (design 2a) — the newest circle note, or THE
                        single invitation on an unwritten page. Only when the REVIEWS
                        band is absent: the band owns voices on populated pages, and
                        this line duplicating one of its rows above it muddied the
                        rebuilt design (founder, 2026-07-22). */}
                    {restaurant && !voicesVisible ? (
                        reviewQuote ? (
                            <View style={styles.reviewLine}>
                                {reviewQuote.avatar_url ? (
                                    <Image
                                        source={{ uri: reviewQuote.avatar_url }}
                                        style={styles.reviewAvatar}
                                    />
                                ) : (
                                    <View
                                        style={[
                                            styles.reviewAvatar,
                                            { backgroundColor: palette.surfaceContainerHigh },
                                        ]}
                                    />
                                )}
                                <Text style={[styles.reviewQuote, { color: palette.text }]} numberOfLines={3}>
                                    {`"${reviewQuote.note!.trim()}" `}
                                    <Text style={[styles.reviewMeta, { color: palette.textMuted }]}>
                                        {`— ${reviewQuote.is_self ? 'you' : reviewQuote.user_display_names[0] ?? 'a tablemate'}, ${formatQuoteDate(reviewQuote.date)}`}
                                    </Text>
                                </Text>
                            </View>
                        ) : (
                            <Text style={[styles.reviewEmpty, { color: palette.textMuted }]}>
                                {isColdRestaurant
                                    ? 'No one you know has been. '
                                    : `No one's written about ${restaurant.name} yet. `}
                                <Text
                                    style={{ color: palette.primary }}
                                    onPress={handleLogPress}
                                    accessibilityRole="button"
                                >
                                    Be the first →
                                </Text>
                            </Text>
                        )
                    ) : null}

                    {/* TICKET-168: reviews stay reachable when the REVIEWS band is
                        absent (cold + noteless-self pages). voicesVisible mirrors
                        exactly what the band is fed — self reviews now count
                        [review-1 FAIL-1]. Ghosts have no persisted id → no link. */}
                    {pageData?.restaurant?.id && !voicesVisible ? (
                        <View style={styles.allReviewsFolioWrap}>
                            <AllReviewsFolio
                                total={pageData?.public_reviews_total ?? null}
                                onPress={handleSeeAllReviews}
                            />
                        </View>
                    ) : null}

                    {/* ── BELOW CANVAS — gated/quiet ────────────────────────────────── */}

                    {/* Reviews band — your written reviews + tablemate visits +
                        public reviews (self rows lead; noteless visits are
                        ledger-only in YOUR HISTORY). */}
                    {restaurant && pageData && voicesVisible ? (
                        <View style={styles.belowSection}>
                            <VoicesStream
                                selfVisits={selfReviewVisits}
                                tablemateVisits={tablemateVisits}
                                publicReviews={pageData.public_reviews ?? []}
                                reviewCount={pageData.public_reviews_total ?? null}
                                viewerUserId={user?.id ?? null}
                                matchFilterOn={matchFilterOn}
                                onToggleMatchFilter={() => setMatchFilterOn((v) => !v)}
                                onVisitPress={handleVisitPress}
                                onPublicReviewPress={handlePublicReviewPress}
                                restaurantName={restaurant?.name ?? null}
                                onSeeAllReviews={
                                    pageData?.restaurant?.id ? handleSeeAllReviews : undefined
                                }
                            />
                        </View>
                    ) : null}

                    {/* Public lists containing this persisted restaurant. */}
                    {restaurant && persistedRestaurantId ? (
                        <FeaturedInListsBand
                            rows={featuredListsData?.rows ?? []}
                            total={featuredListsData?.total ?? 0}
                        />
                    ) : null}

                    {/* On socials — your circle's (+ strangers') clippings (TICKET-156).
                        Sits after reviews and featured lists. Renders independently
                        of hasVoices (a cold page can still show clips).
                        Gated on non-empty so an empty rail leaves no padded gap (N4). */}
                    {restaurant && clippings.length > 0 ? (
                        <View style={styles.belowSection}>
                            <OnSocialsRail clippings={clippings} />
                        </View>
                    ) : null}

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
                            <ErrorState
                                message="could not load visit history."
                                onRetry={() => void refetch()}
                            />
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
                        showSetTable={!FRIEND_TEST.hideSuppers && hasAnyTable && !!persistedRestaurantId}
                        onSetTablePress={() => setSetTableSheetOpen(true)}
                        showGather={!FRIEND_TEST.hideSuppers && hasAnyTable && !!persistedRestaurantId}
                        onGatherPress={() => setGatherSheetOpen(true)}
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
                        photo_source: restaurant.photo_source ?? null,
                        places_photo_attribution_html: restaurant.places_photo_attribution_html ?? null,
                    }}
                    tableId={tableId ?? (tables?.[0]?.tables?.id ?? null)}
                />
            ) : null}

            {/* TICKET-095: gather the table (propose a future date here) */}
            {restaurant && persistedRestaurantId && !FRIEND_TEST.hideSuppers ? (
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
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    errorShell: {
        flex: 1,
    },
    errorBack: {
        alignItems: 'center',
        justifyContent: 'center',
        width: Spacing.xxl,
        height: Spacing.xxl,
        marginLeft: Spacing.sm,
    },
    errorBody: {
        flex: 1,
        justifyContent: 'center',
    },
    scrollContent: {
        paddingBottom: 150, // clears the action dock + its fade
        gap: 16,
    },
    loadingCenter: {
        paddingVertical: Spacing.xxl,
        alignItems: 'center',
    },
    // Tag chips — Places taxonomy ("fine dining", "small plates", "wine bar")
    tagRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 6,
        paddingHorizontal: 20,
    },
    tagChip: {
        borderRadius: 999,
        paddingHorizontal: 11,
        paddingVertical: 5,
    },
    tagChipText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10.5,
        letterSpacing: 0.3,
    },
    // YOUR HISTORY (design 2a)
    section: {
        paddingHorizontal: 20,
    },
    sectionHead: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginBottom: 2,
    },
    sectionKicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9.5,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
    },
    sectionCount: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 10,
    },
    historyRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 9,
    },
    historyRating: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 17,
        width: 34,
        flexShrink: 0,
    },
    historyNote: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12.5,
        flex: 1,
    },
    historyDate: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 10,
        letterSpacing: 0.5,
    },
    // One review line (design 2a)
    reviewLine: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        paddingHorizontal: 20,
    },
    reviewAvatar: {
        width: 22,
        height: 22,
        borderRadius: 11,
        flexShrink: 0,
    },
    reviewQuote: {
        flex: 1,
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13.5,
        lineHeight: 20,
    },
    reviewMeta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 10,
        fontStyle: 'normal',
    },
    reviewEmpty: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13.5,
        lineHeight: 20,
        textAlign: 'center',
        paddingHorizontal: 20,
    },
    allReviewsFolioWrap: {
        paddingHorizontal: 22,
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
