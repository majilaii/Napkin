/**
 * TableSegments — the Table tab's pane switcher (TICKET-238).
 *
 * `activity · lists`. Wishlist retired: the Table's saved places live in
 * Places under the table scope (TICKET-237). Lists is social-only — a personal
 * table shows `activity` alone.
 *
 * One segment control across the app: the SearchModeTabs grammar — lowercase
 * labels, Manrope 600 15/20, terracotta ink + terracotta underline when active,
 * muted when not, over a ghosted warm rule.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';

type Palette = typeof Colors.light;

export type TableSegment = 'activity' | 'lists' | 'atlas';

export interface TableSegmentsProps {
    active: TableSegment;
    onChange: (segment: TableSegment) => void;
    /** Lists exists on social tables only; personal tables get `activity` alone. */
    showLists?: boolean;
    /** Atlas stays flag-hidden — passed through untouched by TICKET-238. */
    showAtlas?: boolean;
    palette: Palette;
}

const LABELS: Record<TableSegment, string> = {
    activity: 'activity',
    lists: 'lists',
    atlas: 'atlas',
};

export function TableSegments({
    active,
    onChange,
    showLists = false,
    showAtlas = false,
    palette,
}: TableSegmentsProps) {
    const segments: TableSegment[] = [
        'activity',
        ...(showLists ? (['lists'] as const) : []),
        ...(showAtlas ? (['atlas'] as const) : []),
    ];

    return (
        <View style={[styles.container, { borderBottomColor: palette.ghostRule }]}>
            {segments.map((segment) => {
                const isActive = segment === active;
                return (
                    <Pressable
                        key={segment}
                        onPress={() => onChange(segment)}
                        style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: isActive }}
                        accessibilityLabel={LABELS[segment]}
                    >
                        <Text
                            style={[
                                styles.label,
                                { color: isActive ? palette.primary : palette.textMuted },
                            ]}
                        >
                            {LABELS[segment]}
                        </Text>
                        {isActive && (
                            <View style={[styles.underline, { backgroundColor: palette.primary }]} />
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
        gap: Spacing.lg,
        marginHorizontal: Spacing.pageGutter,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    tab: {
        minWidth: Spacing.hitTarget,
        height: Spacing.hitTarget,
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingBottom: Spacing.sm + 2,
        position: 'relative',
    },
    tabPressed: {
        opacity: 0.7,
    },
    label: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 15,
        fontWeight: '600',
        lineHeight: 20,
    },
    underline: {
        position: 'absolute',
        bottom: 0,
        left: 10,
        right: 10,
        height: 2,
        borderRadius: 1,
    },
});
