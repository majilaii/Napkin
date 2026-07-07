/**
 * NotifPermissionSheet — soft pre-permission sheet (TICKET-120).
 *
 * Shown from the root layout when the drain reports an import in flight, permission
 * isn't granted, and the cadence gate allows (≥14d apart, <3 declines). Demonstrated-
 * value moment, not a nag. Headline + one line + two buttons — nothing more.
 *
 * Primary routes on current permission: 'undetermined' → OS prompt; 'denied' →
 * system Settings. The 14-day clock is already stamped by maybeOfferNotifPrompt when
 * it emits; "not now" additionally bumps the decline count toward the hard stop.
 */
import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    getPermissionState,
    requestPermission,
    openNotificationSettings,
    recordNotifPromptDecline,
} from '@/lib/localNotify';

interface NotifPermissionSheetProps {
    visible: boolean;
    onClose: () => void;
}

export function NotifPermissionSheet({ visible, onClose }: NotifPermissionSheetProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();

    const handleEnable = async () => {
        const perm = await getPermissionState();
        if (perm === 'undetermined') {
            await requestPermission();
        } else if (perm === 'denied') {
            openNotificationSettings();
        }
        onClose();
    };

    const handleDecline = () => {
        recordNotifPromptDecline();
        onClose();
    };

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <Pressable style={[styles.backdrop, { backgroundColor: palette.overlay }]} onPress={onClose}>
                <View
                    style={[
                        styles.sheet,
                        Shadow.ambient,
                        {
                            backgroundColor: palette.surfaceContainerLow,
                            paddingBottom: Math.max(insets.bottom, Spacing.lg),
                        },
                    ]}
                    onStartShouldSetResponder={() => true}
                >
                    <View style={styles.handle} />

                    <Text style={[styles.headline, { color: palette.text }]}>
                        know when your spots are ready
                    </Text>
                    <Text style={[Type.bodySmall, styles.line, { color: palette.textMuted }]}>
                        imports finish in the background — we&apos;ll nudge you to confirm.
                    </Text>

                    <Pressable
                        onPress={handleEnable}
                        style={({ pressed }) => [
                            styles.primaryBtn,
                            { backgroundColor: palette.primary, opacity: pressed ? 0.85 : 1 },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="turn on notifications"
                    >
                        <Text style={[styles.primaryLabel, { color: palette.textInverse }]}>
                            turn on notifications
                        </Text>
                    </Pressable>

                    <Pressable
                        onPress={handleDecline}
                        hitSlop={8}
                        style={styles.ghostBtn}
                        accessibilityRole="button"
                        accessibilityLabel="not now"
                    >
                        <Text style={[styles.ghostLabel, { color: palette.textMuted }]}>not now</Text>
                    </Pressable>
                </View>
            </Pressable>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    sheet: {
        borderTopLeftRadius: Radius.xl,
        borderTopRightRadius: Radius.xl,
        paddingTop: Spacing.md,
        paddingHorizontal: Spacing.lg,
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: 'rgba(0,0,0,0.15)',
        alignSelf: 'center',
        marginBottom: Spacing.lg,
    },
    headline: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 18,
        lineHeight: 24,
        letterSpacing: -0.2,
        marginBottom: Spacing.sm,
    },
    line: {
        marginBottom: Spacing.xl,
    },
    primaryBtn: {
        paddingVertical: 14,
        borderRadius: Radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 48,
    },
    primaryLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 1.4,
        textTransform: 'lowercase',
    },
    ghostBtn: {
        alignItems: 'center',
        paddingVertical: Spacing.md,
        marginTop: Spacing.xs,
    },
    ghostLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
    },
});
