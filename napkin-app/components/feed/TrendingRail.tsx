/**
 * TrendingRail — the two-mode feed rail (TICKET-098 Phase B + TICKET-102 +
 * TICKET-114 v2 re-dress).
 *
 * Mode 1 (trending): finite horizontal carousel of restaurants sourced from
 * Napkin intake — imports (TikTok/IG share-to-Napkin) are the HEADLINE signal,
 * then saves + list adds. Label "trending right now"; signal line (terracotta)
 * "{n} imported · {m} saved". Hidden below 3 qualifiers.
 *
 * Mode 2 (fallback, TICKET-102): when mode 1 is below the floor, the rail
 * switches SOURCE to restaurants ranked by their stored Google rating. Label
 * "nearby, well rated"; meta "{rating} on Google" — Google is a labeled SIBLING
 * signal, NEVER a Napkin number.
 *
 * Cards are PURELY typographic — no photo, no monogram chip (locked doctrine
 * 2026-07-05 + founder call 2026-07-06): strangers' entry photos aren't visible
 * to the viewer, and a placeholder graphic reads as clutter. Name + signal only.
 *
 * Rules (both modes):
 *   - Max 10 cards, then it ends. No infinite scroll, no "load more".
 *   - Exactly one mode renders — never mixed grammars (enforced by pickRailMode).
 *   - Hidden ENTIRELY when neither mode has cards (clean absence).
 *   - Tap → restaurant/[id].
 */
import React, { useMemo } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { Colors, Spacing, Radius, Shadow } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useTrending, type TrendingCard, type FallbackCard } from '@/hooks/feed/useTrending';
import { useSavedRestaurantIds } from '@/hooks/feed/useSavedRestaurantIds';
import { pickRailMode } from './railMode';
import { trendingSignal } from './trendingSignal';

export function TrendingRail() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const { user } = useAuth();
    const { data } = useTrending();

    const savedIds = useSavedRestaurantIds(user?.id ?? null);
    const rail = useMemo(
        () => pickRailMode(data?.rows, data?.fallback, savedIds),
        [data?.rows, data?.fallback, savedIds],
    );

    if (rail.mode === 'hidden') return null;

    return (
        <View style={styles.wrap}>
            <Text style={[styles.label, { color: palette.textMuted }]}>{rail.title}</Text>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.railContent}
            >
                {rail.mode === 'trending'
                    ? rail.cards.map((card) => (
                          <TrendingRailCard key={card.restaurant_id} card={card} />
                      ))
                    : rail.cards.map((card) => (
                          <FallbackRailCard key={card.restaurant_id} card={card} />
                      ))}
            </ScrollView>
        </View>
    );
}

// ── Mode 1 — trending card (TICKET-114 v2 — import-count signal) ─────────────

function TrendingRailCard({ card }: { card: TrendingCard }) {
    const meta = [card.cuisine, card.neighborhood].filter(Boolean).join(' · ');
    return (
        <BaseRailCard
            restaurantId={card.restaurant_id}
            name={card.name}
            meta={meta}
            signal={trendingSignal(card)}
        />
    );
}

// ── Mode 2 — fallback card (Google as a labeled sibling signal) ─────────────

function FallbackRailCard({ card }: { card: FallbackCard }) {
    // "cuisine · city" meta + a quiet "{rating} on Google" sibling line —
    // one decimal, source labeled, NEVER co-displayed with a Napkin number.
    const meta = [card.cuisine, card.neighborhood].filter(Boolean).join(' · ');
    return (
        <BaseRailCard
            restaurantId={card.restaurant_id}
            name={card.name}
            meta={meta}
            googleLine={`${card.google_rating.toFixed(1)} on Google`}
        />
    );
}

function BaseRailCard({
    restaurantId,
    name,
    meta,
    signal,
    googleLine,
}: {
    restaurantId: string;
    name: string;
    meta: string;
    /** Mode 1: terracotta import/save signal line. */
    signal?: string;
    /** Mode 2: quiet Google sibling line. */
    googleLine?: string;
}) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    return (
        <Pressable
            onPress={() =>
                router.push({ pathname: '/restaurant/[id]', params: { id: restaurantId } })
            }
            style={({ pressed }) => [
                styles.card,
                Shadow.subtle,
                { backgroundColor: palette.surfaceNote, opacity: pressed ? 0.85 : 1 },
            ]}
        >
            {/* Type-led — no photo, no monogram chip. Just the name and its signal. */}
            <Text numberOfLines={2} style={[styles.name, { color: palette.text }]}>
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
            {!!googleLine && (
                <Text numberOfLines={1} style={[styles.google, { color: palette.textMuted }]}>
                    {googleLine}
                </Text>
            )}
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
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        paddingHorizontal: Spacing.lg,
        marginBottom: Spacing.sm,
    },
    railContent: {
        paddingHorizontal: Spacing.lg,
        gap: 12,
    },
    card: {
        width: 210,
        borderRadius: Radius.lg,
        paddingHorizontal: 16,
        paddingVertical: 15,
    },
    name: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 19,
        lineHeight: 23,
        marginBottom: 4,
    },
    meta: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
        lineHeight: 15,
    },
    signal: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11.5,
        lineHeight: 16,
        marginTop: 5,
    },
    google: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
        lineHeight: 15,
        marginTop: 5,
    },
});
