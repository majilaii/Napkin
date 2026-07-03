/**
 * /reviews — the written ones (TICKET-092, Letterboxd Reviews).
 *
 * Text-forward cards: serif restaurant name + amber rating, the note as the
 * hero (em-dash, italic serif), quiet date. Paginated (same cursor family as
 * the diary). Self rows open the entry; other-profile rows stay read-only
 * here (entry-detail hardening for stranger entries is a fast-follow).
 */
import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Shadow } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useUserReviews } from '@/hooks/users/useUserReviews';
import { flattenPages } from '@/lib/pagination';
import type { DiaryEntryRow } from '@/hooks/users/useUserProfile';

function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ReviewsScreen() {
    const { userId } = useLocalSearchParams<{ userId?: string }>();
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const identifier = userId ?? user?.id;
    const isSelf = !userId || userId === user?.id;
    const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
        useUserReviews(identifier);

    const rows = useMemo(() => flattenPages(data), [data]);

    return (
        <View style={[styles.container, { backgroundColor: palette.background, paddingTop: insets.top }]}>
            <Stack.Screen options={{ headerShown: false }} />

            <View style={styles.header}>
                <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back} accessibilityLabel="back">
                    <Ionicons name="chevron-back" size={22} color={palette.textMuted} />
                </Pressable>
                <Text style={[styles.title, { color: palette.text }]}>reviews</Text>
                <View style={styles.back} />
            </View>

            {isLoading ? (
                <ActivityIndicator color={palette.primary} style={{ marginTop: Spacing.xxl }} />
            ) : rows.length === 0 ? (
                <View style={styles.emptyWrap}>
                    <Text style={[styles.emptyMurmur, { color: palette.textMuted }]}>
                        {isSelf ? '— nothing written yet. your next log has room.' : '— nothing written yet.'}
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
                        <ReviewCard
                            row={item}
                            palette={palette}
                            onPress={
                                isSelf
                                    ? () =>
                                          router.push({
                                              pathname: '/entry-detail',
                                              params: { entryId: item.entry_id },
                                          })
                                    : undefined
                            }
                        />
                    )}
                />
            )}
        </View>
    );
}

function ReviewCard({
    row,
    palette,
    onPress,
}: {
    row: DiaryEntryRow;
    palette: typeof Colors.light;
    onPress?: () => void;
}) {
    const body = (
        <View style={[styles.card, { backgroundColor: palette.card }, Shadow.subtle]}>
            <View style={styles.cardHead}>
                <Text style={[styles.cardName, { color: palette.text }]} numberOfLines={1}>
                    {row.restaurant_name}
                </Text>
                {row.rating != null ? (
                    <Text style={[styles.cardRating, { color: palette.amberBright }]}>
                        {Number(row.rating).toFixed(1)}
                    </Text>
                ) : null}
            </View>
            <Text style={[styles.cardNote, { color: palette.textSecondary }]} numberOfLines={5}>
                {`— ${row.note ?? ''}`}
            </Text>
            <Text style={[styles.cardDate, { color: palette.textMuted }]}>
                {formatDate(row.visited_at ?? row.created_at)}
            </Text>
        </View>
    );
    if (!onPress) return body;
    return (
        <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}>
            {body}
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
    title: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 22 },
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
