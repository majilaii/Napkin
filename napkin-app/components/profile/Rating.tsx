/**
 * Rating — inline serif italic N.N + muted /5.
 * TICKET-025
 *
 * Matches the canvas: serif italic value + muted " / 5" suffix.
 * Used inside TopFour badges, DiaryRow.
 */
import React from 'react';
import { Text } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    value: number;
    size?: number;
}

export function Rating({ value, size = 11 }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <Text
            style={{
                fontFamily: 'Newsreader_400Regular_Italic',
                fontSize: size,
                lineHeight: size * 1.3,
                color: palette.text,
            }}
        >
            {value.toFixed(1)}
            <Text style={{ color: palette.textMuted }}>{' / 5'}</Text>
        </Text>
    );
}
