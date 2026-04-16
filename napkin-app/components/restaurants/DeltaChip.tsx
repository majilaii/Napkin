/**
 * DeltaChip — small inline indicator comparing the current rating to the
 * previous visit's rating at the same restaurant. Shown next to the Final
 * Average bubble on Round detail.
 *
 * Rules:
 *   - |delta| < 0.1  → muted "— Same"
 *   - delta > 0      → amber "↑ 0.3"
 *   - delta < 0      → olive "↓ 0.2"
 *
 * Renders nothing if `previous` is null.
 */
import React from 'react';
import { Text, View } from 'react-native';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Palette = typeof Colors.light;

interface Props {
    current: number;
    previous: number | null;
}

export function DeltaChip({ current, previous }: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;

    if (previous == null) return null;

    const delta = current - previous;
    const abs = Math.abs(delta);

    let label: string;
    let color: string;
    let background: string;

    if (abs < 0.1) {
        label = '— Same';
        color = palette.textMuted;
        background = palette.surfaceContainerLow;
    } else if (delta > 0) {
        label = `↑ ${abs.toFixed(1)}`;
        color = palette.tertiary;
        background = palette.tertiaryFixed;
    } else {
        label = `↓ ${abs.toFixed(1)}`;
        color = palette.textSecondary;
        background = palette.secondaryContainer;
    }

    return (
        <View
            style={{
                paddingHorizontal: Spacing.sm,
                paddingVertical: 4,
                borderRadius: Radius.full,
                backgroundColor: background,
                alignSelf: 'center',
                marginTop: Spacing.sm,
            }}
        >
            <Text
                style={[
                    Type.labelSmall,
                    { color, letterSpacing: 1, textTransform: 'none' },
                ]}
            >
                {label} from last visit
            </Text>
        </View>
    );
}
