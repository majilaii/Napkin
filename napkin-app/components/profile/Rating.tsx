/**
 * Rating — compact inline rating number + upright muted / 5 suffix.
 * TICKET-025
 *
 * Italic is deliberate here: ratings are one of the design language's scarce
 * accent roles. Used by DiaryRow.
 */
import React from 'react';
import { Text } from 'react-native';

import { Colors, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    value: number;
}

export function Rating({ value }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <Text style={[Type.metadata, { color: palette.textMuted }]}>
            <Text style={[Type.ratingCompact, { color: palette.text }]}>
                {value.toFixed(1)}
            </Text>
            {' / 5'}
        </Text>
    );
}
