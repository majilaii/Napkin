/**
 * PillButton — canonical CTA button.
 *
 * Filled: terracotta background, cream text, 700 wt, 1.5 ls, uppercase (large).
 * Outline: transparent, terracotta border + text.
 * Small variant: normal case, 12pt, 0 ls.
 *
 * Canvas reference: primitives.jsx → PillButton.
 */
import React from 'react';
import { Text, StyleSheet, ViewStyle } from 'react-native';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { PressableScale } from './PressableScale';

interface Props {
    children: string;
    onPress?: () => void;
    filled?: boolean;
    small?: boolean;
    disabled?: boolean;
    /** Make the pill fill its parent's width */
    fullWidth?: boolean;
    style?: ViewStyle;
}

export function PillButton({
    children,
    onPress,
    filled = true,
    small = false,
    disabled = false,
    fullWidth = false,
    style,
}: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const bg = filled ? palette.primary : 'transparent';
    const fg = filled ? palette.textInverse : palette.primary;
    const border = filled ? 'transparent' : palette.primary;

    return (
        <PressableScale
            onPress={onPress}
            disabled={disabled}
            haptic={disabled ? 'none' : 'light'}
            style={[
                styles.base,
                small ? styles.smallBase : styles.largeBase,
                fullWidth ? styles.fullWidth : null,
                {
                    backgroundColor: bg,
                    borderColor: border,
                    opacity: disabled ? 0.5 : 1,
                },
                style,
            ] as ViewStyle[]}
        >
            <Text
                style={[
                    small ? styles.smallText : styles.largeText,
                    { color: fg },
                ]}
            >
                {small ? children : children.toUpperCase()}
            </Text>
        </PressableScale>
    );
}

const styles = StyleSheet.create({
    base: {
        borderRadius: Radius.full,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    largeBase: {
        paddingVertical: 14,
        paddingHorizontal: 28,
    },
    smallBase: {
        paddingVertical: 8,
        paddingHorizontal: 18,
    },
    largeText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 1.5,
    },
    smallText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
    },
    fullWidth: {
        width: '100%',
    },
});

export default PillButton;
