/**
 * NotifGlyph — leading round badge for non-person notifications.
 * Used for the Claim-a-city nudge (amber, italic-serif numeral)
 * and the reservation reminder (olive, pencil glyph).
 */
import React, { type ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Tone = 'amber' | 'olive';

interface Props {
    tone: Tone;
    /** Either a number (claim count) or a single glyph character (e.g. ✎ for reservation). */
    children: ReactNode;
    size?: number;
}

export function NotifGlyph({ tone, children, size = 32 }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const bg = tone === 'amber' ? palette.tertiaryFixed : palette.oliveCream;
    const fg = tone === 'amber' ? palette.amberInk : palette.secondary;
    const isNumber = typeof children === 'number' || (typeof children === 'string' && /^\d+$/.test(children));
    const fontSize = isNumber ? Math.round(size * 0.46) : Math.round(size * 0.44);

    return (
        <View
            style={[
                styles.wrap,
                {
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    backgroundColor: bg,
                },
            ]}
        >
            <Text
                style={[
                    isNumber ? styles.numeral : styles.glyph,
                    { color: fg, fontSize },
                ]}
            >
                {children}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    numeral: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontStyle: 'italic',
        fontWeight: '600',
    },
    glyph: {
        fontFamily: 'Newsreader_400Regular',
    },
});
