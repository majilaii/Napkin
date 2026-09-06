import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Avatar } from '@/components/feed/Avatar';
import { ReviewPhotoStrip, reviewPhotoUrls } from '@/components/restaurants/ReviewPhotoStrip';
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

    const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError } =
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
                    <Text style={[styles.title, { color: palette.text }]}>Reviews</Text>
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
                    {/* TICKET-168: an invitation, not a dead end. */}
                    {id ? (
                        <Text
                            style={[styles.emptyCta, { color: palette.primary }]}
                            onPress={() =>
                                router.push({
                                    pathname: '/create-entry',
                                    params: { restaurantId: id },
                                })
                            }
                            accessibilityRole="button"
                        >
                            been here? log it →
                        </Text>
                    ) : null}
                </View>
            ) : (
                <FlatList
                    data={rows}
                    keyExtractor={(r) => r.entry_id}
                    contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: insets.bottom + 90 }}
                    showsVerticalScrollIndicator={false}
                    onEndReached={() => {
                        if (hasNextPage && !isFetchingNextPage) fetchNextPage();
                    }}
                    onEndReachedThreshold={0.4}
                    ListFooterComponent={
                        isFetchingNextPage ? (
                            <ActivityIndicator color={palette.primary} style={{ marginVertical: Spacing.md }} />
                        ) : isError ? <ErrorState onRetry={() => isFetchNextPageError ? fetchNextPage() : refetch()} /> : null
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
    const [expanded, setExpanded] = useState(false);
    const [long, setLong] = useState(false);
    const photos = reviewPhotoUrls(row);
    const date = formatDate(row.created_at);

    return (
        <View style={[styles.review, { borderBottomColor: palette.ghostRule }]}>
            <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${row.display_name}, ${date}, ${row.rating} out of 5. ${row.note_excerpt}`} accessibilityHint="Opens this review"
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                <View style={styles.cardHead}>
                    <Avatar name={row.display_name} url={row.avatar_url} size={32} palette={palette} />
                    <View style={styles.author}>
                        <Text style={[styles.cardName, { color: palette.text }]} numberOfLines={1}>{row.display_name}</Text>
                        <Text style={[styles.cardDate, { color: palette.textMuted }]}>{date}</Text>
                    </View>
                    {row.rating != null ? (
                        <View style={styles.rating} accessibilityLabel={`${row.rating} out of 5 stars`}>
                            <Ionicons name="star" size={11} color={palette.amberBright} />
                            <Text style={[styles.cardRating, { color: palette.amberBright }]}>{Number(row.rating).toFixed(1)}</Text>
                        </View>
                    ) : null}
                </View>
                <View>
                    <Text style={[styles.cardNote, { color: palette.textSoft }]} numberOfLines={expanded ? undefined : 5}>
                        {row.note_excerpt}
                    </Text>
                    {/* Measure the full text at its actual width, including dynamic type. */}
                    <Text accessible={false} importantForAccessibility="no-hide-descendants"
                        style={[styles.cardNote, styles.measure]} onTextLayout={(event) => setLong(event.nativeEvent.lines.length > 5)}>
                        {row.note_excerpt}
                    </Text>
                </View>
            </Pressable>
            {long ? (
                <Pressable onPress={() => setExpanded(!expanded)} style={styles.more} accessibilityRole="button" accessibilityState={{ expanded }}>
                    <Text style={[styles.link, { color: palette.primary }]}>{expanded ? 'less' : 'more'}</Text>
                </Pressable>
            ) : null}
            <ReviewPhotoStrip photos={photos} author={row.display_name} caption={`${row.display_name} · ${date}`} palette={palette} />
        </View>
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
    back: { width: 40, minHeight: 40, justifyContent: 'center', alignItems: 'flex-start' },
    titleWrap: { alignItems: 'center', flexShrink: 1 },
    title: { ...Type.screenTitle },
    subtitle: { ...Type.caption, marginTop: 2 },
    emptyWrap: { paddingTop: 80, alignItems: 'center', paddingHorizontal: 40 },
    emptyCta: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
        letterSpacing: 0.3,
        marginTop: Spacing.md,
    },
    emptyMurmur: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
        textAlign: 'center',
        lineHeight: 22,
    },
    review: { paddingVertical: 22, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
    author: { flex: 1, gap: 2 },
    cardName: { ...Type.body, fontFamily: 'Manrope_600SemiBold', lineHeight: 21 },
    cardRating: { ...Type.rating, fontSize: 20, lineHeight: 26 },
    rating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    cardNote: { fontFamily: 'Newsreader_400Regular', fontSize: 16, lineHeight: 22 },
    cardDate: { ...Type.caption },
    measure: { position: 'absolute', top: 0, left: 0, right: 0, opacity: 0, pointerEvents: 'none' },
    more: { minHeight: 40, justifyContent: 'center', alignSelf: 'flex-start', marginVertical: -10, paddingRight: 16 },
    link: { ...Type.caption, fontFamily: 'Manrope_600SemiBold' },
});
