/**
 * RemoveConfirmationSheet — bottom-sheet modal with a single destructive action.
 * Long-press on a personal wishlist card opens this sheet.
 */
import React from 'react';
import {
    Modal,
    View,
    Text,
    Pressable,
    StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface RemoveConfirmationSheetProps {
    visible: boolean;
    restaurantName: string;
    onConfirm: () => void;
    onCancel: () => void;
}

export function RemoveConfirmationSheet({
    visible,
    restaurantName,
    onConfirm,
    onCancel,
}: RemoveConfirmationSheetProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onCancel}
        >
            <Pressable
                style={[styles.backdrop, { backgroundColor: palette.overlay }]}
                onPress={onCancel}
            >
                <View
                    style={[
                        styles.sheet,
                        {
                            backgroundColor: palette.surfaceContainerLow,
                            paddingBottom: Math.max(insets.bottom, Spacing.lg),
                        },
                    ]}
                    // Prevent backdrop press from dismissing when touching the sheet
                    onStartShouldSetResponder={() => true}
                >
                    <View style={styles.handle} />

                    <Text
                        style={[
                            Type.titleMedium,
                            { color: palette.text, textAlign: 'center', marginBottom: Spacing.xs },
                        ]}
                        numberOfLines={1}
                    >
                        {restaurantName}
                    </Text>
                    <Text
                        style={[
                            Type.bodySmall,
                            { color: palette.textMuted, textAlign: 'center', marginBottom: Spacing.xl },
                        ]}
                    >
                        Remove from your wishlist?
                    </Text>

                    <Pressable
                        onPress={onConfirm}
                        style={({ pressed }) => [
                            styles.button,
                            { backgroundColor: palette.error, opacity: pressed ? 0.85 : 1 },
                        ]}
                    >
                        <Text style={[Type.label, { color: palette.textInverse }]}>
                            Remove from wishlist
                        </Text>
                    </Pressable>

                    <Pressable
                        onPress={onCancel}
                        style={({ pressed }) => [
                            styles.button,
                            styles.cancelButton,
                            {
                                backgroundColor: palette.surfaceContainerHigh,
                                opacity: pressed ? 0.85 : 1,
                                marginTop: Spacing.sm,
                            },
                        ]}
                    >
                        <Text style={[Type.label, { color: palette.text }]}>Cancel</Text>
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
    button: {
        paddingVertical: Spacing.md,
        borderRadius: Radius.full,
        alignItems: 'center',
    },
    cancelButton: {},
});
