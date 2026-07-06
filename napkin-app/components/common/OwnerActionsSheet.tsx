/**
 * OwnerActionsSheet — TICKET-111: the ONE warm-paper action sheet every owned
 * surface opens on long-press (or a swipe-revealed trash tap). Generalises the
 * wishlist RemoveConfirmationSheet into an ordered list of actions so we never
 * fork a bespoke sheet per surface.
 *
 * Grammar:
 *   - A quiet title (the thing being acted on) + optional subtitle.
 *   - An ordered stack of actions; `kind: 'destructive'` renders terracotta-error
 *     filled, `'default'` renders a quiet high-surface button.
 *   - A trailing Cancel. Tapping the backdrop == Cancel.
 *
 * Destructive taps STILL confirm — a destructive action here is the confirm step
 * (the caller opens this sheet; the tap inside it performs the delete). No
 * inline edit: this is an overlay, so it satisfies "reading surfaces stay read
 * surfaces" (locked doctrine 2026-06-19).
 */
import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export interface OwnerAction {
    label: string;
    kind?: 'default' | 'destructive';
    onPress: () => void;
}

interface OwnerActionsSheetProps {
    visible: boolean;
    title: string;
    subtitle?: string;
    actions: OwnerAction[];
    onCancel: () => void;
}

export function OwnerActionsSheet({
    visible,
    title,
    subtitle,
    actions,
    onCancel,
}: OwnerActionsSheetProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
            <Pressable style={[styles.backdrop, { backgroundColor: palette.overlay }]} onPress={onCancel}>
                <View
                    style={[
                        styles.sheet,
                        {
                            backgroundColor: palette.surfaceContainerLow,
                            paddingBottom: Math.max(insets.bottom, Spacing.lg),
                        },
                    ]}
                    onStartShouldSetResponder={() => true}
                >
                    <View style={styles.handle} />

                    <Text
                        style={[Type.titleMedium, { color: palette.text, textAlign: 'center' }]}
                        numberOfLines={1}
                    >
                        {title}
                    </Text>
                    {subtitle ? (
                        <Text
                            style={[
                                Type.bodySmall,
                                { color: palette.textMuted, textAlign: 'center', marginTop: Spacing.xs },
                            ]}
                        >
                            {subtitle}
                        </Text>
                    ) : null}

                    <View style={{ marginTop: Spacing.xl, gap: Spacing.sm }}>
                        {actions.map((action, i) => {
                            const destructive = action.kind === 'destructive';
                            return (
                                <Pressable
                                    key={`${action.label}-${i}`}
                                    onPress={action.onPress}
                                    style={({ pressed }) => [
                                        styles.button,
                                        {
                                            backgroundColor: destructive
                                                ? palette.error
                                                : palette.surfaceContainerHigh,
                                            opacity: pressed ? 0.85 : 1,
                                        },
                                    ]}
                                >
                                    <Text
                                        style={[
                                            Type.label,
                                            { color: destructive ? palette.textInverse : palette.text },
                                        ]}
                                    >
                                        {action.label}
                                    </Text>
                                </Pressable>
                            );
                        })}

                        <Pressable
                            onPress={onCancel}
                            style={({ pressed }) => [
                                styles.button,
                                { backgroundColor: palette.surfaceContainerHigh, opacity: pressed ? 0.85 : 1 },
                            ]}
                        >
                            <Text style={[Type.label, { color: palette.textMuted }]}>Cancel</Text>
                        </Pressable>
                    </View>
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
    button: {
        paddingVertical: Spacing.md,
        borderRadius: Radius.full,
        alignItems: 'center',
    },
});
