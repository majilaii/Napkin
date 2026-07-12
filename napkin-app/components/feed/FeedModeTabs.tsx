/**
 * FeedModeTabs — two-wide underline toggle for the Feed tab (TICKET-125).
 *
 * For You | Following. Adapted from SearchModeTabs (the locked toggle idiom,
 * decision 2): warm-paper background, upright functional labels, terracotta
 * underline + text on the active tab, and 44pt tap targets.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type FeedMode = 'for-you' | 'following';

const TABS: { mode: FeedMode; label: string }[] = [
    { mode: 'for-you', label: 'For You' },
    { mode: 'following', label: 'Following' },
];

interface Props {
    mode: FeedMode;
    onModeChange: (mode: FeedMode) => void;
}

export function FeedModeTabs({ mode, onModeChange }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View style={[styles.container, { backgroundColor: palette.background }]}>
            {TABS.map((tab) => {
                const isActive = tab.mode === mode;
                return (
                    <Pressable
                        key={tab.mode}
                        onPress={() => onModeChange(tab.mode)}
                        style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: isActive }}
                        accessibilityLabel={tab.label}
                    >
                        <Text
                            style={[
                                styles.label,
                                isActive
                                    ? { color: palette.primary }
                                    : { color: palette.textMuted },
                            ]}
                        >
                            {tab.label}
                        </Text>
                        {isActive && (
                            <View
                                style={[styles.underline, { backgroundColor: palette.primary }]}
                            />
                        )}
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        paddingHorizontal: Spacing.md,
        paddingBottom: Spacing.xs,
    },
    tab: {
        flex: 1,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
    },
    tabPressed: {
        opacity: 0.7,
    },
    label: {
        ...Type.titleMedium,
        lineHeight: 22,
    },
    underline: {
        position: 'absolute',
        bottom: 0,
        left: 8,
        right: 8,
        height: 2,
        borderRadius: 1,
    },
});
