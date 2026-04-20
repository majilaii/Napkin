/**
 * Label / LabelSmall — UPPERCASE tracked section labels.
 *
 * Heirloom Journal kit: Manrope 700, 11px (Label) or 600, 9px (LabelSmall),
 * letter-spacing 1.5–2.2px, textTransform uppercase. Default color reads from
 * the current scheme's textSecondary (Label) / textMuted (LabelSmall).
 */
import React from 'react';
import { Text, TextStyle, StyleProp } from 'react-native';

import { Colors, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface LabelProps {
    children: React.ReactNode;
    color?: string;
    style?: StyleProp<TextStyle>;
    numberOfLines?: number;
}

export function Label({ children, color, style, numberOfLines }: LabelProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    return (
        <Text
            style={[Type.label, { color: color ?? palette.textSecondary }, style]}
            numberOfLines={numberOfLines}
        >
            {children}
        </Text>
    );
}

export function LabelSmall({ children, color, style, numberOfLines }: LabelProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    return (
        <Text
            style={[Type.labelSmall, { color: color ?? palette.textMuted }, style]}
            numberOfLines={numberOfLines}
        >
            {children}
        </Text>
    );
}
