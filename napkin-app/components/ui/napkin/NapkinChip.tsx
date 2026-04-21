/**
 * Chip — inline pill or rect chip used for categories, counts, badges.
 *
 * Two shapes:
 *   rect (default): 4px radius, uppercase 10pt 0.25 ls, 3/9 padding
 *   pill:           9999 radius, 12pt 0 ls normal case, 6/14 padding
 *
 * Color presets map to palette tokens. Supply custom colors for one-off accents.
 * Canvas reference: primitives.jsx → Chip.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Tone = 'amber' | 'olive' | 'sanguine' | 'ink' | 'custom';

interface Props {
    children: string;
    tone?: Tone;
    pill?: boolean;
    backgroundColor?: string;
    color?: string;
}

export function NapkinChip({
    children,
    tone = 'amber',
    pill = false,
    backgroundColor,
    color,
}: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    let bg = backgroundColor;
    let fg = color;
    if (!bg || !fg) {
        switch (tone) {
            case 'olive':
                bg = bg ?? palette.oliveCream;
                fg = fg ?? palette.secondary;
                break;
            case 'sanguine':
                bg = bg ?? palette.sanguine;
                fg = fg ?? palette.textInverse;
                break;
            case 'ink':
                bg = bg ?? palette.text;
                fg = fg ?? palette.textInverse;
                break;
            case 'custom':
                bg = bg ?? 'transparent';
                fg = fg ?? palette.text;
                break;
            case 'amber':
            default:
                bg = bg ?? palette.tertiaryFixed;
                fg = fg ?? palette.amberOnCream;
                break;
        }
    }

    return (
        <View
            style={[
                styles.base,
                pill ? styles.pill : styles.rect,
                { backgroundColor: bg },
            ]}
        >
            <Text style={[pill ? styles.pillText : styles.rectText, { color: fg }]}>
                {children}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    base: {
        alignSelf: 'flex-start',
    },
    rect: {
        paddingHorizontal: 9,
        paddingVertical: 3,
        borderRadius: Radius.sm,
    },
    pill: {
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: Radius.full,
    },
    rectText: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 10,
        letterSpacing: 0.25,
        textTransform: 'uppercase',
    },
    pillText: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
});

export default NapkinChip;
