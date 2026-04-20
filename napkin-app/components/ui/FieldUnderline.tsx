/**
 * FieldUnderline — underline-only text input (no fill).
 *
 * Heirloom kit chrome: 1px `ruleInkSoft` resting border-bottom; 2px terracotta
 * when focused. Transparent fill. Used in the composer for the note line, dish
 * field, and anywhere an inline edit replaces a filled rect.
 *
 * Optional UPPERCASE tracked label rendered above (LabelSmall vibe).
 */
import React, { useState, forwardRef } from 'react';
import {
    View,
    TextInput,
    TextInputProps,
    StyleProp,
    ViewStyle,
    TextStyle,
} from 'react-native';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { LabelSmall } from './Label';

interface FieldUnderlineProps extends Omit<TextInputProps, 'style'> {
    /** Optional UPPERCASE tracked label shown above the field */
    label?: string;
    /** Override the input font — defaults to Manrope body.
     *  Pass `serifItalic` to use Newsreader italic (restaurant-name context). */
    fontVariant?: 'sans' | 'serif' | 'serifItalic';
    /** Visual size — 'body' (15px) | 'display' (18/22px serif) */
    size?: 'body' | 'display';
    containerStyle?: StyleProp<ViewStyle>;
    inputStyle?: StyleProp<TextStyle>;
}

export const FieldUnderline = forwardRef<TextInput, FieldUnderlineProps>(
    function FieldUnderline(
        {
            label,
            fontVariant = 'sans',
            size = 'body',
            containerStyle,
            inputStyle,
            onFocus,
            onBlur,
            ...textInputProps
        },
        ref,
    ) {
        const scheme = useColorScheme() ?? 'light';
        const palette = Colors[scheme];
        const [focused, setFocused] = useState(false);

        const fontFamily =
            fontVariant === 'serifItalic'
                ? 'Newsreader_400Regular_Italic'
                : fontVariant === 'serif'
                  ? 'Newsreader_400Regular'
                  : 'Manrope_400Regular';

        const baseFontSize = size === 'display' ? 22 : 15;

        return (
            <View style={containerStyle}>
                {label ? (
                    <LabelSmall color={palette.textSecondary} style={{ marginBottom: Spacing.xs }}>
                        {label}
                    </LabelSmall>
                ) : null}
                <TextInput
                    ref={ref}
                    {...textInputProps}
                    placeholderTextColor={palette.textMuted}
                    onFocus={(e) => {
                        setFocused(true);
                        onFocus?.(e);
                    }}
                    onBlur={(e) => {
                        setFocused(false);
                        onBlur?.(e);
                    }}
                    style={[
                        {
                            backgroundColor: 'transparent',
                            fontFamily,
                            fontSize: baseFontSize,
                            color: palette.text,
                            paddingTop: Spacing.xs,
                            paddingBottom: Spacing.xs + 2,
                            borderBottomWidth: focused ? 2 : 1,
                            borderBottomColor: focused ? palette.primary : palette.ruleInkSoft,
                        },
                        inputStyle,
                    ]}
                />
            </View>
        );
    },
);

