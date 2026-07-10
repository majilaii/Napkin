/**
 * Feed tab — For You / Following modes (TICKET-125).
 *
 * The tab is a mode orchestrator. It owns the single useFriendsFeed subscription
 * (both the Following body's data AND the "which mode by default" signal) and a
 * `mode` state, then swaps between two bodies that share one FeedHeader masthead:
 *
 *   For You   → the explore surface: public lists, trending, people, discovery
 *   Following → pure chronological reviews from people you follow, nothing else
 *
 * Default (locked decision 1): Following when the follow graph has content
 * (≥1 followed user with ≥1 visible entry — i.e. the first friends-feed page has
 * rows), For You when empty. Resolved ONCE per mount via `mode: FeedMode | null`
 * + a resolvedRef guard, so a manual toggle after resolution is never overridden.
 * While `mode === null` we render the masthead + a spinner with NO tabs — the
 * anti-flicker mechanism (tabs never paint in a provisional active state).
 *
 * Two separate FlatLists (not one union list): Following is keyset-paginated
 * date-sectioned rows; For You is a fixed ~4-block scroll. A mode switch remounts
 * the body (acceptable — no shared scroll position wanted).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useFriendsFeed, flattenFriendsFeed } from '@/hooks/feed';
import { FeedHeader, FollowingFeed, ForYouFeed } from '@/components/feed';
import type { FeedMode } from '@/components/feed';

export default function FeedScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const { user } = useAuth();

    // Single subscription — feeds the Following body AND the default-mode signal.
    const feedQuery = useFriendsFeed(user?.id);
    const { data, isPending } = feedQuery;
    const rows = useMemo(() => flattenFriendsFeed(data), [data]);

    // Default resolves once off the first friends-feed page. `null` until then.
    const [mode, setMode] = useState<FeedMode | null>(null);
    const resolvedRef = useRef(false);

    useEffect(() => {
        if (resolvedRef.current) return;
        // Gate on isPending (not isLoading): isPending stays true both while the
        // query is DISABLED (user id not hydrated yet — a disabled useInfiniteQuery
        // reports isLoading=false, which would resolve prematurely) AND while page 1
        // is still fetching. It flips false only once page 1 settles (success OR
        // error). The row count is then the "graph has content" signal — feed-friends
        // already filters to public-eligible entries authored by the follow set, so
        // rows > 0 ⇔ ≥1 followed user with ≥1 visible entry.
        if (isPending) return;
        resolvedRef.current = true;
        // Error ≠ empty graph: a settled page-1 error resolves to Following (its
        // body owns the retryable error state) instead of stranding the user on
        // For You for the session.
        setMode(feedQuery.isError || rows.length > 0 ? 'following' : 'for-you');
    }, [isPending, rows.length, feedQuery.isError]);

    // While resolving: masthead only (no tabs) + spinner. No flicker.
    if (mode === null) {
        return (
            <View style={[styles.root, { backgroundColor: palette.background }]}>
                <FeedHeader mode={null} onModeChange={setMode} />
                <ActivityIndicator style={{ marginTop: Spacing.xl }} color={palette.primary} />
            </View>
        );
    }

    const header = <FeedHeader mode={mode} onModeChange={setMode} />;

    return (
        <View style={[styles.root, { backgroundColor: palette.background }]}>
            {mode === 'following' ? (
                <FollowingFeed
                    feedQuery={feedQuery}
                    ListHeaderComponent={header}
                    onSwitchToForYou={() => setMode('for-you')}
                />
            ) : (
                <ForYouFeed ListHeaderComponent={header} onSwitchToFollowing={() => setMode('following')} />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
});
