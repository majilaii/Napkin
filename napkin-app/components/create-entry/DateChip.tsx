/**
 * DateChip — chip that opens a lightweight date-picker modal.
 * Lists the past 30 days as selectable rows (no native date picker needed).
 * Renders visited_at as lowercase human copy: "today", "yesterday", "thu apr 18".
 */
import React, { useState, useMemo } from 'react';
import { Text, Pressable, StyleSheet, Modal, View, ScrollView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getTodayDateStr, getYesterdayDateStr, localDateStr } from '@/lib/dateHelpers';

interface Props {
    value: Date;
    onChange: (date: Date) => void;
}

const MAX_DAYS_BACK = 30;

function formatChipLabel(date: Date): string {
    const dateStr = localDateStr(date);
    const today = getTodayDateStr();
    const yesterday = getYesterdayDateStr();

    if (dateStr === today) return 'today';
    if (dateStr === yesterday) return 'yesterday';

    const dayName = date.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
    const month = date.toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
    const day = date.getDate();
    return `${dayName} ${month} ${day}`;
}

function formatRowLabel(date: Date, today: string, yesterday: string): string {
    const dateStr = localDateStr(date);
    if (dateStr === today) return 'Today';
    if (dateStr === yesterday) return 'Yesterday';

    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
    });
}

/** Build the past MAX_DAYS_BACK dates, newest first. */
function buildDateOptions(): Date[] {
    const options: Date[] = [];
    const now = new Date();
    for (let i = 0; i < MAX_DAYS_BACK; i++) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        options.push(d);
    }
    return options;
}

export function DateChip({ value, onChange }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const [showModal, setShowModal] = useState(false);

    const label = formatChipLabel(value);
    const today = getTodayDateStr();
    const yesterday = getYesterdayDateStr();
    const dateOptions = useMemo(() => buildDateOptions(), []);
    const selectedDateStr = localDateStr(value);

    const handleSelect = (date: Date) => {
        // Preserve the original time component
        const next = new Date(date);
        next.setHours(value.getHours(), value.getMinutes(), value.getSeconds());
        onChange(next);
        setShowModal(false);
    };

    return (
        <>
            <Pressable
                onPress={() => setShowModal(true)}
                style={[styles.chip, { borderColor: palette.divider }]}
                accessibilityLabel={`Date: ${label}. Tap to change.`}
            >
                <Ionicons name="calendar-outline" size={13} color={palette.textSecondary} />
                <Text style={[styles.chipLabel, { color: palette.textSecondary }]}>{label}</Text>
            </Pressable>

            <Modal
                visible={showModal}
                transparent
                animationType="slide"
                onRequestClose={() => setShowModal(false)}
                statusBarTranslucent
            >
                <Pressable style={styles.backdrop} onPress={() => setShowModal(false)} />
                <View style={[styles.sheet, { backgroundColor: palette.surfaceContainerLow }]}>
                    {/* Header */}
                    <View style={[styles.sheetHeader, { borderBottomColor: palette.divider }]}>
                        <Text style={[styles.sheetTitle, { color: palette.text }]}>When did you go?</Text>
                        <Pressable onPress={() => setShowModal(false)} hitSlop={12}>
                            <Ionicons name="close" size={20} color={palette.textSecondary} />
                        </Pressable>
                    </View>

                    {/* Date rows */}
                    <ScrollView
                        style={styles.scrollView}
                        contentContainerStyle={styles.scrollContent}
                        showsVerticalScrollIndicator={false}
                    >
                        {dateOptions.map((date, idx) => {
                            const dateStr = localDateStr(date);
                            const isSelected = dateStr === selectedDateStr;
                            const rowLabel = formatRowLabel(date, today, yesterday);

                            return (
                                <Pressable
                                    key={dateStr}
                                    onPress={() => handleSelect(date)}
                                    style={[
                                        styles.row,
                                        idx < dateOptions.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.divider },
                                        isSelected && { backgroundColor: `${palette.primary}12` },
                                    ]}
                                >
                                    <Text
                                        style={[
                                            styles.rowLabel,
                                            { color: isSelected ? palette.primary : palette.text },
                                        ]}
                                    >
                                        {rowLabel}
                                    </Text>
                                    {isSelected && (
                                        <Ionicons name="checkmark" size={18} color={palette.primary} />
                                    )}
                                </Pressable>
                            );
                        })}
                    </ScrollView>
                </View>
            </Modal>
        </>
    );
}

const styles = StyleSheet.create({
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: Radius.full,
        borderWidth: 1,
        backgroundColor: 'transparent',
    },
    chipLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        fontWeight: '500',
    },
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(28, 28, 25, 0.40)',
    },
    sheet: {
        maxHeight: '60%',
        borderTopLeftRadius: Radius.xl ?? 20,
        borderTopRightRadius: Radius.xl ?? 20,
        paddingBottom: Platform.OS === 'ios' ? 34 : 16,
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.08,
        shadowRadius: 16,
        elevation: 8,
    },
    sheetHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.md,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    sheetTitle: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 15,
        fontWeight: '600',
    },
    scrollView: {
        flexGrow: 0,
    },
    scrollContent: {
        paddingHorizontal: Spacing.lg,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 14,
        paddingHorizontal: Spacing.sm,
    },
    rowLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 15,
        fontWeight: '500',
    },
});
