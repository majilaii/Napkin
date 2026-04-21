/**
 * FloatingLogButton — variant C from logging-entry-canvas.
 *
 * Small terracotta pill pinned bottom-right. Ambient shadow. Label flips to
 * "Log again" once the user has logged this place at least once. No secondary
 * actions live on the pill itself — tapping opens a 3-option sheet.
 */
import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Palette = typeof Colors.light;

interface Props {
    loggedBefore: boolean;
    onPress: () => void;
    disabled?: boolean;
}

const CREAM = Colors.light.cream;

export function FloatingLogButton({ loggedBefore, onPress, disabled }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;
    const insets = useSafeAreaInsets();

    const label = loggedBefore ? 'Log again' : 'Log';

    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            hitSlop={6}
            style={({ pressed }) => [
                styles.pill,
                {
                    bottom: Math.max(insets.bottom, 14) + 14,
                    backgroundColor: pressed ? palette.primaryContainer : palette.primary,
                    opacity: disabled ? 0.5 : 1,
                    shadowColor: palette.primary,
                },
            ]}
        >
            <Text style={[styles.plus, { color: CREAM }]}>+</Text>
            <Text style={[styles.label, { color: CREAM }]}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    pill: {
        position: 'absolute',
        right: 18,
        paddingVertical: 13,
        paddingHorizontal: 22,
        borderRadius: 999,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.35,
        shadowRadius: 28,
        elevation: 8,
    },
    plus: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 16,
        lineHeight: 18,
    },
    label: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 12,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
    },
});
