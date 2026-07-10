/**
 * StitchConfirmSheet — "add this to the table?" (TICKET-159 stray-log stitch).
 *
 * Shown right after an entry save when the create response carried a
 * `supper_suggestion`: the author logged the same spot around the night their
 * table gathered, without opening the supper. The author decides — takes are
 * personal (doctrine), so the entry NEVER auto-attaches; dismissing (or
 * backdrop-tapping) leaves it standalone.
 *
 * Copy is spec-verbatim:
 *   title    `add this to the table?`
 *   context  `<n> gathered at <restaurant> <day>.`
 *   primary  `add as my take`
 *   secondary `keep it separate`
 *
 * Shell cloned from OwnerActionsSheet (the ONE warm-paper action sheet):
 * ambient overlay, rounded top, stacked actions. Restaurant name renders in
 * italic serif (content), the rest in Manrope (function).
 */
import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { shortDate } from '@/components/gatherings/gatheringFormat';
import type { SupperSuggestion } from '@/hooks/suppers';

interface StitchConfirmSheetProps {
    visible: boolean;
    suggestion: SupperSuggestion | null;
    /** Disables both actions while the attach round-trips. */
    pending?: boolean;
    onConfirm: () => void;
    /** "keep it separate" AND the backdrop — the entry stays standalone. */
    onDismiss: () => void;
}

export function StitchConfirmSheet({
    visible,
    suggestion,
    pending = false,
    onConfirm,
    onDismiss,
}: StitchConfirmSheetProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();

    if (!suggestion) return null;

    const contextLine = (
        <Text style={[styles.context, { color: palette.textSecondary }]}>
            {`${suggestion.gathered_count} gathered at `}
            <Text style={styles.contextName}>{suggestion.restaurant_name ?? 'this spot'}</Text>
            {` ${shortDate(suggestion.night)}.`}
        </Text>
    );

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
            <Pressable
                style={[styles.backdrop, { backgroundColor: palette.overlay }]}
                onPress={pending ? undefined : onDismiss}
                accessibilityLabel="keep it separate"
            >
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

                    <Text style={[Type.titleMedium, { color: palette.text, textAlign: 'center' }]}>
                        add this to the table?
                    </Text>
                    <View style={{ marginTop: Spacing.xs, alignItems: 'center' }}>{contextLine}</View>

                    <View style={{ marginTop: Spacing.xl, gap: Spacing.sm }}>
                        <Pressable
                            onPress={onConfirm}
                            disabled={pending}
                            style={({ pressed }) => [
                                styles.button,
                                { backgroundColor: palette.primary, opacity: pressed || pending ? 0.85 : 1 },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel="add as my take"
                        >
                            {pending ? (
                                <ActivityIndicator size="small" color="#fff" />
                            ) : (
                                <Text style={[Type.label, { color: '#fff' }]}>add as my take</Text>
                            )}
                        </Pressable>

                        <Pressable
                            onPress={onDismiss}
                            disabled={pending}
                            style={({ pressed }) => [
                                styles.button,
                                { backgroundColor: palette.surfaceContainerHigh, opacity: pressed ? 0.85 : 1 },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel="keep it separate"
                        >
                            <Text style={[Type.label, { color: palette.textMuted }]}>keep it separate</Text>
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
    context: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
        textAlign: 'center',
    },
    contextName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
        fontStyle: 'italic',
    },
    button: {
        paddingVertical: Spacing.md,
        borderRadius: Radius.full,
        alignItems: 'center',
    },
});
