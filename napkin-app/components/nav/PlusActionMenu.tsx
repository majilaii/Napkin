/**
 * PlusActionMenu — small bottom sheet opened when the user taps the + nav button.
 *
 * Replaces the direct router.push('/create-entry') so users can choose between:
 *   "log a visit"   — existing flow → push /create-entry
 *   "add from link" — new flow      → open ImportLinkSheet
 *
 * Per feedback_bottom_nav.md: nav icons themselves are NOT modified, only what
 * the + press triggers.
 *
 * Heirloom Journal: warm paper bg, italic Newsreader rows, lowercase verbs,
 * no icons, no 1px borders, ambient shadow only.
 */
import React from 'react';
import {
    Modal,
    View,
    Text,
    Pressable,
    StyleSheet,
    TouchableWithoutFeedback,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Palette = typeof Colors.light;

interface PlusActionMenuProps {
    visible: boolean;
    onDismiss: () => void;
    onLogVisit: () => void;
    onAddFromLink: () => void;
}

export function PlusActionMenu({
    visible,
    onDismiss,
    onLogVisit,
    onAddFromLink,
}: PlusActionMenuProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;
    const insets = useSafeAreaInsets();

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onDismiss}
        >
            <TouchableWithoutFeedback onPress={onDismiss}>
                <View style={[styles.backdrop, { backgroundColor: palette.overlay }]} />
            </TouchableWithoutFeedback>

            <View
                style={[
                    styles.sheet,
                    {
                        backgroundColor: palette.card,
                        paddingBottom: Math.max(insets.bottom, Spacing.lg),
                    },
                    Shadow.ambient,
                ]}
            >
                <View style={[styles.handle, { backgroundColor: palette.outlineVariant }]} />

                {/* log a visit */}
                <Pressable
                    onPress={onLogVisit}
                    accessibilityRole="button"
                    accessibilityLabel="log a visit"
                    style={({ pressed }) => [
                        styles.row,
                        { backgroundColor: palette.card, opacity: pressed ? 0.7 : 1 },
                    ]}
                >
                    <Text style={[styles.rowText, { color: palette.text }]}>log a visit</Text>
                    <Text style={[Type.bodySmall, { color: palette.textMuted }]}>
                        rate, note, photos
                    </Text>
                </Pressable>

                <View style={[styles.divider, { backgroundColor: palette.dividerSoft }]} />

                {/* add from link */}
                <Pressable
                    onPress={onAddFromLink}
                    accessibilityRole="button"
                    accessibilityLabel="add from link"
                    style={({ pressed }) => [
                        styles.row,
                        { backgroundColor: palette.card, opacity: pressed ? 0.7 : 1 },
                    ]}
                >
                    <Text style={[styles.rowText, { color: palette.text }]}>add from link</Text>
                    <Text style={[Type.bodySmall, { color: palette.textMuted }]}>
                        paste a tiktok, maps, or restaurant url
                    </Text>
                </Pressable>

                {/* Cancel */}
                <Pressable
                    onPress={onDismiss}
                    accessibilityRole="button"
                    accessibilityLabel="cancel"
                    style={({ pressed }) => [
                        styles.cancelRow,
                        {
                            backgroundColor: palette.surfaceContainerLow,
                            opacity: pressed ? 0.7 : 1,
                        },
                    ]}
                >
                    <Text style={[Type.body, { color: palette.textMuted }]}>cancel</Text>
                </Pressable>
            </View>
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
        paddingHorizontal: Spacing.md,
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: Spacing.md,
    },
    row: {
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.sm,
        borderRadius: Radius.md,
        minHeight: 64,
        justifyContent: 'center',
    },
    rowText: {
        ...Type.headlineItalic,
        fontSize: 17,
        marginBottom: 2,
    },
    divider: {
        height: 1,
        marginVertical: Spacing.xs,
        marginHorizontal: Spacing.sm,
    },
    cancelRow: {
        marginTop: Spacing.sm,
        paddingVertical: Spacing.md,
        borderRadius: Radius.md,
        alignItems: 'center',
        minHeight: 48,
        justifyContent: 'center',
    },
});
