/**
 * FeedSparseTail — TICKET-103, purified in TICKET-125. Closes a thin FOLLOWING
 * feed with a quiet caught-up mark.
 *
 *   ────
 *   you're caught up            ← quiet end mark, not a card
 *
 * Rendered by FollowingFeed's ListFooterComponent when the sparse-tail gate is
 * true (feed reached end-of-list with < 8 rows). A 64pt ghost rule and faint
 * functional label close the ledger without becoming another card. The "Worth
 * a look" DiscoveryLedger that used to sit below it moved to
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
        <View style={styles.wrap}>
            <View style={[styles.rule, { backgroundColor: palette.ghostRule }]} />
            <Text style={[styles.caught, { color: palette.textFaint }]}>you&rsquo;re caught up</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        alignItems: 'center',
        paddingTop: 26,
        paddingBottom: 20,
    },
    rule: {
        width: 64,
        height: StyleSheet.hairlineWidth,
        marginBottom: 10,
    },
    caught: {
        textAlign: 'center',
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
        lineHeight: 18,
    },
});
