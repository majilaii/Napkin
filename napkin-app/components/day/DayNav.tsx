/**
 * DayNav — left/right day navigation with day labels.
 * Disables right/forward on today; disables left at day-30 cap.
 * Wireframe C1/C2 grammar.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getTodayDateStr, formatDayLabel, localDateStr } from '@/lib/mealSlots';

const MAX_DAYS_BACK = 30;

interface Props {
    dateStr: string; // YYYY-MM-DD
    onNavigate: (dateStr: string) => void;
}

function offsetDate(dateStr: string, days: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + days);
    return localDateStr(date);
}

function daysDiff(a: string, b: string): number {
    const [ay, am, ad] = a.split('-').map(Number);
    const [by, bm, bd] = b.split('-').map(Number);
    const da = new Date(ay, am - 1, ad).getTime();
    const db = new Date(by, bm - 1, bd).getTime();
    return Math.round((db - da) / (1000 * 60 * 60 * 24));
}

export function DayNav({ dateStr, onNavigate }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const today = getTodayDateStr();
    const isToday = dateStr === today;
    const daysBack = daysDiff(dateStr, today); // how many days before today
    const atCap = daysBack >= MAX_DAYS_BACK;

    const prev = offsetDate(dateStr, -1);
    const next = offsetDate(dateStr, 1);

    const { primary: prevLabel } = formatDayLabel(prev);
    const { primary: currentLabel } = formatDayLabel(dateStr);
    const { primary: nextLabel } = formatDayLabel(next);

    return (
        <View style={styles.row}>
            <Pressable
                onPress={() => !atCap && onNavigate(prev)}
                disabled={atCap}
                style={[styles.arrow, { opacity: atCap ? 0.25 : 1 }]}
                hitSlop={12}
                accessibilityLabel={atCap ? 'At maximum lookback' : `Go to ${prevLabel}`}
            >
                <Ionicons name="chevron-back" size={20} color={palette.textMuted} />
            </Pressable>

            <View style={styles.labelRow}>
                {daysBack >= 2 ? (
                    <Text style={[styles.sideDay, { color: palette.textMuted }]} numberOfLines={1}>
                        {formatDayLabel(prev).primary}
                    </Text>
                ) : null}
                <Text
                    style={[
                        styles.currentDay,
                        {
                            color: isToday ? palette.primary : palette.text,
                            borderBottomColor: isToday ? 'rgba(160,63,40,0.4)' : 'transparent',
                            borderBottomWidth: isToday ? 1 : 0,
                        },
                    ]}
                    numberOfLines={1}
                >
                    {currentLabel}
                </Text>
                {!isToday ? (
                    <Text style={[styles.sideDay, { color: palette.textMuted }]} numberOfLines={1}>
                        {formatDayLabel(next).primary}
                    </Text>
                ) : null}
            </View>

            <Pressable
                onPress={() => !isToday && onNavigate(next)}
                disabled={isToday}
                style={[styles.arrow, { opacity: isToday ? 0.25 : 1 }]}
                hitSlop={12}
                accessibilityLabel={isToday ? 'Already on today' : `Go to ${nextLabel}`}
            >
                <Ionicons name="chevron-forward" size={20} color={palette.textMuted} />
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: Spacing.lg,
    },
    arrow: {
        padding: Spacing.sm,
    },
    labelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
        flex: 1,
        justifyContent: 'center',
    },
    sideDay: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
    },
    currentDay: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
        paddingBottom: 2,
    },
});
