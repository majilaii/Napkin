/**
 * EditorScreen — shared scaffold for the single-field settings editors
 * (/settings/name · /settings/username · /settings/bio · /settings/photo).
 *
 * Keeps the chrome identical to the rest of settings: safe-area top bar with a
 * terracotta "← Back", a right-slot action (a Save button for text editors, or
 * nothing for the photo editor which applies immediately), and a serif title.
 * Screens supply only their field UI as children.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function EditorScreen({
    title,
    children,
    onSave,
    saveEnabled = false,
    saving = false,
    saveLabel = 'Save',
}: {
    title: string;
    children: React.ReactNode;
    /** When provided, a Save button renders in the top-bar right slot. */
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
                { backgroundColor: palette.background, paddingTop: insets.top + Spacing.sm },
            ]}
        >
            <View style={styles.topBar}>
                <Pressable onPress={() => router.back()} hitSlop={12}>
                    <Text style={[Type.body, { color: palette.primary }]}>← Back</Text>
                </Pressable>

                {onSave ? (
                    <Pressable
                        onPress={onSave}
                        disabled={!saveEnabled || saving}
                        hitSlop={12}
                        accessibilityRole="button"
                        accessibilityLabel={saveLabel}
                    >
                        {saving ? (
                            <ActivityIndicator size="small" color={palette.primary} />
                        ) : (
                            <Text
                                style={[
                                    Type.titleSmall,
                                    { color: saveEnabled ? palette.primary : palette.textMuted },
                                ]}
                            >
                                {saveLabel}
                            </Text>
                        )}
                    </Pressable>
                ) : (
                    <View style={{ width: 40 }} />
                )}
            </View>

            <ScrollView
                contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                <Text style={[Type.displaySmall, { color: palette.text }]}>{title}</Text>
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
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    scrollContent: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.lg,
    },
});
