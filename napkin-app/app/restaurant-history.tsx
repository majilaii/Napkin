import React, { useMemo } from 'react';
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, InlineErrorState } from '@/components/ErrorState';
import { Colors, IconSize, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useRestaurantPage, type SelfLogRow } from '@/hooks/restaurants/useRestaurantPage';
import { useIsWishlisted } from '@/hooks/wishlist/useIsWishlisted';
import { useListsContainingRestaurant } from '@/hooks/lists/useListsContainingRestaurant';
import { useMyLists } from '@/hooks/lists/useMyLists';
import { useRestaurantClippings } from '@/hooks/restaurants/useRestaurantClippings';
import {
    buildElsewhereParts,
    deriveLedgerStats,
    formatLedgerMeta,
    leaveRestaurantHistory,
    selfLogTarget,
} from '@/lib/restaurantHistoryLedger';

function formatLedgerDate(value: string): string {
    return new Date(value).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    }).toUpperCase();
}

function LedgerCard({
    row,
    onPress,
    palette,
}: {
    row: SelfLogRow;
    onPress?: () => void;
    palette: typeof Colors.light;
}) {
    const card = (
        <View style={[styles.card, { backgroundColor: palette.surfaceNote }, Shadow.ambient]}>
            <View style={styles.cardTop}>
                <Text style={[Type.dateline, { color: palette.textFaint }]}>
                    {formatLedgerDate(row.visited_at)}
                </Text>
                {row.table_night_id ? (
                    <Text style={[Type.metadata, { color: palette.textMuted }]}>supper</Text>
                ) : null}
            </View>
            <Text style={[Type.rating, { color: palette.amberBright }]}>
                {row.rating == null ? '—' : row.rating.toFixed(1)}
            </Text>
            {row.note?.trim() ? (
                <Text style={[Type.editorialBody, styles.note, { color: palette.textSoft }]}>
                    {`— ${row.note.trim()}`}
                </Text>
            ) : null}
            {row.companions.length > 0 ? (
                <Text style={[Type.metadata, { color: palette.textMuted }]}>
                    {`with ${row.companions.join(' & ')}`}
                </Text>
            ) : null}
            {row.photos.length > 0 ? (
                <View style={styles.photoStrip}>
                    {row.photos.slice(0, 4).map((photo) => (
                        <Image
                            key={photo.id}
                            source={{ uri: photo.url }}
                            style={styles.photo}
                            contentFit="cover"
                            transition={200}
                        />
                    ))}
                </View>
            ) : null}
        </View>
    );
    if (!onPress) return card;
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={`visit on ${formatLedgerDate(row.visited_at)}`}
            style={({ pressed }) => pressed && styles.pressed}
        >
            {card}
        </Pressable>
    );
}

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

                {page.error && page.data ? (
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
                        <View style={styles.masthead}>
                            <Text style={[Type.ratingLarge, { color: palette.amberBright }]}>
                                {stats.average == null ? '—' : stats.average.toFixed(1)}
                            </Text>
                            {rows.length > 0 ? (
                                <Text style={[Type.metadata, styles.meta, { color: palette.textMuted }]}>
                                    {formatLedgerMeta(rows)}
                                </Text>
                            ) : null}
                        </View>

                        {rows.length > 0 ? (
                            <View style={styles.cards}>
                                {stats.rows.map((row) => {
                                    const target = selfLogTarget(row);
                                    return (
                                        <LedgerCard
                                            key={row.id}
                                            row={row}
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
    masthead: {
        paddingHorizontal: Spacing.restaurant.pageGutter,
        paddingTop: Spacing.lg,
        alignItems: 'center',
    },
    meta: { marginTop: Spacing.xs, textAlign: 'center' },
    cards: {
        paddingHorizontal: Spacing.restaurant.pageGutter,
        paddingTop: Spacing.lg,
        gap: Spacing.restaurant.ledgerGap,
    },
    card: { borderRadius: Radius.lg, padding: Spacing.md },
    cardTop: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: Spacing.sm,
    },
    note: { marginTop: Spacing.sm, marginBottom: Spacing.sm },
    photoStrip: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
    photo: {
        width: Spacing.restaurant.ledgerPhotoSize,
        height: Spacing.restaurant.ledgerPhotoSize,
        borderRadius: Spacing.sm,
    },
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
