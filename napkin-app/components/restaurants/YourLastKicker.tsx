/**
 * YourLastKicker — italic serif kicker above the Visits stream.
 *
 * "your last — Apr 14, rated 4.5. you're due another."
 * Only rendered when the user has logged this restaurant at least once.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    date: string | null;           // ISO date string
    rating: number | null;
}

type Palette = typeof Colors.light;

function formatDate(iso: string | null): string {
    if (!iso) return 'no date';
    try {
        const d = new Date(iso);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
        return iso;
    }
}

export function YourLastKicker({ date, rating }: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;

    const formattedDate = formatDate(date);
    const ratingStr = rating != null ? rating.toFixed(1) : null;

    return (
        <View
            style={[
                styles.wrap,
                { borderLeftColor: palette.primaryContainer },
            ]}
        >
            <Text style={[styles.text, { color: palette.textMuted }]}>
                {'your last — '}
                <Text style={[styles.bold, { color: palette.textSecondary }]}>
                    {formattedDate}
                </Text>
                {ratingStr ? (
                    <>
                        {', rated '}
                        <Text style={[styles.rating, { color: palette.primary }]}>
                            {ratingStr}
                        </Text>
                    </>
                ) : null}
                {". you're due another."}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        marginHorizontal: 22,
        marginTop: 16,
        borderLeftWidth: 2,
        paddingLeft: 12,
        paddingVertical: 2,
    },
    text: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
    },
    bold: {
        fontFamily: 'Newsreader_600SemiBold',
        fontStyle: 'normal',
    },
    rating: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
    },
});
