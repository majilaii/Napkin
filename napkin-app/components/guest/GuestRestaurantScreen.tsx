/**
 * GuestRestaurantScreen: signed-out restaurant page (TICKET-247).
 *
 * Reuses the v3 presentational pieces with the guest read (`public-browse`
 * action=page/reviews). Nothing here touches a signed-in hook: save routes
 * to `/auth`, review taps route to `/auth`, and the only write is a mailto.
 */
import React, { useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Linking,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { StatusBar } from 'expo-status-bar';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, IconSize, Radius, Spacing, Type } from '@/constants/theme';
import { LEGAL_URLS, SUPPORT_EMAIL } from '@/constants/links';
import { ErrorState } from '@/components/ErrorState';
import {
    FeaturedListsSection,
    QuoteCard,
    RestaurantDetails,
    RestaurantOverview,
    RestaurantTop,
    SectionHeading,
} from '@/components/restaurants';
import { reviewPhotoUrls } from '@/components/restaurants/ReviewPhotoStrip';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    flattenPages,
    useGuestRestaurantPage,
    useGuestReviews,
} from '@/hooks/guest/usePublicBrowse';
import { buildRestaurantMeta, buildRestaurantPhotoMeta } from '@/lib/restaurantPageV3';
import { resolveMastheadPhotos } from '@/lib/restaurantPhoto';
import { restaurantDirectionsUrl } from '@/lib/restaurantLocation';
import { GuestSignInBand } from './GuestSignInBand';

const NO_CLIPPINGS = { clippings: [], settled: true } as const;

type ReportRestaurant = { id: string; name: string };
type ReportReview = { entry_id: string; display_name: string };

/** The reference a moderator needs: which restaurant, and which review if known. */
export function reportReference(restaurant: ReportRestaurant, review?: ReportReview): string {
    const lines = [`Restaurant: ${restaurant.name} (${restaurant.id})`];
    lines.push(review ? `Review: ${review.entry_id} by ${review.display_name}` : 'Which review:');
    return lines.join('\n');
}

/**
 * Guideline 1.2 for signed-out readers: a mail to support that names exactly
 * what is being reported. With a review, its id and author; without one (the
 * page-level line), the restaurant, and the reader says which review.
 */
