/**
 * Feed tab — Friends / For You modes (TICKET-125, TICKET-220).
 *
 * The tab is a mode orchestrator. It owns the single useFriendsFeed subscription
 * used by Friends and a `mode` state, then swaps between two bodies that share
 * one FeedHeader masthead:
 *
 *   Friends → pure chronological reviews from people you follow, nothing else
 *   For You → the explore surface: socials, people, lists
 *
 * Friends is always the landing mode. For You stays one tap away.
 *
 * Two separate FlatLists (not one union list): Following is keyset-paginated
 * date-sectioned rows; For You is a fixed ~4-block scroll. A mode switch remounts
 * the body (acceptable — no shared scroll position wanted).
 */
import React, { useCallback, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useFriendsFeed } from '@/hooks/feed';
import { FeedHeader, FollowingFeed, ForYouFeed } from '@/components/feed';
import type { FeedMode } from '@/components/feed';

export default function FeedScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const { user } = useAuth();

    // Single subscription for the Friends body.
    const feedQuery = useFriendsFeed(user?.id);
    const [mode, setMode] = useState<FeedMode>('following');

    // Tab screens stay mounted. Reset on every landing so returning to Feed can
    // never preserve a prior For You selection as the apparent default.
    useFocusEffect(
        useCallback(() => {
            setMode('following');
        }, []),
    );

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
                <ForYouFeed ListHeaderComponent={header} />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
});
