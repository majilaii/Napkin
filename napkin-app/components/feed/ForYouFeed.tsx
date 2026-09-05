/**
 * ForYouFeed — the For You body of the Feed tab (TICKET-125; rebuilt
 * TICKET-189).
 *
 * A discovery READING ROOM, not a ranked feed: a small, fixed, ordered stack
 * of community-scoped modules —
 *
 *   1. on socials    — most-saved-from-TikTok/IG clips (flag FOR_YOU_SOCIALS)
 *   2. people        — co-diners (+ recently-active publics behind
 *                      FOR_YOU_PEOPLE_V2), avatar rail with follow
 *   3. public lists  — image-led cards for authored collections (viewer's own
 *                      excluded server-side)
 *
 * Trending is gone from the stack (§5 — merged into socials; the
 * feed-trending backend stays intact for future staged modules).
 *
 * Composition is central: `visibleForYouBlocks(flags)` computes which blocks
 * render. §6 cross-module contract (Codex P1 — visible-block-first, never a
 * global anyLoading gate):
 *   - ≥1 block visible → render the blocks and STOP. A still-loading or
 *     errored sibling never blanks a resolved one; offline cached data keeps
 *     its module visible.
 *   - zero blocks visible → branch the whole-surface state:
 *       (a) any active module query still loading      → spinner
 *       (b) any active module query errored             → compact retry row
 *           (NEVER the invite — it would lie about the community being empty)
 *       (c) every query settled successfully and empty → ForYouEmpty invite
 *
 * Renders NO `entry` cards — only list-, restaurant-, and person-level rows,
 * all routing OUT. So it introduces no public-scope reaction/comment patch
 * path; the queryKeys.feed.friendsAll walkers stay owned by Following.
 */