export function reportMailto(restaurant: ReportRestaurant, review?: ReportReview): string {
    const subject = encodeURIComponent('Report a review on Napkin');
    const body = `${reportReference(restaurant, review)}\n\nWhat is wrong:`;
    return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${encodeURIComponent(body)}`;
}

/**
 * Open the report mail. When no mail app can take it (Linking rejects; common
 * on review devices), never fail silently: show the address and reference with
 * a copy action and the public support page instead.
 */
export function sendReport(restaurant: ReportRestaurant, review?: ReportReview): void {
    const reference = reportReference(restaurant, review);
    Linking.openURL(reportMailto(restaurant, review)).catch(() => {
        Alert.alert(
            'Report review',
            `Email ${SUPPORT_EMAIL} with this reference.\n\n${reference}`,
            [
                {
                    text: 'Copy details',
                    onPress: () => {
                        void Clipboard.setStringAsync(`To: ${SUPPORT_EMAIL}\n${reference}`)
                            .catch(() => undefined);
                    },
                },
                {
                    text: 'Support page',
                    onPress: () => {
                        void Linking.openURL(LEGAL_URLS.support).catch(() => undefined);
                    },
                },
                { text: 'Close', style: 'cancel' },
            ],
        );
    });
}

export function GuestRestaurantScreen({ restaurantId }: { restaurantId: string }) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { height: windowHeight } = useWindowDimensions();
    const isFocused = useIsFocused();
    const [photoUnderStatusBar, setPhotoUnderStatusBar] = useState(true);
    const [renderedPhotoHeight, setRenderedPhotoHeight] = useState(0);

    const page = useGuestRestaurantPage(restaurantId);
    const restaurant = page.data?.restaurant ?? null;
    const reviewsTotal = page.data?.reviews_total ?? 0;
    const paged = useGuestReviews(reviewsTotal > 0 ? restaurantId : null);
    const pagedRows = useMemo(() => flattenPages(paged.data), [paged.data]);
    const reviews = pagedRows.length > 0 ? pagedRows : (page.data?.reviews ?? []);

    const mastheadPhotos = useMemo(
        () => resolveMastheadPhotos(restaurant ? { restaurant } : null, NO_CLIPPINGS),
        [restaurant],
    );
    const mastheadHeight = Math.min(
        Spacing.restaurant.photoMastheadHeight,
        windowHeight * Spacing.restaurant.photoMastheadMaxWindowRatio,
    );
    const isPageLoading = page.isLoading && page.fetchStatus === 'fetching';

    if (page.isError && !page.data) {
        return (
            <View style={[styles.container, { backgroundColor: palette.background }]}>
                <Stack.Screen options={{ headerShown: false }} />
                {isFocused ? <StatusBar style="dark" /> : null}
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
                        onRetry={() => void page.refetch()}
                    />
                </View>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: palette.background }]}>
            <Stack.Screen options={{ headerShown: false }} />
            {isFocused ? <StatusBar
                style={mastheadPhotos.length > 0 && photoUnderStatusBar ? 'light' : 'dark'}
            /> : null}
            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xxl }}
                onScroll={(event) => {
                    const underPhoto = event.nativeEvent.contentOffset.y
                        <= (renderedPhotoHeight || mastheadHeight) - insets.top;
                    setPhotoUnderStatusBar((current) => current === underPhoto
                        ? current
                        : underPhoto);
                }}
                scrollEventThrottle={16}
            >
                {isPageLoading && !restaurant ? (
                    <View style={[styles.loading, { paddingTop: insets.top + 100 }]}>
                        <ActivityIndicator color={palette.primary} />
                    </View>
                ) : null}

                {restaurant ? (
                    <>
                        <RestaurantTop
                            restaurant={restaurant}
                            meta={mastheadPhotos.length > 0
                                ? buildRestaurantPhotoMeta(restaurant)
                                : buildRestaurantMeta(restaurant, new Date(), undefined)}
                            saved={false}
                            saveDisabled={false}
                            onBack={() => router.back()}
                            onSave={() => router.push('/auth')}
                            topInset={insets.top}
                            onMastheadHeightChange={setRenderedPhotoHeight}
                            photos={mastheadPhotos}
                            palette={palette}
                        />
                        <View style={mastheadPhotos.length > 0 ? [
                            styles.photoPaper,
                            { backgroundColor: palette.background },
                        ] : undefined}>
                            <RestaurantOverview
                                average={undefined}
                                reviewCount={reviewsTotal}
                                loading={isPageLoading}
                                unavailable={page.isError && !page.data}
                                palette={palette}
                            />

                            {reviewsTotal > 0 ? (
                                <View style={styles.section} testID="guest-reviews">
                                    <SectionHeading label="Reviews" palette={palette} />
                                    {reviews.map((review) => (
                                        <QuoteCard
                                            key={review.entry_id}
                                            note={review.note_excerpt}
                                            name={review.display_name}
                                            rating={review.rating}
                                            visitedAt={review.created_at}
                                            photos={reviewPhotoUrls(review)}
                                            onPress={() => Alert.alert(review.display_name, undefined, [
                                                {
                                                    text: 'Report review',
                                                    onPress: () => sendReport(restaurant, review),
                                                },
                                                { text: 'Sign in', onPress: () => router.push('/auth') },
                                                { text: 'Cancel', style: 'cancel' },
                                            ])}
                                            palette={palette}
                                        />
                                    ))}
                                    {paged.isFetchingNextPage ? (
                                        <ActivityIndicator color={palette.primary} style={styles.more} />
                                    ) : paged.hasNextPage ? (
                                        <Pressable
                                            onPress={() => void paged.fetchNextPage()}
                                            accessibilityRole="button"
                                            accessibilityLabel="more reviews"
                                            style={({ pressed }) => [styles.more, pressed && styles.pressed]}
                                        >
                                            <Text style={[Type.restaurantSectionAction, { color: palette.primary }]}>
                                                more ·
                                            </Text>
                                        </Pressable>
                                    ) : null}
                                    <Text style={[Type.metadata, styles.report, { color: palette.textMuted }]}>
                                        see something wrong?{' '}
                                        <Text
                                            accessibilityRole="link"
                                            accessibilityLabel="report a review"
                                            onPress={() => sendReport(restaurant)}
                                            style={[styles.reportLink, { color: palette.textSecondary }]}
                                        >
                                            report
                                        </Text>
                                    </Text>
                                </View>
                            ) : null}

                            {/* Public lists of public accounts only (never Table lists). */}
                            <FeaturedListsSection
                                rows={page.data?.featured_lists?.rows ?? []}
                                onPress={(listId) => router.push({ pathname: '/list/[id]', params: { id: listId } })}
                                palette={palette}
                            />

                            <RestaurantDetails
                                restaurant={restaurant}
                                directionsUrl={restaurantDirectionsUrl(restaurant)}
                                palette={palette}
                            />

                            {/* Public content first; the account ask closes the page. */}
                            <GuestSignInBand />
                        </View>
                    </>
                ) : null}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    loading: { alignItems: 'center' },
    photoPaper: {
        position: 'relative',
        marginTop: -Spacing.restaurant.photoPaperOverlap,
        paddingTop: Spacing.restaurant.photoPaperTop,
        borderTopLeftRadius: Radius.xl,
        borderTopRightRadius: Radius.xl,
    },
    errorBack: {
        width: Spacing.restaurant.quietActionHeight,
        height: Spacing.restaurant.quietActionHeight,
        alignItems: 'center',
        justifyContent: 'center',
    },
    errorBody: { flex: 1, justifyContent: 'center' },
    section: {
        paddingHorizontal: Spacing.restaurant.pageGutter,
        marginTop: Spacing.restaurant.sectionGap,
    },
    more: {
        minHeight: Spacing.restaurant.quietActionHeight,
        justifyContent: 'center',
    },
    pressed: { opacity: 0.8 },
    report: { paddingTop: Spacing.sm },
    reportLink: { textDecorationLine: 'underline' },
});
