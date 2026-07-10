/**
 * SectionKicker — TICKET-130. The one shared "big kicker" header every For You
 * section uses (Gazette mix): Newsreader italic ~19, sentence case, on-surface
 * ink. Replaces ALL the 9px uppercase micro-labels in For You — zero remain.
 * Editorial section titles are a brand moment, so italic serif is correct here
 * (founder-locked in the 2026-07-07 workshop). Following/FriendFeedCard are
 * untouched — this is For You grammar only.
 */
import React from 'react';
import { Text, StyleSheet } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function SectionKicker({ children }: { children: React.ReactNode }) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return <Text style={[styles.kicker, { color: palette.text }]}>{children}</Text>;
}

const styles = StyleSheet.create({
    kicker: {
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 19,
        lineHeight: 24,
        paddingHorizontal: Spacing.lg,
        marginTop: 22,
        marginBottom: 10,
    },
});
