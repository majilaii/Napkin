/**
 * TrendingRail — TICKET-098 Phase B. Finite horizontal carousel of trending
 * restaurants, sourced from wishlist intent (distinct savers — never ratings,
 * never names).
 *
 * Rules:
 *   - Max 10 cards, then it ends. No infinite scroll, no "load more".
 *   - Hidden ENTIRELY below 3 cards (clean absence — no skeleton, no
 *     placeholder; a one-card rail advertises the ghost town). The server
 *     already floors at 3; this is the client's double-gate.
 *   - Card = restaurant name in Newsreader italic (brand voice), then a
 *     Manrope meta line "cuisine · neighborhood · {n} saved this week".
 *   - Tap → restaurant/[id]. No rating anywhere.
 */
import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { Colors, Spacing, Radius, Shadow } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTrending, type TrendingCard } from '@/hooks/feed/useTrending';
import { visibleTrendingCards } from './trendingRailGate';

export function TrendingRail() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const { data } = useTrending();

    const rows = visibleTrendingCards(data);
    if (rows.length === 0) return null;

    return (
        <View style={styles.wrap}>
            <Text style={[styles.label, { color: palette.textMuted }]}>Trending</Text>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.railContent}
            >
                {rows.map((card) => (
                    <RailCard key={card.restaurant_id} card={card} />
                ))}
            </ScrollView>
        </View>
    );
}

function RailCard({ card }: { card: TrendingCard }) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    const meta = [
        card.cuisine,
        card.neighborhood,
        `${card.saver_count_7d} saved this week`,
    ]
        .filter(Boolean)
        .join(' · ');

    return (
        <Pressable
            onPress={() =>
                router.push({ pathname: '/restaurant/[id]', params: { id: card.restaurant_id } })
            }
            style={({ pressed }) => [
                styles.card,
                Shadow.note,
                { backgroundColor: palette.surfaceNote, opacity: pressed ? 0.8 : 1 },
            ]}
        >
            <Text
                numberOfLines={2}
                style={[styles.name, { color: palette.text }]}
            >
                {card.name}
            </Text>
            <Text numberOfLines={2} style={[styles.meta, { color: palette.textMuted }]}>
                {meta}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    wrap: {
        paddingBottom: Spacing.sm,
    },
    label: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        paddingHorizontal: Spacing.lg,
        marginBottom: Spacing.sm,
    },
    railContent: {
        paddingHorizontal: Spacing.lg,
        gap: 10,
    },
    card: {
        width: 190,
        borderRadius: Radius.lg,
        paddingHorizontal: Spacing.md,
        paddingVertical: 14,
    },
    name: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 17,
        lineHeight: 21,
        marginBottom: 6,
    },
    meta: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
        lineHeight: 15,
    },
});
