/**
 * DiscoveryLedger — TICKET-103. The vertical numbered "Worth a look" ledger that
 * holds the tail of the feed when there's little/no friend activity to show.
 *
 *   Worth a look
 *   01  Kono              4.7
 *       yakitori · East Village    on Google
 *
 * Sources the SAME fallback payload TrendingRail's mode-2 already uses
 * (`useTrending().data.fallback`), deduped against the viewer's saved ids via
 * the shared `useSavedRestaurantIds` + `visibleFallbackCards` gate. No new fetch,
 * no new endpoint, no new heuristic. Capped at 6 rows; renders `null` when empty
 * (so a day-one user with zero fallback simply sees the ghost card alone — no
 * dangling "Worth a look" heading).
 *
 * Self-gate (TICKET-104): the ledger renders ONLY when the horizontal rail is
 * hidden. It computes `pickRailMode` with the EXACT inputs TrendingRail uses
 * (`data?.rows`, `data?.fallback`, `savedIds`) and stands down for any mode but
 * `'hidden'` — discovery never appears twice on one screen.
 *
 * Google numerals are a labeled SIBLING signal — amber, but never a chip, never
 * a ★, always carrying the "on Google" label. Never dressed as a Napkin rating.
 *
 * One implementation, three mount points: both FeedEmptyState tiers + the
 * sparse-feed tail (per the "one discovery ledger, not three" doctrine).
 */
import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useTrending, type FallbackCard } from '@/hooks/feed/useTrending';
import { useSavedRestaurantIds } from '@/hooks/feed/useSavedRestaurantIds';
import { visibleFallbackCards } from './fallbackRailGate';
import { pickRailMode } from './railMode';
import { shouldShowDiscoveryLedger } from './feedRouting';

const MAX_LEDGER_ROWS = 6;

export function DiscoveryLedger() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const { user } = useAuth();
    const { data } = useTrending();

    const savedIds = useSavedRestaurantIds(user?.id ?? null);
    // Self-gate: stand down whenever the horizontal rail is showing — computed
    // from the SAME inputs TrendingRail passes to pickRailMode (TICKET-104).
    const railMode = useMemo(
        () => pickRailMode(data?.rows, data?.fallback, savedIds).mode,
        [data?.rows, data?.fallback, savedIds],
    );
    const cards = useMemo(
        () => visibleFallbackCards(data?.fallback, savedIds).slice(0, MAX_LEDGER_ROWS),
        [data?.fallback, savedIds],
    );

    if (!shouldShowDiscoveryLedger(railMode)) return null;
    if (cards.length === 0) return null;

    return (
        <View style={styles.wrap}>
            <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>Worth a look</Text>
            <View style={styles.rows}>
                {cards.map((card, i) => (
                    <DiscoveryRow key={card.restaurant_id} card={card} index={i} />
                ))}
            </View>
        </View>
    );
}

function DiscoveryRow({ card, index }: { card: FallbackCard; index: number }) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    const meta = [card.cuisine, card.neighborhood].filter(Boolean).join(' · ');
    const numeral = String(index + 1).padStart(2, '0');

    return (
        <Pressable
            onPress={() =>
                router.push({ pathname: '/restaurant/[id]', params: { id: card.restaurant_id } })
            }
            style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
        >
            <Text style={[styles.numeral, { color: palette.textMuted }]}>{numeral}</Text>
            <View style={styles.middle}>
                <Text numberOfLines={1} style={[styles.name, { color: palette.text }]}>
                    {card.name}
                </Text>
                {!!meta && (
                    <Text numberOfLines={1} style={[styles.meta, { color: palette.textMuted }]}>
                        {meta}
                    </Text>
                )}
            </View>
            <View style={styles.google}>
                <Text style={[styles.googleNumeral, { color: palette.tertiary }]}>
                    {card.google_rating.toFixed(1)}
                </Text>
                <Text style={[styles.googleLabel, { color: palette.textMuted }]}>on Google</Text>
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    wrap: {
        paddingHorizontal: Spacing.lg,
    },
    sectionLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
    },
    rows: {
        marginTop: Spacing.md,
        gap: 19,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    numeral: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
        width: 20,
        flexShrink: 0,
    },
    middle: {
        flex: 1,
        minWidth: 0,
    },
    name: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 16.5,
        lineHeight: 20,
    },
    meta: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 10.5,
        marginTop: 1,
    },
    google: {
        alignItems: 'flex-end',
        flexShrink: 0,
    },
    googleNumeral: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
        lineHeight: 18,
    },
    googleLabel: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 8.5,
        letterSpacing: 0.3,
    },
});
