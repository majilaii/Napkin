/**
 * PeopleToFollowBlock — the For You feed's "taste buds" people block
 * (TICKET-125 + TICKET-130 "Gazette mix" re-dress: slab rows → AVATAR RAIL on
 * the page ground, no slab background).
 *
 *   people you've eaten with
 *   ( avatar )  ( avatar )  ( avatar )   → horizontal scroll
 *     Clara       Thomas      Julian
 *   3 meals together  ·  [ follow ] pill under each
 *
 * v1 source: co-diners — people the viewer has actually eaten with on Napkin but
 * doesn't follow yet (useCoDiners, ranked by meals-together). Taste-calibrated
 * stranger suggestions (Ring-2) are DEFERRED (decision 3) — this block is
 * co-diners only.
 *
 * Mechanics are UNCHANGED from TICKET-125 (restyle only): one tap follows via
 * the shipped useFollow (optimistic snapshot→patch→rollback); the block owns
 * local followed/removed sets so the tap "does something" instantly, then the
 * card is removed on success and queryKeys.feed.friends(viewerId) is
 * invalidated so a switch to Following shows the newly-followed author.
 * PersonRailCard is a rail-shaped SIBLING of CoDinerFollowCard — the row card
 * stays untouched for its other consumers (TICKET-126 onboarding). Self-hides
 * (renders null) when there are no co-diners left to show.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { queryKeys } from '@/lib/queryKeys';
import { useCoDiners, type CoDinerCandidate } from '@/hooks/feed/useCoDiners';
import { useFollow } from '@/hooks/users/useFollow';
import { resolveEmptyState } from './feedEmptyStateGate';
import { SectionKicker } from './SectionKicker';
import { Avatar } from './Avatar';

type Palette = typeof Colors.light;

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
        <View>
            <SectionKicker>people you&rsquo;ve eaten with</SectionKicker>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.railContent}
            >
                {visible.map((candidate) => (
                    <Animated.View
                        key={candidate.user_id}
                        exiting={FadeOut.duration(200)}
                        layout={LinearTransition.duration(200)}
                    >
                        <PersonRailCard
                            candidate={candidate}
                            palette={palette}
                            followed={followedIds.has(candidate.user_id)}
                            onFollow={() => handleFollow(candidate.user_id)}
                            onOpenProfile={() => handleOpenProfile(candidate.user_id)}
                        />
                    </Animated.View>
                ))}
            </ScrollView>
        </View>
    );
}

/**
 * PersonRailCard — vertical rail item (avatar over name over meals-count over
 * an outline follow pill). Same contract as CoDinerFollowCard, rail-shaped.
 */
function PersonRailCard({
    candidate,
    palette,
    followed,
    onFollow,
    onOpenProfile,
}: {
    candidate: CoDinerCandidate;
    palette: Palette;
    followed: boolean;
    onFollow: () => void;
    onOpenProfile: () => void;
}) {
    const meals = candidate.meals_together;
    const metaLine = `${meals} ${meals === 1 ? 'meal' : 'meals'} together`;

    return (
        <View style={styles.person}>
            <Avatar
                name={candidate.display_name}
                url={candidate.avatar_url}
                size={54}
                palette={palette}
                onPress={onOpenProfile}
            />
            <Pressable
                onPress={onOpenProfile}
                accessibilityRole="button"
                accessibilityLabel={`Open ${candidate.display_name}'s profile`}
            >
                <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                    {candidate.display_name}
                </Text>
                <Text style={[styles.meals, { color: palette.textMuted }]} numberOfLines={1}>
                    {metaLine}
                </Text>
            </Pressable>
            <Pressable
                onPress={followed ? undefined : onFollow}
                disabled={followed}
                hitSlop={6}
                style={({ pressed }) => [
                    styles.followBtn,
                    followed
                        ? { borderColor: palette.outlineVariant }
                        : { borderColor: palette.terracottaBorderStrong, opacity: pressed ? 0.7 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={
                    followed
                        ? `Following ${candidate.display_name}`
                        : `Follow ${candidate.display_name}`
                }
            >
                <Text
                    style={[
                        styles.followText,
                        { color: followed ? palette.textMuted : palette.primary },
                    ]}
                >
                    {followed ? 'following' : 'follow'}
                </Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    railContent: {
        paddingHorizontal: Spacing.lg,
        gap: Spacing.md,
    },
    person: {
        width: 104,
        alignItems: 'center',
    },
    name: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11,
        marginTop: 8,
        textAlign: 'center',
        maxWidth: 100,
    },
    meals: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 9,
        marginTop: 2,
        textAlign: 'center',
        maxWidth: 100,
    },
    followBtn: {
        borderWidth: 1.5,
        borderRadius: Radius.full,
        paddingHorizontal: 14,
        paddingVertical: 5,
        marginTop: 8,
    },
    followText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11,
    },
});
