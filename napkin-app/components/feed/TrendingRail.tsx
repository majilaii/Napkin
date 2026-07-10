/**
 * TrendingRail — actual community momentum, expressed as a ranked ledger.
 *
 * Restaurants arrive here through real Napkin intake: imports are the headline
 * signal, followed by saves and list adds. The block is hidden below three
 * qualifying restaurants. It intentionally does not degrade to a Google
 * leaderboard: non-personal data is not a useful substitute for discovery.
 *
 * Max five rows, no load-more. Tap → restaurant/[id].
 */
import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTrending, type TrendingCard } from '@/hooks/feed/useTrending';
import { trendingSignal } from './trendingSignal';
import { visibleTrendingCards } from './trendingRailGate';
import { SectionKicker } from './SectionKicker';
import { GlyphChip } from './GlyphChip';

/** Ranked ledger cap — 01–05, no scroll. */
const MAX_LEDGER_ROWS = 5;

export function TrendingRail() {
    const { data } = useTrending();
    const cards = useMemo(() => visibleTrendingCards(data?.rows), [data?.rows]);

    if (cards.length === 0) return null;

    return (
        <View>
            <SectionKicker>being passed around</SectionKicker>
            <View style={styles.rows}>
                {cards.slice(0, MAX_LEDGER_ROWS).map((card, i) => (
                    <TrendingLedgerRow key={card.restaurant_id} card={card} index={i} />
                ))}
            </View>
        </View>
    );
}

function TrendingLedgerRow({ card, index }: { card: TrendingCard; index: number }) {
    const meta = [card.cuisine, card.neighborhood].filter(Boolean).join(' · ');
    return (
        <LedgerRow
            restaurantId={card.restaurant_id}
            index={index}
            cuisine={card.cuisine}
            name={card.name}
            meta={meta}
            signal={trendingSignal(card)}
        />
    );
}

function LedgerRow({
    restaurantId,
    index,
    cuisine,
    name,
    meta,
    signal,
}: {
    restaurantId: string;
    index: number;
    cuisine: string | null;
    name: string;
    meta: string;
    signal: string;
}) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const rank = String(index + 1).padStart(2, '0');

    return (
        <Pressable
            onPress={() =>
                router.push({ pathname: '/restaurant/[id]', params: { id: restaurantId } })
            }
            style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel={name}
        >
            <Text style={[styles.rank, { color: palette.primary }]}>{rank}</Text>
            <GlyphChip cuisine={cuisine} seed={restaurantId} />
            <View style={styles.middle}>
                <Text numberOfLines={1} style={[styles.name, { color: palette.text }]}>
                    {name}
                </Text>
                {!!meta && (
                    <Text numberOfLines={1} style={[styles.meta, { color: palette.textMuted }]}>
                        {meta}
                    </Text>
                )}
                {!!signal && (
                    <Text numberOfLines={1} style={[styles.signal, { color: palette.primary }]}>
                        {signal}
                    </Text>
                )}
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    rows: {
        paddingHorizontal: Spacing.lg,
        gap: Spacing.md,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 48,
    },
    rank: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 24,
        opacity: 0.85,
        minWidth: 34,
        flexShrink: 0,
        fontVariant: ['tabular-nums'],
    },
    middle: {
        flex: 1,
        minWidth: 0,
    },
    name: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 18.5,
        lineHeight: 23,
    },
    meta: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 10.5,
        lineHeight: 14,
        marginTop: 1,
    },
    signal: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        lineHeight: 15,
        marginTop: 3,
    },
});
