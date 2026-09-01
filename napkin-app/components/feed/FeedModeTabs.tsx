/**
 * FeedModeTabs — two-wide underline toggle for the Feed tab (TICKET-125).
 *
 * Friends | For You. Intrinsic-width labels mirror the approved masthead:
 * active ink, terracotta underline, a ghosted rule, and 44pt tap targets.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type FeedMode = 'for-you' | 'following';

const TABS: { mode: FeedMode; label: string }[] = [
    { mode: 'following', label: 'Friends' },
    { mode: 'for-you', label: 'For You' },
];

interface Props {
    mode: FeedMode;
    onModeChange: (mode: FeedMode) => void;
}

export function FeedModeTabs({ mode, onModeChange }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View
            style={[
                styles.container,
                { backgroundColor: palette.background, borderBottomColor: palette.ghostRule },
            ]}
        >
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
                                    ? { color: palette.text }
                                    : { color: palette.textFaint },
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
        gap: 22,
        marginHorizontal: 20,
        marginTop: -5,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    tab: {
        minWidth: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingBottom: 9,
        position: 'relative',
    },
    tabPressed: {
        opacity: 0.7,
    },
    label: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
        fontWeight: '600',
        lineHeight: 18,
        letterSpacing: 0.26,
    },
    underline: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 2,
        borderRadius: 1,
    },
});
