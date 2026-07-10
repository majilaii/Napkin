/**
 * ForYouFeed — the For You body of the Feed tab (TICKET-125).
 *
 * The app's discovery home: a small, fixed stack of purposeful signals (no new
 * ranking engine, no stranger review content). Order:
 *
 *   1. public lists   — image-led cards for authored collections
 *   2. trending       — places with real Napkin import/save intent
 *   3. people         — co-diners you've eaten with (avatar rail, follow)
 *
 * Composition is central: `visibleForYouBlocks(flags)` computes which blocks
 * render, so the "everything empty" case has one clean answer (empty array ⇒
 * ForYouEmpty). The generic Google-rated fallback is intentionally absent: it
 * has no relationship to the viewer's taste or the Napkin community.
 *
 * Renders NO `entry` cards — only list-, restaurant-, and person-level rows, all
 * routing OUT to /list/[id], /restaurant/[id], /u/[identifier]. So it introduces
 * no public-scope reaction/comment patch path; the queryKeys.feed.friendsAll
 * walkers stay owned by Following. (See forYouBlocks.ts.)
 */
import React, { useCallback, useMemo } from 'react';
import { View, Text, FlatList, Pressable, ActivityIndicator, Share, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { track } from '@/lib/track';
import { TESTFLIGHT_INVITE_URL } from '@/constants/links';
import { useTrending } from '@/hooks/feed/useTrending';
import { useCoDiners } from '@/hooks/feed/useCoDiners';
import { useBrowsePublicLists } from '@/hooks/lists/useBrowsePublicLists';
import { visibleTrendingCards } from './trendingRailGate';
import { visibleForYouBlocks, type ForYouBlock, type ForYouFlags } from './forYouBlocks';
import { TrendingRail } from './TrendingRail';
import { PublicListsBrowseBlock } from './PublicListsBrowseBlock';
import { PeopleToFollowBlock } from './PeopleToFollowBlock';
import { arrangePublicLists } from './listPresentation';

interface Props {
    ListHeaderComponent: React.ReactElement;
    /** Reserved for a future "→ Following" affordance; unused in v1 (see TICKET-125). */
    onSwitchToFollowing?: () => void;
}

export function ForYouFeed({ ListHeaderComponent }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const { user } = useAuth();
    const viewerId = user?.id ?? null;

    // Single subscription each — the child blocks that re-read these hooks share
    // the same react-query cache (deduped), never a second fetch.
    const browse = useBrowsePublicLists();
    const trending = useTrending();
    const coDiners = useCoDiners(viewerId);

    const trendingCards = useMemo(
        () => visibleTrendingCards(trending.data?.rows),
        [trending.data?.rows],
    );
    const browseLists = useMemo(() => browse.data ?? [], [browse.data]);
    const listPresentation = useMemo(() => arrangePublicLists(browseLists), [browseLists]);

    const flags: ForYouFlags = useMemo(
        () => ({
            hasPublicLists: listPresentation.showcase !== null || listPresentation.rail.length > 0,
            railVisible: trendingCards.length > 0,
            hasCoDiners: (coDiners.data?.length ?? 0) > 0,
        }),
        [listPresentation.showcase, listPresentation.rail.length, trendingCards.length, coDiners.data?.length],
    );

    const blocks = useMemo(() => visibleForYouBlocks(flags), [flags]);

    // Empty fallback only once nothing is still resolving — else a cold mount
    // would flash ForYouEmpty before the fallback rail arrives.
    const anyLoading = browse.isLoading || trending.isLoading || coDiners.isLoading;

    const renderItem = useCallback(
        ({ item }: { item: ForYouBlock }) => {
            switch (item._type) {
                case 'public_lists':
                    return <PublicListsBrowseBlock lists={browseLists} />;
                case 'trending':
                    return <TrendingRail />;
                case 'people':
                    return <PeopleToFollowBlock />;
                default:
                    return null;
            }
        },
        [browseLists],
    );

    return (
        <FlatList
            data={blocks}
            keyExtractor={(item) => item._type}
            renderItem={renderItem}
            ItemSeparatorComponent={BlockSeparator}
            ListHeaderComponent={ListHeaderComponent}
            ListEmptyComponent={
                anyLoading ? (
                    <ActivityIndicator style={{ marginTop: Spacing.xl }} color={palette.primary} />
                ) : (
                    <ForYouEmpty />
                )
            }
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingTop: Spacing.md, paddingBottom: insets.bottom + 100 }}
        />
    );
}

function BlockSeparator() {
    return <View style={styles.separator} />;
}

/**
 * ForYouEmpty — no generic filler. One quiet line + an invite CTA — copy economy.
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
                — nothing personal here just yet
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
    separator: {
        height: 34,
    },
    emptyWrap: {
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.xxl,
        gap: 18,
    },
    emptyLine: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 16,
        lineHeight: 22,
        textAlign: 'center',
    },
    inviteBtn: {
        borderWidth: 1.5,
        borderRadius: Radius.full,
        paddingHorizontal: 16,
        paddingVertical: 7,
    },
    inviteText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
    },
});
