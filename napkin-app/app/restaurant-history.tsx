import React, { useMemo } from 'react';
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, InlineErrorState } from '@/components/ErrorState';
import { Colors, IconSize, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useRestaurantPage } from '@/hooks/restaurants/useRestaurantPage';
import { useIsWishlisted } from '@/hooks/wishlist/useIsWishlisted';
import { useListsContainingRestaurant } from '@/hooks/lists/useListsContainingRestaurant';
import { useMyLists } from '@/hooks/lists/useMyLists';
import { useRestaurantClippings } from '@/hooks/restaurants/useRestaurantClippings';
import {
    buildElsewhereParts,
    deriveLedgerStats,
    leaveRestaurantHistory,
    selfLogTarget,
} from '@/lib/restaurantHistoryLedger';
import {
    RestaurantHistoryMasthead,
    RestaurantHistoryRow,
} from '@/components/restaurants';

export default function RestaurantHistoryScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();
    const { id, name, tableId } = useLocalSearchParams<{
        id: string;
        name?: string;
        tableId?: string;
    }>();

    const page = useRestaurantPage(id, tableId ?? undefined);
    const restaurantId = page.data?.restaurant?.id ?? id;
    const wishlisted = useIsWishlisted(restaurantId, user?.id);
    const { data: containingListIds = [] } = useListsContainingRestaurant(
        user?.id,
        restaurantId,
    );
    const { data: lists = [] } = useMyLists(user?.id);
    const { data: clippingData } = useRestaurantClippings(restaurantId, user?.id);
    const rows = useMemo(() => page.data?.self_log ?? [], [page.data?.self_log]);
    const selfLogUnavailable = !!page.data && page.data.self_log === undefined;
    const stats = useMemo(() => deriveLedgerStats(rows), [rows]);
    const selfClipCount = (clippingData?.rows ?? []).filter(
        (clipping) => clipping.relationship === 'self',
    ).length;
    const elsewhere = useMemo(() => buildElsewhereParts({
        wishlisted: wishlisted === true,
        lists,
        containingListIds,
        selfClipCount,
    }), [wishlisted, lists, containingListIds, selfClipCount]);
    const title = page.data?.restaurant?.name ?? name ?? 'Restaurant';
    const handleBack = () => leaveRestaurantHistory(router, id, tableId);

    if (page.error && !page.data) {
        return (
            <View style={[styles.container, { backgroundColor: palette.background, paddingTop: insets.top }]}>
                <Stack.Screen options={{ headerShown: false }} />
                <StatusBar style="dark" />
                <Pressable
                    onPress={handleBack}
                    accessibilityRole="button"
                    accessibilityLabel="back"
                    style={styles.backButton}
                >
                    <Ionicons name="chevron-back" size={IconSize.lg} color={palette.textSecondary} />
                </Pressable>
                <View style={styles.errorBody}>
                    <ErrorState message="could not load your history." onRetry={() => void page.refetch()} />
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
                <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
                    <Pressable
                        onPress={handleBack}
                        accessibilityRole="button"
                        accessibilityLabel="back"
                        style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
                    >
                        <Ionicons name="chevron-back" size={IconSize.lg} color={palette.textSecondary} />
                    </Pressable>
                    <Text style={[styles.headerTitle, { color: palette.text }]} numberOfLines={1}>
                        {title}
                    </Text>
                    <View style={styles.headerSpacer} />
                </View>

                {(page.error && page.data) || selfLogUnavailable ? (
                    <InlineErrorState
                        message="could not load visit history"
                        onRetry={() => void page.refetch()}
                    />
                ) : null}

                {page.isLoading && !page.data ? (
                    <View style={styles.loading}>
                        <ActivityIndicator color={palette.primary} />
                    </View>
                ) : (
                    <>
                        {!selfLogUnavailable ? (
                            <>
                                <RestaurantHistoryMasthead
                                    average={stats.average}
                                    count={stats.count}
                                    first={stats.first}
                                    last={stats.last}
                                    palette={palette}
                                />

                                {rows.length > 0 ? (
                                    <View>
                                        {stats.rows.map((row, index) => {
                                            const target = selfLogTarget(row);
                                            return (
                                                <RestaurantHistoryRow
                                                    key={row.id}
                                                    row={row}
                                                    tintSeed={restaurantId}
                                                    showDivider={index < stats.rows.length - 1}
                                                    onPress={target ? () => router.push(target as any) : undefined}
                                                    palette={palette}
                                                />
                                            );
                                        })}
                                    </View>
                                ) : (
                                    <View style={styles.empty}>
                                        <Text style={[Type.quote, styles.emptyMurmur, { color: palette.textMuted }]}>
                                            — nothing logged here yet.
                                        </Text>
                                        <Pressable
                                            onPress={() => router.push({
                                                pathname: '/create-entry',
                                                params: { restaurantId },
                                            })}
                                            accessibilityRole="button"
                                            accessibilityLabel="log this restaurant"
                                            style={({ pressed }) => pressed && styles.pressed}
                                        >
                                            <Text style={[Type.restaurantSectionAction, styles.emptyAction, { color: palette.primary }]}>
                                                been here? log it →
                                            </Text>
                                        </Pressable>
                                    </View>
                                )}
                            </>
                        ) : null}

                        {elsewhere.length > 0 ? (
                            <View style={[styles.elsewhere, { backgroundColor: palette.surfaceJournalLow }]}>
                                <Text style={[Type.feedSectionKicker, { color: palette.textMuted }]}>ELSEWHERE</Text>
                                <Text style={[Type.metadata, styles.elsewhereLine, { color: palette.textMuted }]}>
                                    {elsewhere.map((part, index) => (
                                        <React.Fragment key={`${part.kind}:${part.label}:${index}`}>
                                            {part.prefix}
                                            <Text
                                                onPress={part.kind === 'list'
                                                    ? () => router.push({
                                                        pathname: '/list/[id]',
                                                        params: { id: part.id },
                                                    })
                                                    : undefined}
                                                style={part.kind === 'list' ? { color: palette.primary } : undefined}
                                            >
                                                {part.label}
                                            </Text>
                                        </React.Fragment>
                                    ))}
                                </Text>
                            </View>
                        ) : null}
                    </>
                )}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        minHeight: Spacing.restaurant.topBarHeight,
        paddingHorizontal: Spacing.restaurant.topBarGutter,
        flexDirection: 'row',
        alignItems: 'center',
    },
    backButton: {
        width: Spacing.restaurant.quietActionHeight,
        height: Spacing.restaurant.quietActionHeight,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitle: {
        ...Type.screenTitle,
        flex: 1,
        textAlign: 'center',
    },
    headerSpacer: { width: Spacing.restaurant.quietActionHeight },
    loading: { paddingTop: Spacing.restaurant.ledgerEmptyTop, alignItems: 'center' },
    errorBody: { flex: 1, justifyContent: 'center' },
    empty: {
        paddingTop: Spacing.restaurant.ledgerEmptyTop,
        paddingHorizontal: Spacing.restaurant.ledgerEmptyGutter,
        alignItems: 'center',
    },
    emptyMurmur: { textAlign: 'center' },
    emptyAction: { marginTop: Spacing.md },
    elsewhere: {
        marginHorizontal: Spacing.restaurant.pageGutter,
        marginTop: Spacing.restaurant.sectionGap,
        borderRadius: Radius.lg,
        padding: Spacing.md,
    },
    elsewhereLine: { marginTop: Spacing.sm },
    pressed: { opacity: 0.8 },
});
