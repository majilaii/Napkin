/**
 * ForYouFeed — the For You body of the Feed tab (TICKET-125).
 *
 * The app's one discovery home: a fixed, ordered stack of already-shipped
 * discovery surfaces (no new ranking engine, no stranger review content):
 *
 *   1. public lists   — recent public lists (net-new browse surface)
 *   2. trending       — TrendingRail (import/save intent OR Google-rated fallback)
 *   3. people         — co-diners you've eaten with (follow suggestions)
 *   4. discovery      — DiscoveryLedger "Worth a look" (Google-rated, demoted tail)
 *
 * Composition is central: `visibleForYouBlocks(flags)` computes which blocks
 * render, so the "everything empty" case has one clean answer (empty array ⇒
 * ForYouEmpty). Trending and discovery are mutually exclusive via the existing
 * pickRailMode arbiter. Every block ALSO self-guards defensively.
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
import { useSavedRestaurantIds } from '@/hooks/feed/useSavedRestaurantIds';
import { useBrowsePublicLists } from '@/hooks/lists/useBrowsePublicLists';
import { pickRailMode } from './railMode';
import { visibleFallbackCards } from './fallbackRailGate';
import { visibleForYouBlocks, type ForYouBlock, type ForYouFlags } from './forYouBlocks';
import { TrendingRail } from './TrendingRail';
import { DiscoveryLedger } from './DiscoveryLedger';
import { PublicListsBrowseBlock } from './PublicListsBrowseBlock';
import { PeopleToFollowBlock } from './PeopleToFollowBlock';

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
    const savedIds = useSavedRestaurantIds(viewerId);

    const railMode = useMemo(
        () => pickRailMode(trending.data?.rows, trending.data?.fallback, savedIds).mode,
        [trending.data?.rows, trending.data?.fallback, savedIds],
    );
    const discoveryCards = useMemo(
        () => visibleFallbackCards(trending.data?.fallback, savedIds),
        [trending.data?.fallback, savedIds],
    );

    const flags: ForYouFlags = useMemo(
        () => ({
            hasPublicLists: (browse.data?.length ?? 0) > 0,
            railVisible: railMode !== 'hidden',
            hasCoDiners: (coDiners.data?.length ?? 0) > 0,
            // Mutually exclusive with the rail (unchanged pickRailMode discipline).
            hasDiscovery: railMode === 'hidden' && discoveryCards.length > 0,
        }),
        [browse.data?.length, railMode, coDiners.data?.length, discoveryCards.length],
    );

    const blocks = useMemo(() => visibleForYouBlocks(flags), [flags]);

    // Empty fallback only once nothing is still resolving — else a cold mount
    // would flash ForYouEmpty before the fallback rail arrives.
    const anyLoading = browse.isLoading || trending.isLoading || coDiners.isLoading;

    const browseLists = useMemo(() => browse.data ?? [], [browse.data]);

    const renderItem = useCallback(
        ({ item }: { item: ForYouBlock }) => {
            switch (item._type) {
                case 'public_lists':
                    return <PublicListsBrowseBlock lists={browseLists} />;
                case 'trending':
                    return <TrendingRail />;
                case 'people':
                    return <PeopleToFollowBlock />;
                case 'discovery':
                    return <DiscoveryLedger />;
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
 * ForYouEmpty — the all-empty fallback (rare: the Google-rated rail almost
 * always has cards). One quiet italic line + an invite CTA — copy economy.
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
                — nothing to explore yet
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
