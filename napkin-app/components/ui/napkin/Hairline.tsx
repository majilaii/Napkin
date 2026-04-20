/**
 * Hairline — 1px pale-rose rule used to separate sections and blocks.
 *
 * Default color: --rule-warm-soft (palette.dividerSoft).
 * Canvas reference: profile-canvas.jsx → Hairline; primitives.jsx → HairlineRule.
 */
import React from 'react';
import { View } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    /** Horizontal inset in px. Canvas default: 22 */
    inset?: number;
    /** "warm" (default, dividerSoft), "nib" (ruleWarmNib, opaque), "ink" (ruleInkSoft) */
    tone?: 'warm' | 'nib' | 'ink';
}

export function Hairline({ inset = 22, tone = 'warm' }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const color =
        tone === 'nib'
            ? palette.ruleWarmNib
            : tone === 'ink'
                ? palette.ruleInkSoft
                : palette.dividerSoft;

    return (
        <View
            style={{
                height: 1,
                marginHorizontal: inset,
                backgroundColor: color,
            }}
        />
    );
}

export default Hairline;
