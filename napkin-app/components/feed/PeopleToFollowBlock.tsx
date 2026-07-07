/**
 * PeopleToFollowBlock — the For You feed's "taste buds" people block (TICKET-125).
 *
 *   people you've eaten with
 *   [avatar]  Clara            [ follow ]
 *             3 meals together
 *
 * v1 source: co-diners — people the viewer has actually eaten with on Napkin but
 * doesn't follow yet (useCoDiners, ranked by meals-together). Taste-calibrated
 * stranger suggestions (Ring-2) are DEFERRED (decision 3) — this block is
 * co-diners only. Extracted from the old FeedEmptyState tier-1 slab; it OWNS the
 * CoDinerFollowCard optimistic-follow contract (TICKET-126 adapts, never forks).
 *
 * One tap follows via the shipped useFollow (optimistic snapshot→patch→rollback);
 * the card owns a local `followed` flag so the tap "does something" instantly,
 * then is removed on success and the friends feed is invalidated so a switch to
 * Following shows the newly-followed author. Self-hides (renders null) when there
 * are no co-diners left to show — For You's own empty fallback owns the
 * all-empty case, and the ghost/invite lives in Following, not here.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { queryKeys } from '@/lib/queryKeys';
import { useCoDiners } from '@/hooks/feed/useCoDiners';
import { useFollow } from '@/hooks/users/useFollow';
import { resolveEmptyState } from './feedEmptyStateGate';
import { CoDinerFollowCard } from './CoDinerFollowCard';

export function PeopleToFollowBlock() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const viewerId = user?.id ?? null;

    const { data: candidates } = useCoDiners(viewerId);
    const follow = useFollow();

    // Local optimistic state — which cards were tapped, which are confirmed
    // (removed). Neither touches the query cache; useFollow owns its own snapshots.
    const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());
    const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

    const resolution = useMemo(() => resolveEmptyState(candidates), [candidates]);

    const handleFollow = useCallback(
        (targetUserId: string) => {
            setFollowedIds((prev) => new Set(prev).add(targetUserId));
            follow.mutate(
                { targetUserId },
                {
                    onSuccess: () => {
                        setRemovedIds((prev) => new Set(prev).add(targetUserId));
                        if (viewerId) {
                            queryClient.invalidateQueries({
                                queryKey: queryKeys.feed.friends(viewerId),
                            });
                        }
                    },
                    onError: () => {
                        setFollowedIds((prev) => {
                            const next = new Set(prev);
                            next.delete(targetUserId);
                            return next;
                        });
                    },
                },
            );
        },
        [follow, queryClient, viewerId],
    );

    const handleOpenProfile = useCallback(
        (targetUserId: string) => {
            router.push({ pathname: '/u/[identifier]', params: { identifier: targetUserId } });
        },
        [router],
    );

    const visible =
        resolution.tier === 1
            ? resolution.cards.filter((c) => !removedIds.has(c.user_id))
            : [];

    // Self-guard: no co-diners (or all followed) → the block stands down.
    if (visible.length === 0) return null;

    return (
        <View style={styles.wrap}>
            <View style={[styles.slab, { backgroundColor: palette.surfaceJournalLow }]}>
                <Text style={[styles.kicker, { color: palette.primary }]}>
                    people you&rsquo;ve eaten with
                </Text>
                <View style={styles.cardList}>
                    {visible.map((candidate) => (
                        <Animated.View
                            key={candidate.user_id}
                            exiting={FadeOut.duration(200)}
                            layout={LinearTransition.duration(200)}
                        >
                            <CoDinerFollowCard
                                candidate={candidate}
                                followed={followedIds.has(candidate.user_id)}
                                onFollow={() => handleFollow(candidate.user_id)}
                                onOpenProfile={() => handleOpenProfile(candidate.user_id)}
                            />
                        </Animated.View>
                    ))}
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        paddingHorizontal: Spacing.lg,
    },
    slab: {
        borderRadius: Radius.xl,
        padding: 20,
    },
    kicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9.5,
        letterSpacing: 1.8,
        textTransform: 'uppercase',
    },
    cardList: {
        marginTop: 10,
    },
});
