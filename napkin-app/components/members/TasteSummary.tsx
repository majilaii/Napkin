/**
 * TasteSummary — concise taste summary in Napkin's upright editorial voice.
 * Pre-built via buildTasteSummary(); this component is purely presentational.
 */
import React from 'react';
import { Text } from 'react-native';
import { Type, Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface TasteSummaryProps {
    summary: string;
}

export function TasteSummary({ summary }: TasteSummaryProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <Text
            style={[
                Type.editorialBody,
                { color: palette.textSecondary },
            ]}
            maxFontSizeMultiplier={2}
        >
            {summary}
        </Text>
    );
}
