/**
 * TrendingRail — the two-mode feed rail (TICKET-098 Phase B + TICKET-102).
 *
 * Mode 1 (trending, UNCHANGED): finite horizontal carousel of restaurants
 * sourced from wishlist intent (distinct savers — never ratings). Label
 * "Trending"; meta "cuisine · neighborhood · {n} saved this week". Hidden below
 * 3 qualifiers.
 *
 * Mode 2 (fallback, TICKET-102): when mode 1 is below the floor, the rail
 * switches SOURCE to restaurants ranked by their stored Google rating. Label
 * "worth a look"; meta "cuisine · city · {rating} on Google" — Google is a
 * labeled SIBLING signal, NEVER a Napkin number. Client-side dedup drops spots
 * already in the viewer's wishlist/journal (with a ~3-card un-hide floor).
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
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';

import { Colors, Spacing, Radius, Shadow } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { queryKeys } from '@/lib/queryKeys';
import { useTrending, type TrendingCard, type FallbackCard } from '@/hooks/feed/useTrending';
import { pickRailMode } from './railMode';

/**
 * Restaurant ids already in the viewer's local wishlist + journal caches — read
 * with getQueryData (no new fetch). Used to dedup the fallback rail so it stays
 * new-to-me. Empty on a cold install (nothing to dedup against — fine).
 */
function useSavedRestaurantIds(viewerId: string | null): Set<string> {
    const queryClient = useQueryClient();
    return useMemo(() => {
        const ids = new Set<string>();
        if (!viewerId) return ids;

        // Personal wishlist — InfiniteData<{ data: { restaurant?: { id } }[] }>.
        const wishlist = queryClient.getQueryData<
            InfiniteData<{ data: Array<{ restaurant?: { id?: string } | null }> }>
        >(queryKeys.wishlist.personal(viewerId));
        for (const page of wishlist?.pages ?? []) {
            for (const item of page?.data ?? []) {
                const id = item?.restaurant?.id;
                if (id) ids.add(id);
            }
        }

        // Diary — InfiniteData<{ rows: { restaurant_id }[] }> (page envelopes are
        // { rows }, never page.map — the 5bb6c6d lesson).
        const diary = queryClient.getQueryData<
            InfiniteData<{ rows: Array<{ restaurant_id?: string }> }>
        >(queryKeys.users.diary(viewerId));
        for (const page of diary?.pages ?? []) {
            for (const row of page?.rows ?? []) {
                if (row?.restaurant_id) ids.add(row.restaurant_id);
            }
        }

        return ids;
    }, [queryClient, viewerId]);
}

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

// ── Mode 1 — trending card (UNCHANGED grammar) ──────────────────────────────

function TrendingRailCard({ card }: { card: TrendingCard }) {
    const meta = [
        card.cuisine,
        card.neighborhood,
        `${card.saver_count_7d} saved this week`,
    ]
        .filter(Boolean)
        .join(' · ');
    return <BaseRailCard restaurantId={card.restaurant_id} name={card.name} meta={meta} />;
}

// ── Mode 2 — fallback card (Google as a labeled sibling signal) ─────────────

function FallbackRailCard({ card }: { card: FallbackCard }) {
    // "cuisine · city · {rating} on Google" — one decimal, source labeled,
    // NEVER co-displayed with a Napkin number.
    const meta = [
        card.cuisine,
        card.neighborhood,
        `${card.google_rating.toFixed(1)} on Google`,
    ]
        .filter(Boolean)
        .join(' · ');
    return <BaseRailCard restaurantId={card.restaurant_id} name={card.name} meta={meta} />;
}

function BaseRailCard({
    restaurantId,
    name,
    meta,
}: {
    restaurantId: string;
    name: string;
    meta: string;
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
                Shadow.note,
                { backgroundColor: palette.surfaceNote, opacity: pressed ? 0.8 : 1 },
            ]}
        >
            <Text numberOfLines={2} style={[styles.name, { color: palette.text }]}>
                {name}
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
