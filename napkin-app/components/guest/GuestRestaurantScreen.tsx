/**
 * GuestRestaurantScreen: signed-out restaurant page (TICKET-247).
 *
 * Reuses the v3 presentational pieces with the guest read (`public-browse`
 * action=page/reviews). Nothing here touches a signed-in hook: save routes
 * to `/auth`, review taps route to `/auth`, and the only write is a mailto.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, IconSize, Radius, Spacing, Type } from '@/constants/theme';
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
import { sendReport } from './guestReport';

const NO_CLIPPINGS = { clippings: [], settled: true } as const;

export function GuestRestaurantScreen({ restaurantId }: { restaurantId: string }) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    // A cold napkin://restaurant/<id> link opens this screen with nothing below
    // it; back then lands on guest Places instead of doing nothing.
    const goBack = useCallback(() => {
        if (router.canGoBack()) router.back();
        else router.replace('/(tabs)/places');
    }, [router]);
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
                    onPress={goBack}
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
                            onBack={goBack}
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
                                                    onPress: () => sendReport({ kind: 'review', restaurant, review }),
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
                                            onPress={() => sendReport({ kind: 'review', restaurant })}
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
