/**
 * FeedHeader — the shared Feed masthead + mode tabs (TICKET-125; type fixed
 * TICKET-189).
 *
 *   [WEDNESDAY · JULY 16 — quiet device-date dateline]
 *   [Manrope "Feed" — 26pt]
 *   [For You | Following]
 *
 * The masthead is functional chrome, so it stays upright Manrope. It renders as
 * the ListHeaderComponent of both bodies so the hierarchy remains continuous
 * across a mode switch.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { FeedModeTabs, type FeedMode } from './FeedModeTabs';
import { feedMastheadDate } from './feedDates';

interface Props {
    mode: FeedMode;
    onModeChange: (mode: FeedMode) => void;
}

export function FeedHeader({ mode, onModeChange }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();

    return (
        <View>
            <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
                <Text style={[styles.dateline, { color: palette.textFaint }]}>
                    {feedMastheadDate()}
                </Text>
                <Text style={[styles.title, { color: palette.text }]}>Feed</Text>
            </View>
            <FeedModeTabs mode={mode} onModeChange={onModeChange} />
        </View>
    );
}

const styles = StyleSheet.create({
    header: {
        paddingHorizontal: 20,
    },
    dateline: {
        ...Type.dateline,
        marginBottom: 2,
    },
    title: {
        ...Type.feedTitle,
    },
});
