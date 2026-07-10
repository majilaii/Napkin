/**
 * SearchModeTabs — two-wide pill segmented control for Places | People.
 * TICKET-028
 *
 * Design: warm paper background, italic Newsreader labels,
 * selected = terracotta underline + text, unselected = textMuted.
 * 44pt tap target per HIG.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { visibleSearchTabs, type SearchMode } from './searchModeTabsGate';

export type { SearchMode };

interface Props {
    mode: SearchMode;
    onModeChange: (mode: SearchMode) => void;
    /** TICKET-106: People is curtained under FRIEND_TEST.hidePeopleSearch, but the
     *  Lists tab must render regardless. Pass true to drop the People tab. */
    hidePeople?: boolean;
}

export function SearchModeTabs({ mode, onModeChange, hidePeople = false }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const tabs = visibleSearchTabs(hidePeople);

    return (
        <View style={[styles.container, { backgroundColor: palette.background }]}>
            {tabs.map((tab) => {
                const isActive = tab.mode === mode;
                return (
                    <Pressable
                        key={tab.mode}
                        onPress={() => onModeChange(tab.mode)}
                        style={({ pressed }) => [
                            styles.tab,
                            pressed && styles.tabPressed,
                        ]}
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
                                style={[
                                    styles.underline,
                                    { backgroundColor: palette.primary },
                                ]}
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
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 16,
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
