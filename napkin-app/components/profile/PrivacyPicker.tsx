/**
 * PrivacyPicker — visual 3-way segmented control (Public / Friends / Private).
 * TICKET-025
 *
 * Used inside /settings/privacy. The current selection reflects the master
 * account-level toggle — no per-section mutations. Picker is read-only visual
 * affordance except when `onSelect` is provided (only the master toggle row
 * passes onSelect).
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { Colors, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type PrivacyState = 'public' | 'friends' | 'private';

interface Props {
    state: PrivacyState;
    /** If provided, tapping a segment calls this. Otherwise the picker is read-only. */
    onSelect?: (value: PrivacyState) => void;
    disabled?: boolean;
}

const OPTIONS: { id: PrivacyState; label: string }[] = [
    { id: 'public', label: 'Public' },
    { id: 'friends', label: 'Friends' },
    { id: 'private', label: 'Private' },
];

export function PrivacyPicker({ state, onSelect, disabled = false }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View
            style={[
                styles.container,
                {
                    backgroundColor: palette.surfaceContainerLow,
                    borderColor: palette.outlineVariant,
                    opacity: disabled ? 0.5 : 1,
                },
            ]}
        >
            {OPTIONS.map((o, i) => {
                const isActive = o.id === state;
                return (
                    <Pressable
                        key={o.id}
                        onPress={() => onSelect?.(o.id)}
                        disabled={!onSelect || disabled}
                        style={[
                            styles.segment,
                            i < OPTIONS.length - 1 && [styles.segmentBorder, { borderRightColor: palette.outlineVariant }],
                            isActive && { backgroundColor: palette.text },
                        ]}
                    >
                        <Text
                            style={[
                                Type.caption,
                                {
                                    fontSize: 10,
                                    letterSpacing: 0.3,
                                    color: isActive ? '#fff' : palette.textMuted,
                                    fontWeight: isActive ? '600' : '400',
                                },
                            ]}
                        >
                            {o.label}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        borderRadius: Radius.sm,
        borderWidth: 1,
        overflow: 'hidden',
    },
    segment: {
        paddingHorizontal: 9,
        paddingVertical: 5,
    },
    segmentBorder: {
        borderRightWidth: 1,
    },
});