import React, { useCallback, useMemo } from 'react';
import { View, Text, FlatList, Pressable, ActivityIndicator, Share, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { track } from '@/lib/track';
import { TESTFLIGHT_INVITE_URL } from '@/constants/links';
import { FOR_YOU_PEOPLE_V2, FOR_YOU_SOCIALS } from '@/constants/flags';
import { useSocials } from '@/hooks/feed/useSocials';
import { useCoDiners } from '@/hooks/feed/useCoDiners';
import { useFollowCandidates } from '@/hooks/feed/useFollowCandidates';
import { useBrowsePublicLists } from '@/hooks/lists/useBrowsePublicLists';
import {
    resolveForYouZeroVisibleState,
    visibleForYouBlocks,
    type ForYouBlock,
    type ForYouFlags,
    type ForYouModuleQueryState,
} from './forYouBlocks';
import { OnSocialsBlock } from './OnSocialsBlock';
import { PublicListsBrowseBlock } from './PublicListsBrowseBlock';
import { PeopleToFollowBlock } from './PeopleToFollowBlock';
import { arrangePublicLists } from './listPresentation';

interface Props {
    ListHeaderComponent: React.ReactElement;
}

export function ForYouFeed({ ListHeaderComponent }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const { user } = useAuth();
    const viewerId = user?.id ?? null;

    // Single subscription each — the child blocks that re-read these hooks
    // share the same react-query cache (deduped), never a second fetch.
    // Flag-disabled hooks (enabled:false) never fire and never error, and are
    // excluded from the §6 active set below — no dangling isError reference.
    const socials = useSocials(viewerId);
    const browse = useBrowsePublicLists(viewerId);
    const followCandidates = useFollowCandidates(viewerId);
    // Only one people source is live per flag state: v2 on → the mixed rail
    // owns the block, so the co-diner query stays disabled (null id).
    const coDiners = useCoDiners(FOR_YOU_PEOPLE_V2 ? null : viewerId);

    const socialsCards = useMemo(() => socials.data ?? [], [socials.data]);
    const browseLists = useMemo(() => browse.data ?? [], [browse.data]);
    const listPresentation = useMemo(() => arrangePublicLists(browseLists), [browseLists]);

    const flags: ForYouFlags = useMemo(
        () => ({
            hasSocials: FOR_YOU_SOCIALS && socialsCards.length > 0,
            hasPublicLists: listPresentation.showcase !== null || listPresentation.rail.length > 0,
            hasPeople: FOR_YOU_PEOPLE_V2
                ? (followCandidates.data?.length ?? 0) > 0
                : (coDiners.data?.length ?? 0) > 0,
        }),
        [
            socialsCards.length,
            listPresentation.showcase,
            listPresentation.rail.length,
            followCandidates.data?.length,
            coDiners.data?.length,
        ],
    );

    const blocks = useMemo(() => visibleForYouBlocks(flags), [flags]);

    // §6: the ACTIVE module queries (flag-disabled ones excluded — a disabled
    // query reports isPending forever and would wedge the spinner branch).
    // Structural type: the queries carry heterogeneous row types; §6 only
    // reads lifecycle facts.
    type ModuleQueryState = ForYouModuleQueryState & {
        refetch: () => Promise<unknown>;
    };
    const activeQueries = useMemo<ModuleQueryState[]>(() => {
        const qs: ModuleQueryState[] = [browse, FOR_YOU_PEOPLE_V2 ? followCandidates : coDiners];
        if (FOR_YOU_SOCIALS) qs.push(socials);
        return qs;
    }, [browse, followCandidates, coDiners, socials]);

    const zeroVisibleState = resolveForYouZeroVisibleState(activeQueries);

    const handleRetry = useCallback(() => {
        for (const q of activeQueries) {
            if (q.isError) void q.refetch();
        }
    }, [activeQueries]);

    const renderItem = useCallback(
        ({ item }: { item: ForYouBlock }) => {
            switch (item._type) {
                case 'on_socials':
                    return <OnSocialsBlock cards={socialsCards} />;
                case 'public_lists':
                    return <PublicListsBrowseBlock lists={browseLists} />;
                case 'people':
                    return <PeopleToFollowBlock />;
                default:
                    return null;
            }
        },
        [socialsCards, browseLists],
    );

    return (
        <FlatList
            data={blocks}
            keyExtractor={(item) => item._type}
            renderItem={renderItem}
            ListHeaderComponent={ListHeaderComponent}
            ListEmptyComponent={
                // Zero visible modules — branch the whole-surface state (§6).
                zeroVisibleState === 'loading' ? (
                    <ActivityIndicator style={{ marginTop: Spacing.xl }} color={palette.primary} />
                ) : zeroVisibleState === 'retry' ? (
                    <ForYouRetry onRetry={handleRetry} />
                ) : (
                    <ForYouEmpty />
                )
            }
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
        />
    );
}

/**
 * ForYouRetry — the §6 compact retry state: something failed and no module is
 * visible. Never the invite (which would claim the community is empty).
 */
function ForYouRetry({ onRetry }: { onRetry: () => void }) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View style={styles.emptyWrap}>
            <Text style={[styles.emptyLine, { color: palette.textMuted }]}>
                couldn&rsquo;t load this
            </Text>
            <Pressable
                onPress={onRetry}
                style={({ pressed }) => [
                    styles.inviteBtn,
                    { borderColor: palette.terracottaBorderStrong, opacity: pressed ? 0.7 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Try loading For You again"
            >
                <Text style={[styles.inviteText, { color: palette.primary }]}>try again</Text>
            </Pressable>
        </View>
    );
}

/**
 * ForYouEmpty — the genuinely-empty-community invite. Renders ONLY when every
 * active module query settled successfully and empty (§6). One quiet Manrope
 * status line + an invite CTA — copy economy, no italic serif.
 */
function ForYouEmpty() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const handleInvite = useCallback(() => {
        track('invite_sent', { surface: 'for_you_empty' });
        void Share.share({
            message: TESTFLIGHT_INVITE_URL
                ? `come try Napkin with me — ${TESTFLIGHT_INVITE_URL}`
                : 'come try Napkin with me',
        });
    }, []);

    return (
        <View style={styles.emptyWrap}>
            <Text style={[styles.emptyLine, { color: palette.textMuted }]}>
                nothing here just yet
            </Text>
            <Pressable
                onPress={handleInvite}
                style={({ pressed }) => [
                    styles.inviteBtn,
                    { borderColor: palette.terracottaBorderStrong, opacity: pressed ? 0.7 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Invite a friend to Napkin"
            >
                <Text style={[styles.inviteText, { color: palette.primary }]}>invite a friend</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    emptyWrap: {
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.xxl,
        gap: 18,
    },
    emptyLine: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 16,
        lineHeight: 22,
        textAlign: 'center',
    },
    inviteBtn: {
        minHeight: 44, justifyContent: 'center',
        borderWidth: 1.5,
        borderRadius: Radius.full,
        paddingHorizontal: 16,
        paddingVertical: 7,
    },
    inviteText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
    },
});
