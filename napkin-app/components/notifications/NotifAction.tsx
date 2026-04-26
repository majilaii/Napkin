/**
 * NotifAction — small pill action button used as a trailing affordance
 * on rows that need a one-tap response (Join, Claim, Log).
 *
 * Variants:
 *  filled   — terracotta or ink, white text
 *  outlined — ink border on warm paper
 */
import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Variant = 'filledPrimary' | 'filledInk' | 'outlined';

interface Props {
    label: string;
    variant?: Variant;
    onPress?: () => void;
}

export function NotifAction({ label, variant = 'outlined', onPress }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const bg =
        variant === 'filledPrimary'
            ? palette.primary
            : variant === 'filledInk'
                ? palette.text
                : 'transparent';
    const color =
        variant === 'filledPrimary' || variant === 'filledInk'
            ? palette.textInverse
            : palette.text;
    const borderColor = variant === 'outlined' ? palette.text : 'transparent';

    return (
        <Pressable
            onPress={onPress}
            hitSlop={6}
            style={({ pressed }) => [
                styles.pill,
                {
                    backgroundColor: bg,
                    borderColor,
                    borderWidth: variant === 'outlined' ? 1 : 0,
                    opacity: pressed ? 0.85 : 1,
                },
            ]}
        >
            <Text style={[styles.label, { color }]}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    pill: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 9999,
    },
    label: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11,
        letterSpacing: 0.3,
    },
});
