/**
 * TrendingRail — the two-mode trending block (TICKET-098 Phase B + TICKET-102 +
 * TICKET-130 "Gazette mix" re-dress: horizontal cards → RANKED LEDGER).
 *
 * Mode 1 (trending): vertical ranked ledger of restaurants sourced from Napkin
 * intake — imports (TikTok/IG share-to-Napkin) are the HEADLINE signal, then
 * saves + list adds. Kicker "trending this week"; signal line (terracotta)
 * "{n} imported · {m} saved". Hidden below 3 qualifiers.
 *
 * Mode 2 (fallback, TICKET-102): when mode 1 is below the floor, the ledger
 * switches SOURCE to restaurants ranked by their stored Google rating. Kicker
 * "nearby, well rated"; meta "{rating} on Google" — Google is a labeled SIBLING
 * signal, NEVER a Napkin number, and stays MUTED (never terracotta).
 *
 * Rows are pictureless — rank numeral + engraved GlyphChip (line-art Ionicons
 * outline glyph on a tinted plate, NOT a photo) + name/meta/signal. No photos
 * anywhere (founder-locked 2026-07-07).
 *
 * Rules (both modes):
 *   - Max 5 rows, then it ends. No scroll, no "load more".
 *   - Exactly one mode renders — never mixed grammars (enforced by pickRailMode).
 *   - Hidden ENTIRELY when neither mode has cards (clean absence).
 *   - Tap → restaurant/[id].
 */
import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useTrending, type TrendingCard, type FallbackCard } from '@/hooks/feed/useTrending';
import { useSavedRestaurantIds } from '@/hooks/feed/useSavedRestaurantIds';
import { pickRailMode } from './railMode';
import { trendingSignal } from './trendingSignal';
import { SectionKicker } from './SectionKicker';
import { GlyphChip } from './GlyphChip';

/** Ranked ledger cap — 01–05, no scroll (TICKET-130). */
const MAX_LEDGER_ROWS = 5;

export function TrendingRail() {
    const { user } = useAuth();
    const { data } = useTrending();

    const savedIds = useSavedRestaurantIds(user?.id ?? null);
    const rail = useMemo(
        () => pickRailMode(data?.rows, data?.fallback, savedIds),
        [data?.rows, data?.fallback, savedIds],
    );

    if (rail.mode === 'hidden') return null;

    return (
        <View>
            <SectionKicker>{rail.title}</SectionKicker>
            <View style={styles.rows}>
                {rail.mode === 'trending'
                    ? rail.cards
                          .slice(0, MAX_LEDGER_ROWS)
                          .map((card, i) => (
                              <TrendingLedgerRow key={card.restaurant_id} card={card} index={i} />
                          ))
                    : rail.cards
                          .slice(0, MAX_LEDGER_ROWS)
                          .map((card, i) => (
                              <FallbackLedgerRow key={card.restaurant_id} card={card} index={i} />
                          ))}
            </View>
        </View>
    );
}

// ── Mode 1 — trending row (TICKET-114 import-count signal, terracotta) ───────

function TrendingLedgerRow({ card, index }: { card: TrendingCard; index: number }) {
    const meta = [card.cuisine, card.neighborhood].filter(Boolean).join(' · ');
    return (
        <BaseLedgerRow
            restaurantId={card.restaurant_id}
            index={index}
            cuisine={card.cuisine}
            name={card.name}
            meta={meta}
            signal={trendingSignal(card)}
        />
    );
}

// ── Mode 2 — fallback row (Google as a labeled sibling signal, muted) ────────

function FallbackLedgerRow({ card, index }: { card: FallbackCard; index: number }) {
    const meta = [card.cuisine, card.neighborhood].filter(Boolean).join(' · ');
    return (
        <BaseLedgerRow
            restaurantId={card.restaurant_id}
            index={index}
            cuisine={card.cuisine}
            name={card.name}
            meta={meta}
            googleLine={`${card.google_rating.toFixed(1)} on Google`}
        />
    );
}

function BaseLedgerRow({
    restaurantId,
    index,
    cuisine,
    name,
    meta,
    signal,
    googleLine,
}: {
    restaurantId: string;
    index: number;
    cuisine: string | null;
    name: string;
    meta: string;
    /** Mode 1: terracotta import/save signal line. */
    signal?: string;
    /** Mode 2: quiet Google sibling line — muted, never terracotta. */
    googleLine?: string;
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
                {!!googleLine && (
                    <Text numberOfLines={1} style={[styles.google, { color: palette.textMuted }]}>
                        {googleLine}
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
    },
    rank: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 24,
        opacity: 0.85,
        minWidth: 34,
        flexShrink: 0,
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
    google: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
        lineHeight: 15,
        marginTop: 3,
    },
});
