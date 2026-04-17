/**
 * LogVisitSheet — bottom sheet that appears when user taps "Log a visit".
 *
 * Options:
 *   - "Solo log" (always shown)
 *   - "Start a Round here" (only when hasSocialTable is true)
 *
 * Uses React Native Modal for the sheet overlay (no new dep; same pattern as
 * existing bottom sheets in this codebase).
 */
import React from 'react';
import {
    View,
    Text,
    Modal,
    Pressable,
    StyleSheet,
    TouchableWithoutFeedback,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Palette = typeof Colors.light;

interface Props {
    visible: boolean;
    onClose: () => void;
    /** Fires after the sheet finishes dismissing (iOS only). Use this to chain follow-up sheets. */
    onDismiss?: () => void;
    onSoloLog: () => void;
    onStartRound: () => void;
    showRoundOption: boolean;
}

export function LogVisitSheet({
    visible,
    onClose,
    onDismiss,
    onSoloLog,
    onStartRound,
    showRoundOption,
}: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;
    const insets = useSafeAreaInsets();

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onClose}
            onDismiss={onDismiss}
        >
            {/* Backdrop tap to dismiss */}
            <TouchableWithoutFeedback onPress={onClose}>
                <View style={[styles.backdrop, { backgroundColor: palette.overlay }]} />
            </TouchableWithoutFeedback>

            {/* Sheet */}
            <View
                style={[
                    styles.sheet,
                    {
                        backgroundColor: palette.card,
                        paddingBottom: insets.bottom + Spacing.lg,
                    },
                    Shadow.ambient,
                ]}
            >
                {/* Handle bar */}
                <View style={[styles.handle, { backgroundColor: palette.outlineVariant }]} />

                <Text
                    style={[
                        Type.headlineMedium,
                        {
                            color: palette.text,
                            marginBottom: Spacing.lg,
                            paddingHorizontal: Spacing.lg,
                        },
                    ]}
                >
                    Log a visit
                </Text>

                {/* Solo log */}
                <Pressable
                    onPress={onSoloLog}
                    style={({ pressed }) => [
                        styles.option,
                        { backgroundColor: pressed ? palette.surfaceContainerLow : palette.card },
                    ]}
                >
                    <View
                        style={[
                            styles.iconCircle,
                            { backgroundColor: palette.primaryMuted },
                        ]}
                    >
                        <Ionicons name="book-outline" size={20} color={palette.primary} />
                    </View>
                    <View style={styles.optionText}>
                        <Text style={[Type.titleMedium, { color: palette.text }]}>
                            Solo log
                        </Text>
                        <Text style={[Type.bodySmall, { color: palette.textMuted, marginTop: 2 }]}>
                            Add to your personal diary
                        </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
                </Pressable>

                {/* Start a Round */}
                {showRoundOption && (
                    <Pressable
                        onPress={onStartRound}
                        style={({ pressed }) => [
                            styles.option,
                            {
                                backgroundColor: pressed
                                    ? palette.surfaceContainerLow
                                    : palette.card,
                            },
                        ]}
                    >
                        <View
                            style={[
                                styles.iconCircle,
                                { backgroundColor: palette.secondaryContainer },
                            ]}
                        >
                            <Ionicons name="people-outline" size={20} color={palette.secondary} />
                        </View>
                        <View style={styles.optionText}>
                            <Text style={[Type.titleMedium, { color: palette.text }]}>
                                Start a Round here
                            </Text>
                            <Text
                                style={[Type.bodySmall, { color: palette.textMuted, marginTop: 2 }]}
                            >
                                Rate together with your Table
                            </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
                    </Pressable>
                )}
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
    },
    sheet: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        borderTopLeftRadius: Radius.xxl,
        borderTopRightRadius: Radius.xxl,
        paddingTop: Spacing.sm,
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: Radius.full,
        alignSelf: 'center',
        marginBottom: Spacing.md,
    },
    option: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.md,
        gap: Spacing.md,
    },
    iconCircle: {
        width: 44,
        height: 44,
        borderRadius: Radius.full,
        justifyContent: 'center',
        alignItems: 'center',
    },
    optionText: {
        flex: 1,
    },
});
