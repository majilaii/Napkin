/**
 * /spots — every place a user has logged (TICKET-092, the Letterboxd "Films").
 *
 * Typographic ledger rows (lists doctrine: no thumbnails): serif name,
 * city · cuisine · visits meta, amber italic rating on the right.
 * House segment toggle: recent ↔ top rated.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useUserSpots, type SpotSummary } from '@/hooks/users/useUserSpots';

type SortMode = 'recent' | 'top';

export default function SpotsScreen() {
    const { userId } = useLocalSearchParams<{ userId?: string }>();
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const identifier = userId ?? user?.id;
    const { data: spots, isLoading } = useUserSpots(identifier);
    const [sort, setSort] = useState<SortMode>('recent');

    const rows = useMemo(() => {
        const list = [...(spots ?? [])];
        if (sort === 'top') {
            list.sort((a, b) => {
                const ar = a.avg_rating ?? -1;
                const br = b.avg_rating ?? -1;
                if (ar !== br) return br - ar;
                return b.visit_count - a.visit_count;
            });
        }
        return list; // server order is last-visited desc
    }, [spots, sort]);

    return (
        <View style={[styles.container, { backgroundColor: palette.background, paddingTop: insets.top }]}>
            <Stack.Screen options={{ headerShown: false }} />

            <View style={styles.header}>
                <Pressable onPress={() => router.back()} hitSlop={12} style={styles.back} accessibilityLabel="back">
                    <Ionicons name="chevron-back" size={22} color={palette.textMuted} />
                </Pressable>
                <Text style={[styles.title, { color: palette.text }]}>Spots</Text>
                <View style={styles.back} />
            </View>

            {/* Segment toggle — the wishlist control, verbatim grammar */}
            <View style={styles.segmentWrap}>
                <View style={[styles.segmentTrack, { backgroundColor: palette.surfaceJournalHi }]}>
                    {(['recent', 'top'] as SortMode[]).map((m) => {
                        const active = sort === m;
                        return (
                            <Pressable
                                key={m}
                                onPress={() => setSort(m)}
                                style={[
                                    styles.segmentBtn,
                                    active && [styles.segmentBtnActive, { backgroundColor: palette.surfaceNote }],
                                ]}
                                accessibilityRole="button"
                                accessibilityState={{ selected: active }}
                            >
                                <Text
                                    style={[
                                        styles.segmentLabel,
                                        { color: active ? palette.primary : palette.textMuted },
                                    ]}
                                >
                                    {m === 'recent' ? 'Recent' : 'Top rated'}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>
            </View>

            {isLoading ? (
                <ActivityIndicator color={palette.primary} style={{ marginTop: Spacing.xxl }} />
            ) : rows.length === 0 ? (
                <View style={styles.emptyWrap}>
                    <Text style={[styles.emptyMurmur, { color: palette.textMuted }]}>
                        {'— nothing logged yet.'}
                    </Text>
                </View>
            ) : (
                <FlatList
                    data={rows}
                    keyExtractor={(s) => s.restaurant_id}
                    contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
                    showsVerticalScrollIndicator={false}
                    renderItem={({ item }) => (
                        <SpotRow
                            spot={item}
                            palette={palette}
                            onPress={() =>
                                router.push({ pathname: '/restaurant/[id]', params: { id: item.restaurant_id } })
                            }
                        />
                    )}
                />
            )}
        </View>
    );
}

function SpotRow({
    spot,
    palette,
    onPress,
}: {
    spot: SpotSummary;
    palette: typeof Colors.light;
    onPress: () => void;
}) {
    const meta = [
        spot.city,
        spot.cuisine,
        spot.visit_count > 1 ? `${spot.visit_count} visits` : null,
    ]
        .filter(Boolean)
        .join(' · ');

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1, borderBottomColor: palette.dividerSoft }]}
            accessibilityRole="button"
        >
            <View style={styles.rowBody}>
                <Text style={[styles.rowName, { color: palette.text }]} numberOfLines={1}>
                    {spot.name}
                </Text>
                {meta ? (
                    <Text style={[styles.rowMeta, { color: palette.textMuted }]} numberOfLines={1}>
                        {meta}
                    </Text>
                ) : null}
            </View>
            {spot.avg_rating != null ? (
                <Text style={[styles.rowRating, { color: palette.amberBright }]}>
                    {(Math.round(spot.avg_rating * 2) / 2).toFixed(1)}
                </Text>
            ) : null}
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
        paddingBottom: Spacing.xs,
    },
    back: { width: 32, alignItems: 'flex-start' },
    title: { ...Type.screenTitle },
    segmentWrap: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 6 },
    segmentTrack: { flexDirection: 'row', gap: 4, borderRadius: 13, padding: 4 },
    segmentBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10 },
    segmentBtnActive: {
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 3,
        elevation: 1,
    },
    segmentLabel: { fontFamily: 'Manrope_700Bold', fontSize: 14, letterSpacing: 0.2 },
    emptyWrap: { paddingTop: 80, alignItems: 'center' },
    emptyMurmur: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 15 },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
        marginHorizontal: 20,
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    rowBody: { flex: 1, minWidth: 0, gap: 2 },
    rowName: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 17, lineHeight: 21 },
    rowMeta: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
    rowRating: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 18 },
});
