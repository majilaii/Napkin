/**
 * CounterDatePicker — the counter-date / reschedule picker, extracted verbatim
 * from GatheringCard (TICKET-136). One picker family, one place: the iOS inline
 * Modal-sheet and the Android system dialog, plus the min/max window
 * (today … +90d), the `en-CA` YMD, the HKT re-validation on the server, and the
 * Android `dismissed` branch — all the correctness details that must not drift
 * across the feed card and the detail screen.
 *
 * Controlled: the parent owns `visible`/`value` (the seed) and receives
 * `onPick(date)` on commit (iOS "done" / Android confirm) or `onClose()` on
 * dismiss. The picker owns the working selection internally (re-seeded from
 * `value` each time it opens) and the platform branch.
 *
 * Same DateTimePicker family as GatherSheet (min today — same-day counters are
 * the decide-tonight spirit; max +90d).
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Modal, Platform } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { dayFromNow, MAX_DAYS_AHEAD } from './gatheringFormat';

type Palette = typeof Colors.light;

interface CounterDatePickerProps {
    visible: boolean;
    /** Seed date — read when the picker opens (false → true edge). */
    value: Date;
    /** Commit: the chosen date (iOS "done" / Android confirm). */
    onPick: (date: Date) => void;
    /** Dismiss without picking (scrim tap / Android cancel / request-close). */
    onClose: () => void;
    palette: Palette;
    scheme: 'light' | 'dark';
}

export function CounterDatePicker({
    visible,
    value,
    onPick,
    onClose,
    palette,
    scheme,
}: CounterDatePickerProps) {
    // The working selection lives here (iOS inline updates it; "done" commits it).
    // Re-seeded from `value` only on the false → true edge so mid-open value
    // identity churn (a fresh dayFromNow(1) each render) never resets it.
    const [working, setWorking] = useState<Date>(value);
    const wasVisible = useRef(false);
    useEffect(() => {
        if (visible && !wasVisible.current) setWorking(value);
        wasVisible.current = visible;
    }, [visible, value]);

    const handleCounterChange = (event: DateTimePickerEvent, selected?: Date) => {
        // Android's picker is a system dialog — it returns the chosen date directly.
        if (Platform.OS === 'android') {
            onClose();
            if (event.type === 'dismissed' || !selected) return;
            const next = new Date(selected);
            next.setHours(0, 0, 0, 0);
            onPick(next);
            return;
        }
        if (!selected) return;
        const next = new Date(selected);
        next.setHours(0, 0, 0, 0);
        setWorking(next);
    };

    if (Platform.OS === 'ios') {
        return (
            <Modal
                visible={visible}
                transparent
                animationType="slide"
                onRequestClose={onClose}
                statusBarTranslucent
            >
                <Pressable
                    style={[styles.calendarScrim, { backgroundColor: palette.scrimDark }]}
                    onPress={onClose}
                    accessibilityLabel="close calendar"
                />
                <View style={[styles.calendarSheet, { backgroundColor: palette.surfaceNote }]}>
                    <View style={styles.calendarHeader}>
                        <Text style={[styles.calendarKicker, { color: palette.textMuted }]}>PICK A DATE</Text>
                        <Pressable onPress={() => onPick(working)} hitSlop={14} accessibilityLabel="done">
                            <Text style={[styles.calendarDone, { color: palette.primary }]}>done</Text>
                        </Pressable>
                    </View>
                    <View style={styles.calendarPickerWrap}>
                        <DateTimePicker
                            value={working}
                            mode="date"
                            display="inline"
                            minimumDate={dayFromNow(0)}
                            maximumDate={dayFromNow(MAX_DAYS_AHEAD)}
                            onChange={handleCounterChange}
                            accentColor={palette.primary}
                            themeVariant={scheme}
                        />
                    </View>
                </View>
            </Modal>
        );
    }

    return visible ? (
        <DateTimePicker
            value={working}
            mode="date"
            display="calendar"
            minimumDate={dayFromNow(1)}
            maximumDate={dayFromNow(MAX_DAYS_AHEAD)}
            onChange={handleCounterChange}
        />
    ) : null;
}

const styles = StyleSheet.create({
    // Counter-date picker overlay (mirrors GatherSheet's calendar sheet).
    calendarScrim: { ...StyleSheet.absoluteFillObject },
    calendarSheet: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        borderTopLeftRadius: Radius.xl,
        borderTopRightRadius: Radius.xl,
        paddingBottom: Spacing.xl,
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.08,
        shadowRadius: 24,
        elevation: 16,
    },
    calendarHeader: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.md,
        paddingBottom: Spacing.xs,
    },
    calendarKicker: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
    },
    calendarDone: { fontFamily: 'Manrope_700Bold', fontSize: 13 },
    calendarPickerWrap: {
        paddingHorizontal: Spacing.md,
        paddingTop: Spacing.xs,
    },
});
