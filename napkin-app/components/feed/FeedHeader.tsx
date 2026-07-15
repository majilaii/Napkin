/**
 * FeedHeader — the shared Feed masthead + mode tabs (TICKET-125; type fixed
 * TICKET-189).
 *
 *   [Manrope "Feed" — Type.screenTitle]
 *   [For You | Following]   ← only once mode is resolved
 *
 * The masthead is functional chrome, so it reads in `Type.screenTitle`
 * (Manrope 700 — locked 2026-07-10); the old hardcoded italic-serif 26pt
 * predated the lock. Rendered as the ListHeaderComponent of BOTH bodies (For
 * You and Following) so the masthead reads continuous across a mode switch.
 * While `mode === null` (the default is still resolving off the first
 * friends-feed page) the tabs are withheld — this is the anti-flicker
 * mechanism: tabs never paint in a provisional active state.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { FeedModeTabs, type FeedMode } from './FeedModeTabs';

interface Props {
    /** null → still resolving the default; render masthead only (no tabs). */
    mode: FeedMode | null;
    onModeChange: (mode: FeedMode) => void;
}

export function FeedHeader({ mode, onModeChange }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();

    return (
        <View>
            <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
                <Text style={[styles.title, { color: palette.text }]}>Feed</Text>
            </View>
            {mode !== null && <FeedModeTabs mode={mode} onModeChange={onModeChange} />}
        </View>
    );
}

const styles = StyleSheet.create({
    header: {
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.sm,
    },
    title: {
        ...Type.screenTitle,
        paddingTop: Spacing.sm,
    },
});
