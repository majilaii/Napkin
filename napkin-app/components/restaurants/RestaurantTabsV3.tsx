/**
 * RestaurantTabsV3 — 3-tab row for restaurant page v3: Visits / Photos / Info.
 *
 * Replaces the old Our Table / Everyone / Info tabs. Signal strip + tabs
 * persist on all three screens. Active tab: terracotta text + 2px underline.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type RestaurantTabV3 = 'visits' | 'photos' | 'info';

interface Props {
    active: RestaurantTabV3;
    onChange: (tab: RestaurantTabV3) => void;
}

const ITEMS: { key: RestaurantTabV3; label: string }[] = [
    { key: 'visits', label: 'Visits' },
    { key: 'photos', label: 'Photos' },
    { key: 'info', label: 'Info' },
];

const DIVIDER_COLOR = 'rgba(138, 114, 108, 0.3)';

export function RestaurantTabsV3({ active, onChange }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View style={[styles.row, { borderBottomColor: DIVIDER_COLOR }]}>
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
                                borderBottomColor: isActive ? palette.primary : 'transparent',
                                opacity: pressed ? 0.7 : 1,
                            },
                        ]}
                    >
                        <Text
                            style={[
                                styles.label,
                                { color: isActive ? palette.text : palette.textMuted },
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
        paddingHorizontal: 22,
        borderBottomWidth: 1,
        marginTop: 18,
    },
    item: {
        flex: 1,
        alignItems: 'center',
        paddingTop: 13,
        paddingBottom: 11,
        borderBottomWidth: 2,
        marginBottom: -1,
    },
    label: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 1.6,
        textTransform: 'uppercase',
    },
});
