/** Full-screen creation; shares the composer with the restaurant sheet. */
import React from 'react';
import { View, Text, Pressable, ScrollView, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack, useLocalSearchParams } from 'expo-router';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { ListComposeFields, ListCreateButton } from '@/components/lists/ListComposeFields';
import { useListComposer } from '@/components/lists/useListComposer';

export default function NewListScreen() {
    const palette = Colors[useColorScheme() ?? 'light'];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();
    const { tableId, tableName } = useLocalSearchParams<{ tableId?: string; tableName?: string }>();
    const composer = useListComposer({
        userId: user?.id,
        initial: { table_id: tableId },
        onCreated: (id) => router.replace({ pathname: '/list/[id]', params: { id } }),
        onCancel: () => router.back(),
    });
    return <>
        <Stack.Screen options={{ headerShown: false, gestureEnabled: !composer.busy }} />
        <KeyboardAvoidingView style={[styles.screen, { backgroundColor: palette.background }]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top}>
            <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
                <Pressable onPress={composer.cancel} disabled={composer.busy} accessibilityRole="button"
                    accessibilityLabel="cancel new list" style={styles.back}>
                    <Ionicons name="chevron-back" size={24} color={palette.textMuted} />
                </Pressable>
                <Text style={[Type.sectionKicker, { color: palette.primary }]}>new list</Text>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
                <ListComposeFields {...composer} onChange={composer.change}
                    palette={palette} tableName={tableId ? tableName ?? 'your table' : undefined} />
            </ScrollView>
            <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
                <ListCreateButton {...composer} onPress={composer.submit} palette={palette} />
            </View>
        </KeyboardAvoidingView>
    </>;
}
const styles = StyleSheet.create({
    screen: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, gap: Spacing.sm },
    back: { width: 44, height: 44, justifyContent: 'center', marginLeft: -Spacing.sm },
    content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg },
    footer: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
});
