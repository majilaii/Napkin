/**
 * VisitListRow — a single row on the restaurant screen representing one
 * visit (either a Round or a solo entry). Tap to navigate to that visit's
 * detail screen.
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { Visit } from '@/hooks/restaurants/useRestaurantHistory';

type Palette = typeof Colors.light;

interface Props {
    visit: Visit;
    onPress?: () => void;
}

function formatLongDate(iso: string): string {
    try {
        const d = new Date(iso);
        return d.toLocaleDateString(undefined, {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
        });
    } catch {
        return '';
    }
}

export function VisitListRow({ visit, onPress }: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;

    const kindLabel = visit.kind === 'round' ? 'Round' : 'Solo visit';
    const whoLine =
        visit.user_display_names.length > 0
            ? visit.user_display_names.slice(0, 3).join(', ') +
              (visit.user_display_names.length > 3
                  ? ` + ${visit.user_display_names.length - 3}`
                  : '')
            : null;

    return (
        <Pressable
            onPress={onPress}
            disabled={!onPress}
            style={({ pressed }) => ({
                paddingHorizontal: Spacing.md,
                paddingVertical: Spacing.md,
                borderRadius: Radius.lg,
                backgroundColor: palette.surfaceContainerLow,
                flexDirection: 'row',
                alignItems: 'center',
                gap: Spacing.md,
                opacity: pressed && onPress ? 0.7 : 1,
            })}
        >
            <View style={{ flex: 1 }}>
                <Text style={[Type.labelSmall, { color: palette.textMuted }]}>
                    {kindLabel.toUpperCase()} · {formatLongDate(visit.date)}
                </Text>
                {whoLine ? (
                    <Text
                        style={[
                            Type.body,
                            {
                                color: palette.text,
                                marginTop: 4,
                                fontFamily: 'Newsreader_400Regular_Italic',
                            },
                        ]}
                    >
                        {whoLine}
                    </Text>
                ) : null}
            </View>
            {visit.rating != null ? (
                <View
                    style={{
                        paddingHorizontal: Spacing.md,
                        paddingVertical: Spacing.xs,
                        borderRadius: Radius.full,
                        backgroundColor: palette.tertiaryFixed,
                        minWidth: 56,
                        alignItems: 'center',
                    }}
                >
                    <Text
                        style={[
                            Type.rating,
                            {
                                color: palette.tertiary,
                                fontSize: 18,
                                lineHeight: 22,
                            },
                        ]}
                    >
                        {visit.rating.toFixed(1)}
                    </Text>
                </View>
            ) : null}
            {onPress ? (
                <Text style={[Type.body, { color: palette.textSecondary }]}>›</Text>
            ) : null}
        </Pressable>
    );
}
