/**
 * EditorScreen — shared scaffold for the single-field settings editors
 * (/settings/name · /settings/username · /settings/bio · /settings/photo).
 *
 * Chrome follows the app's pushed-page grammar (see /reviews,
 * /restaurant-reviews): chevron back on the left, centered lowercase
 * italic-serif title, and a quiet lowercase "save" in the right slot —
 * terracotta when armed, muted otherwise. Screens supply only their field
 * UI as children; `editorStyles` carries the shared note-card field styles
 * so every editor's input reads as the same warm card (background shift +
 * ambient shadow, never a 1px box).
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Shadow, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function EditorScreen({
    title,
    children,
    onSave,
    saveEnabled = false,
    saving = false,
    saveLabel = 'save',
}: {
    title: string;
    children: React.ReactNode;
    /** When provided, a save affordance renders in the top-bar right slot. */
    onSave?: () => void;
    saveEnabled?: boolean;
    saving?: boolean;
    saveLabel?: string;
}) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();

    return (
        <View
            style={[
                styles.container,
                { backgroundColor: palette.background, paddingTop: insets.top },
            ]}
        >
            <View style={styles.topBar}>
                <Pressable
                    onPress={() => router.back()}
                    hitSlop={12}
                    style={styles.side}
                    accessibilityLabel="back"
                >
                    <Ionicons name="chevron-back" size={22} color={palette.textMuted} />
                </Pressable>
                <Text style={[styles.title, { color: palette.text }]}>{title}</Text>
                <View style={[styles.side, styles.sideRight]}>
                    {onSave ? (
                        saving ? (
                            <ActivityIndicator size="small" color={palette.primary} />
                        ) : (
                            <Pressable
                                onPress={onSave}
                                disabled={!saveEnabled}
                                hitSlop={12}
                                accessibilityRole="button"
                                accessibilityLabel={saveLabel}
                            >
                                <Text
                                    style={[
                                        styles.save,
                                        { color: saveEnabled ? palette.primary : palette.textMuted },
                                    ]}
                                >
                                    {saveLabel}
                                </Text>
                            </Pressable>
                        )
                    ) : null}
                </View>
            </View>

            <ScrollView
                contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                {children}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 18,
        paddingTop: Spacing.sm,
        paddingBottom: Spacing.sm,
    },
    side: {
        width: 44,
        alignItems: 'flex-start',
    },
    sideRight: {
        alignItems: 'flex-end',
    },
    title: {
        ...Type.screenTitle,
    },
    save: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 14,
    },
    scrollContent: {
        paddingHorizontal: 20,
        paddingTop: Spacing.xl,
    },
});

/**
 * Shared field styles — the note-card input language every editor uses.
 * Background shift + ambient shadow carry the structure; no input borders.
 */
export const editorStyles = StyleSheet.create({
    fieldCard: {
        borderRadius: 16,
        paddingHorizontal: Spacing.md + 2,
        paddingVertical: 13,
        ...Shadow.subtle,
    },
    fieldText: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 15.5,
        padding: 0,
    },
    helper: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        marginTop: Spacing.sm,
        paddingHorizontal: 4,
    },
});
