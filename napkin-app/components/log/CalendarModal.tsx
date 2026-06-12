/**
 * CalendarModal — bottom-sheet date picker overlay (TICKET-078).
 *
 * Replaces the old inline-expanding `DateTimePicker` (display="inline") that
 * pushed the whole logger sheet down when the WHEN value was tapped. The picker
 * now floats over the logger in a slide-up Modal — the body never shifts.
 *
 * Chrome mirrors the app's sheet language:
 *   - scrim (palette.scrimDark — warm ink @ 35%), tap-to-close
 *   - warm-paper sheet, top radii, grabber
 *   - header: "WHEN" kicker (left) · terracotta "done" (right)
 *   - native month calendar inside (display="inline" iOS / "calendar" Android)
 *
 * Selecting a date fires onChange live (the caller updates visitedAt).
 * done / scrim-tap / native swipe-down (onRequestClose) all close.
 */
import React from 'react';
import {
    Modal,
    View,
    Text,
    Pressable,
    StyleSheet,
    Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker, {
    type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    visible: boolean;
    /** Currently selected date (the picker opens on this value). */
    value: Date;
    /** Native picker change — caller updates the bound date. */
    onChange: (event: DateTimePickerEvent, selected?: Date) => void;
    /** Close the modal (done / scrim-tap / swipe-down). */
    onClose: () => void;
}

export function CalendarModal({ visible, value, onChange, onClose }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onClose}
            statusBarTranslucent
        >
            {/* Scrim — tap to close */}
            <Pressable
                style={[styles.scrim, { backgroundColor: palette.scrimDark }]}
                onPress={onClose}
                accessibilityLabel="close calendar"
            />

            {/* Bottom sheet */}
            <View
                style={[
                    styles.sheet,
                    {
                        backgroundColor: palette.surfaceNote,
                        paddingBottom: insets.bottom + Spacing.md,
                    },
                ]}
            >
                {/* Grabber */}
                <View style={styles.handleArea}>
                    <View style={[styles.handle, { backgroundColor: palette.ruleInkSoft }]} />
                </View>

                {/* Header — WHEN kicker · done */}
                <View style={styles.header}>
                    <Text style={[styles.kicker, { color: palette.textMuted }]}>
                        WHEN
                    </Text>
                    <Pressable onPress={onClose} hitSlop={14} accessibilityLabel="done">
                        <Text style={[styles.doneBtn, { color: palette.primary }]}>
                            done
                        </Text>
                    </Pressable>
                </View>

                {/* Native month calendar */}
                <View style={styles.pickerWrap}>
                    <DateTimePicker
                        value={value}
                        mode="date"
                        display={Platform.OS === 'ios' ? 'inline' : 'calendar'}
                        maximumDate={new Date()}
                        onChange={onChange}
                        accentColor={palette.primary}
                        themeVariant={scheme}
                    />
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    scrim: {
        ...StyleSheet.absoluteFillObject,
    },
    sheet: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        borderTopLeftRadius: Radius.xl,
        borderTopRightRadius: Radius.xl,
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.08,
        shadowRadius: 24,
        elevation: 16,
    },
    handleArea: {
        alignItems: 'center',
        paddingTop: Spacing.sm + 2,
        paddingBottom: Spacing.xs,
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.xs,
        paddingBottom: Spacing.xs,
    },
    kicker: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
    },
    doneBtn: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
    },
    pickerWrap: {
        paddingHorizontal: Spacing.md,
        ...(Platform.OS === 'android' ? {} : { paddingTop: Spacing.xs }),
    },
});
