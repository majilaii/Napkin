/**
 * /restaurant-reviews — every public review of one restaurant
 * (TICKET-154, Letterboxd film → Reviews).
 *
 * Entered from the restaurant page's VOICES section. Text-forward cards in
 * the /reviews grammar: serif reviewer name + amber rating, the note as the
 * hero (em-dash, italic-adjacent serif), quiet date + taste-match line.
 * Paginated (canonical cursor family). Rows open the public entry view.
 */
import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Shadow } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ErrorState } from '@/components/ErrorState';
import { useRestaurantReviews } from '@/hooks/restaurants/useRestaurantReviews';
import { flattenPages } from '@/lib/pagination';
import type { PublicReviewCard } from '@/hooks/restaurants/useRestaurantPage';

function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function RestaurantReviewsScreen() {
    const { id, name } = useLocalSearchParams<{ id?: string; name?: string }>();
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();

    const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
        useRestaurantReviews(id);

    const rows = useMemo(() => flattenPages(data), [data]);

    return (
        <View style={[styles.container, { backgroundColor: palette.background, paddingTop: insets.top }]}>
            <Stack.Screen options={{ headerShown: false }} />

            <View style={styles.header}>
                <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back} accessibilityLabel="back">
                    <Ionicons name="chevron-back" size={22} color={palette.textMuted} />
                </Pressable>
                <View style={styles.titleWrap}>
                    <Text style={[styles.title, { color: palette.text }]}>reviews</Text>
                    {name ? (
                        <Text style={[styles.subtitle, { color: palette.textMuted }]} numberOfLines={1}>
                            {name}
                        </Text>
                    ) : null}
                </View>
                <View style={styles.back} />
            </View>

            {isLoading ? (
                <ActivityIndicator color={palette.primary} style={{ marginTop: Spacing.xxl }} />
            ) : isError && rows.length === 0 ? (
                <ErrorState onRetry={refetch} />
            ) : rows.length === 0 ? (
                <View style={styles.emptyWrap}>
                    <Text style={[styles.emptyMurmur, { color: palette.textMuted }]}>
                        {name ? `— no one's written about ${name} yet.` : '— nothing written yet.'}
                    </Text>
                </View>
            ) : (
                <FlatList
                    data={rows}
                    keyExtractor={(r) => r.entry_id}
                    contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 90 }}
                    showsVerticalScrollIndicator={false}
                    onEndReached={() => {
                        if (hasNextPage && !isFetchingNextPage) fetchNextPage();
                    }}
                    onEndReachedThreshold={0.4}
                    ListFooterComponent={
                        isFetchingNextPage ? (
                            <ActivityIndicator color={palette.primary} style={{ marginVertical: Spacing.md }} />
                        ) : null
                    }
                    renderItem={({ item }) => (
                        <ReviewRow
                            row={item}
                            palette={palette}
                            onPress={() =>
                                router.push({
                                    pathname: '/entry-detail',
                                    params: { entryId: item.entry_id, viewAs: 'public' },
                                })
                            }
                        />
                    )}
                />
            )}
        </View>
    );
}

function ReviewRow({
    row,
    palette,
    onPress,
}: {
    row: PublicReviewCard;
    palette: typeof Colors.light;
    onPress: () => void;
}) {
    const metaBits = [formatDate(row.created_at)];
    if (row.calibration) metaBits.push(`${row.calibration.match_pct}% match`);

    return (
        <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
            <View style={[styles.card, { backgroundColor: palette.card }, Shadow.subtle]}>
                <View style={styles.cardHead}>
                    <Text style={[styles.cardName, { color: palette.text }]} numberOfLines={1}>
                        {row.display_name}
                    </Text>
                    {row.rating != null ? (
                        <Text style={[styles.cardRating, { color: palette.amberBright }]}>
                            {Number(row.rating).toFixed(1)}
                        </Text>
                    ) : null}
                </View>
                <Text style={[styles.cardNote, { color: palette.textSecondary }]} numberOfLines={6}>
                    {`— ${row.note_excerpt}`}
                </Text>
                <Text style={[styles.cardDate, { color: palette.textMuted }]}>
                    {metaBits.join(' · ')}
                </Text>
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 18,
        paddingTop: Spacing.sm,
        paddingBottom: Spacing.sm,
    },
    back: { width: 32, alignItems: 'flex-start' },
    titleWrap: { alignItems: 'center', flexShrink: 1 },
    title: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 22 },
    subtitle: { fontFamily: 'Manrope_500Medium', fontSize: 11, marginTop: 1 },
    emptyWrap: { paddingTop: 80, alignItems: 'center', paddingHorizontal: 40 },
    emptyMurmur: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
        textAlign: 'center',
        lineHeight: 22,
    },
    card: {
        borderRadius: 16,
        paddingHorizontal: Spacing.md + 2,
        paddingVertical: Spacing.md,
        marginBottom: Spacing.sm,
        gap: 6,
    },
    cardHead: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: Spacing.md,
    },
    cardName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 18,
        lineHeight: 22,
        flexShrink: 1,
    },
    cardRating: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 17 },
    cardNote: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 14.5,
        lineHeight: 21,
    },
    cardDate: { fontFamily: 'Manrope_500Medium', fontSize: 11 },
});
