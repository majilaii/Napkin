/**
 * RestaurantTabs — 3-tab row below the hero: Our Table / Everyone / Info.
 *
 * Heirloom kit: Manrope 11px bold uppercase tracked. Active tab is terracotta
 * text + a 2px terracotta underline that overlaps the hairline border below
 * the bar. Resting tabs read textMuted.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type RestaurantTab = 'our-table' | 'critics' | 'info';

interface Props {
    active: RestaurantTab;
    onChange: (tab: RestaurantTab) => void;
}

const ITEMS: { key: RestaurantTab; label: string }[] = [
    { key: 'our-table', label: 'Our Table' },
    { key: 'critics', label: 'Everyone' },
    { key: 'info', label: 'Info' },
];

export function RestaurantTabs({ active, onChange }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View style={[styles.row, { borderBottomColor: 'rgba(28,28,25,0.08)' }]}>
            {ITEMS.map((t) => {
                const isActive = t.key === active;
                return (
                    <Pressable
                        key={t.key}
                        onPress={() => onChange(t.key)}
                        hitSlop={6}
                        style={({ pressed }) => [
                            styles.item,
                            {
                                borderBottomColor: isActive
                                    ? palette.primary
                                    : 'transparent',
                                opacity: pressed ? 0.7 : 1,
                            },
                        ]}
                    >
                        <Text
                            style={[
                                styles.label,
                                {
                                    color: isActive ? palette.primary : palette.textMuted,
                                },
                            ]}
                        >
                            {t.label}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        gap: 20,
        paddingHorizontal: 22,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    item: {
        paddingTop: 14,
        paddingBottom: 12,
        borderBottomWidth: 2,
        marginBottom: -StyleSheet.hairlineWidth,
    },
    label: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 1,
        textTransform: 'uppercase',
    },
});

