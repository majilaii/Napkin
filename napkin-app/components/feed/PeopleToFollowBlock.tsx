/**
 * PeopleToFollowBlock — the For You feed's people block (TICKET-125 +
 * TICKET-130 avatar-rail re-dress; v2 mixed rail TICKET-189).
 *
 * TWO PATHS, chosen by the FOR_YOU_PEOPLE_V2 flag (compile-time constant):
 *
 *   OFF (store build) — the existing co-diner-only path, unchanged: people
 *   the viewer has actually eaten with (useCoDiners, ranked meals-together),
 *   local followed/removed sets for instant tap feedback.
 *
 *   ON — the v2 mixed rail: co-diners FIRST, then recently-active public
 *   authors (useFollowCandidates, server-merged + deduped, cap 8). Kicker
 *   `people to follow`. Context lines stay honest and relationship-free for
 *   publics: co-diner `{N} meals together`, public `{N} places logged`
 *   (public-eligible logs only). NO local removal state — useFollow owns the
 *   candidate-cache lifecycle (optimistic removal in onMutate, rollback in
 *   onError), so this block simply renders whatever the query cache holds and
 *   the ForYouFeed arbiter drops the whole block (kicker included — no orphan
 *   header/separator) when the last candidate is followed.
 *
 * Self-hides (renders null) when there is nobody to show.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { Colors, Radius, Shadow } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { queryKeys } from '@/lib/queryKeys';
import { FOR_YOU_PEOPLE_V2 } from '@/constants/flags';
import { useCoDiners, type CoDinerCandidate } from '@/hooks/feed/useCoDiners';
import { useFollowCandidates, type FollowCandidate } from '@/hooks/feed/useFollowCandidates';
import { useFollow } from '@/hooks/users/useFollow';
import { resolveEmptyState } from './feedEmptyStateGate';
import { SectionKicker } from './SectionKicker';
import { Avatar } from './Avatar';

type Palette = typeof Colors.light;

export function PeopleToFollowBlock() {
    if (FOR_YOU_PEOPLE_V2) return <PeopleToFollowV2 />;
    return <PeopleToFollowV1 />;
}

/** Honest, relationship-free-for-publics context line. */
export function candidateMetaLine(candidate: FollowCandidate): string {
    if (candidate.kind === 'co_diner') {
        const meals = candidate.meals_together ?? 0;
        return `${meals} ${meals === 1 ? 'meal' : 'meals'} together`;
    }
    const logs = candidate.logs_30d ?? 0;
    return `${logs} ${logs === 1 ? 'place' : 'places'} logged`;
}

// ── v2 — mixed rail (flag ON) ─────────────────────────────────────────────────

function PeopleToFollowV2() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const { user } = useAuth();
    const viewerId = user?.id ?? null;

    const { data: candidates } = useFollowCandidates(viewerId);
    const follow = useFollow();

    const handleFollow = useCallback(
        (targetUserId: string) => {
            // useFollow owns the candidate caches: optimistic removal in
            // onMutate (the card exits immediately), rollback in onError,
            // feed.friends invalidation in onSuccess. Nothing local here.
            follow.mutate({ targetUserId });
        },
        [follow],
    );

    const handleOpenProfile = useCallback(
        (targetUserId: string) => {
            router.push({ pathname: '/u/[identifier]', params: { identifier: targetUserId } });
        },
        [router],
    );

    const visible = candidates ?? [];
    if (visible.length === 0) return null;

    return (
        <View>
            <SectionKicker>people to follow</SectionKicker>
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
                            name={candidate.display_name}
                            avatarUrl={candidate.avatar_url}
                            metaLine={candidateMetaLine(candidate)}
                            palette={palette}
                            followed={false}
                            onFollow={() => handleFollow(candidate.user_id)}
                            onOpenProfile={() => handleOpenProfile(candidate.user_id)}
                        />
                    </Animated.View>
                ))}
            </ScrollView>
        </View>
    );
}

// ── v1 — co-diners only (flag OFF; mechanics unchanged from TICKET-125) ──────

function PeopleToFollowV1() {
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
            <SectionKicker>people to follow</SectionKicker>
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
                            name={candidate.display_name}
                            avatarUrl={candidate.avatar_url}
                            metaLine={coDinerMetaLine(candidate)}
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

function coDinerMetaLine(candidate: CoDinerCandidate): string {
    const meals = candidate.meals_together;
    return `${meals} ${meals === 1 ? 'meal' : 'meals'} together`;
}

/**
 * PersonRailCard — vertical rail item (avatar over name over context line over
 * an outline follow pill). Same contract as CoDinerFollowCard, rail-shaped.
 */
function PersonRailCard({
    name,
    avatarUrl,
    metaLine,
    palette,
    followed,
    onFollow,
    onOpenProfile,
}: {
    name: string;
    avatarUrl: string | null;
    metaLine: string;
    palette: Palette;
    followed: boolean;
    onFollow: () => void;
    onOpenProfile: () => void;
}) {
    return (
        <View
            style={[styles.person, { backgroundColor: palette.card }, Shadow.ambient]}
            testID="person-card"
        >
            <Avatar
                name={name}
                url={avatarUrl}
                size={54}
                palette={palette}
                onPress={onOpenProfile}
            />
            <Pressable
                onPress={onOpenProfile}
                accessibilityRole="button"
                accessibilityLabel={`Open ${name}'s profile`}
            >
                <Text
                    style={[styles.name, { color: palette.text }]}
                    numberOfLines={1}
                    testID="person-name"
                >
                    {name}
                </Text>
                <Text
                    style={[styles.meals, { color: palette.textMuted }]}
                    numberOfLines={1}
                    testID="person-meta"
                >
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
                        : { borderColor: palette.primary, opacity: pressed ? 0.7 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={followed ? `Following ${name}` : `Follow ${name}`}
                testID="person-follow"
            >
                <Text
                    style={[
                        styles.followText,
                        { color: followed ? palette.textMuted : palette.primary },
                    ]}
                    testID="person-follow-label"
                >
                    {followed ? 'following' : 'follow'}
                </Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    railContent: {
        paddingHorizontal: 20,
        paddingBottom: 6,
        gap: 10,
    },
    person: {
        width: 128,
        height: 172,
        borderRadius: Radius.lg,
        paddingHorizontal: 12,
        paddingTop: 16,
        paddingBottom: 14,
        alignItems: 'center',
    },
    name: {
        fontFamily: 'Newsreader_500Medium',
        fontSize: 15,
        fontWeight: '500',
        lineHeight: 18,
        height: 18,
        marginTop: 9,
        textAlign: 'center',
        width: 104,
    },
    meals: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 13,
        lineHeight: 18,
        height: 18,
        marginTop: 2,
        textAlign: 'center',
        width: 104,
    },
    followBtn: {
        borderWidth: 1.5,
        borderRadius: Radius.full,
        paddingHorizontal: 16,
        paddingVertical: 5,
        marginTop: 10,
    },
    followText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
        fontWeight: '700',
        lineHeight: 18,
        letterSpacing: 0.5,
    },
});
