/**
 * Restaurant memory screen.
 *
 * A quiet, table-scoped list of every Round and solo entry a Table has logged
 * at this restaurant. Not a social profile. Not a public review page. Just a
 * single place to see the Table's accumulated relationship with the venue.
 *
 * Route: /restaurant/[id]?tableId=...
 *
 * If `tableId` is missing, the screen renders an empty-ish state (all visits
 * are Table-scoped and we need the context to query safely).
 */
import React from 'react';
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';

import { Colors, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useTableRestaurantHistory, type Visit } from '@/hooks/restaurants/useRestaurantHistory';
import { VisitListRow } from '@/components/restaurants';
import { WishlistHeartButton } from '@/components/wishlist';
import { useMyWishlist } from '@/hooks/wishlist/useMyWishlist';

type Palette = typeof Colors.light;

export default function RestaurantScreen() {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { user } = useAuth();
    const { id, tableId } = useLocalSearchParams<{ id: string; tableId?: string }>();

    const { data, isLoading, error, fetchStatus } = useTableRestaurantHistory(id, tableId ?? null);
    const isActuallyLoading = isLoading && fetchStatus === 'fetching';

    // Warm the wishlist cache so WishlistHeartButton's useIsWishlisted can derive saved state
    useMyWishlist(user?.id);

    const handleVisitPress = (visit: Visit) => {
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

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <View style={[styles.container, { backgroundColor: palette.background }]}>
                {/* Top bar */}
                <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
                    <Pressable onPress={() => router.back()} hitSlop={12}>
                        <Text style={[Type.body, { color: palette.primary }]}>← Back</Text>
                    </Pressable>
                    {id && (
                        <WishlistHeartButton
                            restaurantId={id}
                            userId={user?.id}
                            size={26}
                        />
                    )}
                </View>

                <ScrollView
                    contentContainerStyle={{ paddingBottom: Spacing.xxl }}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Hero photo (if cached) */}
                    {data?.restaurant?.photo_url ? (
                        <View style={{ marginHorizontal: Spacing.lg, marginTop: Spacing.md }}>
                            <ExpoImage
                                source={{ uri: data.restaurant.photo_url }}
                                style={styles.heroImage}
                                contentFit="cover"
                                transition={200}
                            />
                        </View>
                    ) : null}

                    {/* Restaurant header */}
                    <View style={styles.headerSection}>
                        <Text
                            style={[
                                Type.labelSmall,
                                { color: palette.textMuted, letterSpacing: 1.5 },
                            ]}
                        >
                            Restaurant
                        </Text>
                        <Text
                            style={[
                                Type.displayLarge,
                                {
                                    color: palette.text,
                                    fontFamily: 'Newsreader_400Regular_Italic',
                                    fontSize: 36,
                                    lineHeight: 40,
                                    marginTop: Spacing.xs,
                                },
                            ]}
                        >
                            {data?.restaurant?.name ?? 'Restaurant'}
                        </Text>
                        {data?.restaurant?.address ? (
                            <Text
                                style={[
                                    Type.bodySmall,
                                    { color: palette.textMuted, marginTop: 4 },
                                ]}
                            >
                                {data.restaurant.address}
                                {data.restaurant.city ? ` · ${data.restaurant.city}` : ''}
                            </Text>
                        ) : null}
                    </View>

                    {/* Table average */}
                    {data?.table_average != null && (
                        <View style={{ alignItems: 'center', marginTop: Spacing.lg }}>
                            <View
                                style={[
                                    styles.avgBubble,
                                    { backgroundColor: palette.tertiaryFixed },
                                    Shadow.ambient,
                                ]}
                            >
                                <Text
                                    style={[
                                        Type.ratingLarge,
                                        { color: palette.tertiary, fontSize: 32, lineHeight: 36 },
                                    ]}
                                >
                                    {data.table_average.toFixed(1)}
                                </Text>
                                <Text
                                    style={[
                                        Type.labelSmall,
                                        { color: palette.tertiary, opacity: 0.7 },
                                    ]}
                                >
                                    Table Average
                                </Text>
                            </View>
                            <Text
                                style={[
                                    Type.bodySmall,
                                    {
                                        color: palette.textMuted,
                                        marginTop: Spacing.sm,
                                        fontStyle: 'italic',
                                    },
                                ]}
                            >
                                across {data.visit_count}{' '}
                                {data.visit_count === 1 ? 'visit' : 'visits'}
                            </Text>
                        </View>
                    )}

                    {/* Loading / error states */}
                    {isActuallyLoading && (
                        <View style={{ paddingVertical: Spacing.xl, alignItems: 'center' }}>
                            <ActivityIndicator color={palette.primary} />
                        </View>
                    )}
                    {error && (
                        <View style={styles.section}>
                            <Text style={[Type.body, { color: palette.error }]}>
                                Could not load restaurant history.
                            </Text>
                            {error.message ? (
                                <Text
                                    style={[
                                        Type.bodySmall,
                                        { color: palette.textMuted, marginTop: Spacing.xs },
                                    ]}
                                >
                                    {error.message}
                                </Text>
                            ) : null}
                        </View>
                    )}

                    {/* Visits list */}
                    {!isActuallyLoading && data && (
                        <View style={styles.section}>
                            <Text
                                style={[
                                    Type.label,
                                    { color: palette.textSecondary, marginBottom: Spacing.md },
                                ]}
                            >
                                Visits
                            </Text>
                            {data.visits.length === 0 ? (
                                <View
                                    style={{
                                        paddingVertical: Spacing.lg,
                                        alignItems: 'center',
                                    }}
                                >
                                    <Text
                                        style={[
                                            Type.body,
                                            {
                                                color: palette.textMuted,
                                                fontStyle: 'italic',
                                            },
                                        ]}
                                    >
                                        No visits yet.
                                    </Text>
                                </View>
                            ) : (
                                <View style={{ gap: Spacing.sm }}>
                                    {data.visits.map((v) => (
                                        <VisitListRow
                                            key={`${v.kind}-${v.id}`}
                                            visit={v}
                                            onPress={() => handleVisitPress(v)}
                                        />
                                    ))}
                                </View>
                            )}
                        </View>
                    )}

                    {/* Missing context warning */}
                    {!tableId && (
                        <View style={styles.section}>
                            <Text
                                style={[
                                    Type.bodySmall,
                                    { color: palette.textMuted, fontStyle: 'italic' },
                                ]}
                            >
                                Open this restaurant from a Round or entry to see visit history.
                            </Text>
                        </View>
                    )}
                </ScrollView>
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
        paddingVertical: Spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    heroImage: {
        width: '100%',
        height: 180,
        borderRadius: 16,
    },
    headerSection: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.lg,
    },
    avgBubble: {
        paddingHorizontal: Spacing.xl,
        paddingVertical: Spacing.md,
        borderRadius: 24,
        alignItems: 'center',
    },
    section: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.xl,
    },
});
