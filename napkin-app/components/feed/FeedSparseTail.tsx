/**
 * FeedSparseTail — TICKET-103, purified in TICKET-125. Closes a thin FOLLOWING
 * feed with a quiet caught-up mark.
 *
 *   · you're caught up ·        ← typographic mark, not a card
 *
 * Rendered by FollowingFeed's ListFooterComponent when the sparse-tail gate is
 * true (feed reached end-of-list with < 8 rows). The caught-up mark is a quiet
 * italic murmur — no background, no chrome — per the "space does the sectioning"
 * rule. The "Worth a look" DiscoveryLedger that used to sit below it moved to
 * the For You mode (TICKET-125) — Following is now pure follows, nothing else.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function FeedSparseTail() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View>
            <Text style={[styles.caught, { color: palette.textMuted }]}>· you&rsquo;re caught up ·</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    caught: {
        textAlign: 'center',
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
        marginTop: 30,
        marginBottom: 26,
    },
});
