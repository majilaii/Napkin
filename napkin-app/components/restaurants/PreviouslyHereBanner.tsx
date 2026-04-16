/**
 * "Previously here" banner.
 *
 * Shown on Round detail (table-scoped) and Entry detail (user-scoped).
 * Renders a one-line memory: count of prior visits + last visit's rating + date.
 * Tap opens the restaurant screen in the current Table context.
 *
 * Intentionally quiet: surfaceContainerLow background, italic body line, a single
 * chevron on the right. No solid borders. Don't render at all if there's no
 * history (zero prior visits).
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Palette = typeof Colors.light;

interface Props {
    /** Number of prior visits (excluding the one being viewed). */
    visitCount: number;
    /** Rating of the most recent prior visit, if any. */
    lastRating: number | null;
    /** ISO string date of the most recent prior visit, if any. */
    lastDate: string | null;
    /** Voice: "You've been here" (user-scoped) vs "The table has been here" (round-scoped). */
    voice: 'user' | 'table';
    /** Called when the banner is tapped — navigate to restaurant screen. */
    onPress?: () => void;
}

function formatShortDate(iso: string): string {
    try {
        const d = new Date(iso);
        return d.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        });
    } catch {
        return '';
    }
}

export function PreviouslyHereBanner({
    visitCount,
    lastRating,
    lastDate,
    voice,
    onPress,
}: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;

    if (visitCount <= 0) return null;

    const subject = voice === 'user' ? 'You' : 'The table';
    const visitPlural = visitCount === 1 ? 'time' : 'times';
    const countLine =
        voice === 'user'
            ? `${subject}'ve been here ${visitCount} ${visitPlural} before`
            : `${subject} has been here ${visitCount} ${visitPlural} before`;

    const subLineParts: string[] = [];
    if (lastDate) subLineParts.push(`last: ${formatShortDate(lastDate)}`);
    if (lastRating != null) subLineParts.push(`${lastRating.toFixed(1)}`);
    const subLine = subLineParts.join(' · ');

    return (
        <Pressable
            onPress={onPress}
            disabled={!onPress}
            style={({ pressed }) => ({
                marginHorizontal: Spacing.lg,
                marginTop: Spacing.md,
                paddingHorizontal: Spacing.md,
                paddingVertical: Spacing.md,
                borderRadius: Radius.md,
                flexDirection: 'row',
                alignItems: 'center',
                gap: Spacing.sm,
                backgroundColor: palette.surfaceContainerLow,
                opacity: pressed && onPress ? 0.7 : 1,
            })}
        >
            <View style={{ flex: 1 }}>
                <Text
                    style={[
                        Type.labelSmall,
                        {
                            color: palette.textSecondary,
                            letterSpacing: 1.5,
                        },
                    ]}
                >
                    Previously here
                </Text>
                <Text
                    style={[
                        Type.body,
                        {
                            color: palette.text,
                            marginTop: 2,
                            fontFamily: 'Newsreader_400Regular_Italic',
                        },
                    ]}
                >
                    {countLine}
                </Text>
                {subLine ? (
                    <Text
                        style={[
                            Type.bodySmall,
                            { color: palette.textMuted, marginTop: 2 },
                        ]}
                    >
                        {subLine}
                    </Text>
                ) : null}
            </View>
            {onPress ? (
                <Text style={[Type.body, { color: palette.textSecondary }]}>›</Text>
            ) : null}
        </Pressable>
    );
}
