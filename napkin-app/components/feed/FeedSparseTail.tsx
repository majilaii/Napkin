/**
 * FeedSparseTail — TICKET-103. Closes a thin friends feed and licenses the
 * discovery ledger below it.
 *
 *   · you're caught up ·        ← typographic mark, not a card
 *   Worth a look                ← DiscoveryLedger
 *   01  Kono           4.7 …
 *
 * Rendered by feed.tsx's ListFooterComponent when the sparse-tail gate is true
 * (feed reached end-of-list with < 8 rows). The caught-up mark is a quiet
 * italic murmur — no background, no chrome — per the "space does the sectioning"
 * rule; the ledger reuses the identical component from the empty states.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { DiscoveryLedger } from './DiscoveryLedger';

export function FeedSparseTail() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View>
            <Text style={[styles.caught, { color: palette.textMuted }]}>· you&rsquo;re caught up ·</Text>
            <DiscoveryLedger />
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
