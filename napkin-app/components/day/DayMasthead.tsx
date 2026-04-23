/**
 * DayMasthead — day-page header.
 * Italic Newsreader date + subtitle copy.
 *
 * Q7 decision: use quieter "today" alone for today; "anything you forgot?" for past days.
 * Wireframe C1/C2 grammar.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatDayLabel } from '@/lib/mealSlots';

interface Props {
    dateStr: string; // YYYY-MM-DD
}

function formatKicker(dateStr: string): string {
    const [year, month, day] = dateStr.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    const monthName = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    return `${monthName} ${day}`;
}

export function DayMasthead({ dateStr }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const { primary, isToday } = formatDayLabel(dateStr);

    // Q7: quiet "today" alone for today; past days get an "anything you forgot?" nudge.
    const subtitle = isToday ? null : 'anything you forgot?';

    return (
        <View style={styles.container}>
            {!isToday ? (
                <Text style={[styles.kicker, { color: palette.primary }]}>
                    {formatKicker(dateStr)}
                </Text>
            ) : null}
            <Text style={[styles.dateLabel, { color: palette.text }]}>
                {primary}
            </Text>
            {subtitle ? (
                <Text style={[styles.subtitle, { color: palette.textMuted }]}>
                    {subtitle}
                </Text>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        alignItems: 'center',
        paddingVertical: Spacing.lg,
    },
    kicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 2.4,
        textTransform: 'uppercase',
        marginBottom: 8,
    },
    dateLabel: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 26,
        fontWeight: '400',
        lineHeight: 30,
    },
    subtitle: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 12,
        marginTop: 6,
    },
});
