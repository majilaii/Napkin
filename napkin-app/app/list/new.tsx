/**
 * Full-screen list creation modal — /list/new
 * Used when user taps "Create list" from the Lists tab (has no pre-seeded restaurant).
 * Wraps CreateListSheet in a full modal screen for use from the Lists tab.
 *
 * The inline create path (from restaurant page) uses CreateListSheet directly
 * inside AddToListSheet, so this screen is only the Lists-tab entry point.
 */
import React, { useState } from 'react';
import {
    View,
    Text,
    TextInput,
    Switch,
    Pressable,
    StyleSheet,
    ScrollView,
    Alert,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useCreateList } from '@/hooks/lists/useCreateList';
import { ListEmojiPicker } from '@/components/lists';

export default function NewListScreen() {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [ranked, setRanked] = useState(false);
    const [isPublic, setIsPublic] = useState(true);
    const [showDescription, setShowDescription] = useState(false);
    const [emoji, setEmoji] = useState<string | null>(null);

    const createList = useCreateList(user?.id);

    const handleCreate = () => {
        const trimmedTitle = title.trim();
        if (!trimmedTitle) {
            Alert.alert('Title required', 'Please give your list a name.');
            return;
        }
        if (trimmedTitle.length > 60) {
            Alert.alert('Title too long', 'List name must be 60 characters or fewer.');
            return;
        }

        createList.mutate(
            {
                title: trimmedTitle,
                description: description.trim() || undefined,
                ranked,
                privacy: isPublic ? 'public' : 'private',
                emoji,
            },
            {
                onSuccess: (list) => {
                    router.replace({ pathname: '/list/[id]', params: { id: list.id } });
                },
                onError: () => Alert.alert("Couldn't create list", 'Try again'),
            },
        );
    };

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <View style={[styles.container, { backgroundColor: palette.background }]}>
                    {/* Top bar */}
                    <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
                        <Pressable onPress={() => router.back()} hitSlop={12}>
                            <Text style={[Type.body, { color: palette.primary }]}>Cancel</Text>
                        </Pressable>
                        <Text style={[Type.titleMedium, { color: palette.text }]}>New list</Text>
                        <View style={{ width: 60 }} />
                    </View>

                    <ScrollView
                        keyboardShouldPersistTaps="handled"
                        contentContainerStyle={[
                            styles.content,
                            { paddingBottom: insets.bottom + Spacing.xxl },
                        ]}
                    >
                        {/* Title */}
                        <View style={styles.field}>
                            <Text style={[Type.label, { color: palette.textMuted, marginBottom: Spacing.xs }]}>
                                Name
                            </Text>
                            <TextInput
                                style={[
                                    styles.input,
                                    Type.titleMedium,
                                    {
                                        color: palette.text,
                                        borderColor: palette.outlineVariant,
                                        backgroundColor: palette.surfaceContainerLow,
                                    },
                                ]}
                                value={title}
                                onChangeText={(t) => setTitle(t.slice(0, 60))}
                                placeholder="e.g. Best brunch SF"
                                placeholderTextColor={palette.textMuted}
                                maxLength={60}
                                autoFocus
                            />
                            <Text style={[Type.caption, { color: palette.textMuted, textAlign: 'right', marginTop: 2 }]}>
                                {title.length}/60
                            </Text>
                        </View>

                        {/* Description */}
                        {showDescription ? (
                            <View style={styles.field}>
                                <Text style={[Type.label, { color: palette.textMuted, marginBottom: Spacing.xs }]}>
                                    Description (optional)
                                </Text>
                                <TextInput
                                    style={[
                                        styles.input,
                                        Type.body,
                                        {
                                            color: palette.text,
                                            borderColor: palette.outlineVariant,
                                            backgroundColor: palette.surfaceContainerLow,
                                            minHeight: 80,
                                        },
                                    ]}
                                    value={description}
                                    onChangeText={(t) => setDescription(t.slice(0, 140))}
                                    placeholder="A short description…"
                                    placeholderTextColor={palette.textMuted}
                                    maxLength={140}
                                    multiline
                                    textAlignVertical="top"
                                />
                                <Text style={[Type.caption, { color: palette.textMuted, textAlign: 'right', marginTop: 2 }]}>
                                    {description.length}/140
                                </Text>
                            </View>
                        ) : (
                            <Pressable
                                onPress={() => setShowDescription(true)}
                                style={styles.field}
                            >
                                <Text style={[Type.bodySmall, { color: palette.primary }]}>
                                    + Add description
                                </Text>
                            </Pressable>
                        )}

                        {/* Icon (emoji) — differentiates lists on the map */}
                        <ListEmojiPicker value={emoji} onChange={setEmoji} palette={palette} />

                        {/* Ranked */}
                        <View style={[styles.toggleRow, { borderTopColor: palette.surfaceContainerLow }]}>
                            <View>
                                <Text style={[Type.titleSmall, { color: palette.text }]}>Ranked</Text>
                                <Text style={[Type.bodySmall, { color: palette.textMuted, marginTop: 2 }]}>
                                    Number entries in order
                                </Text>
                            </View>
                            <Switch
                                value={ranked}
                                onValueChange={setRanked}
                                trackColor={{ false: palette.outlineVariant, true: palette.primary }}
                                thumbColor="#fff"
                            />
                        </View>

                        {/* Privacy */}
                        <View style={[styles.toggleRow, { borderTopColor: palette.surfaceContainerLow }]}>
                            <View>
                                <Text style={[Type.titleSmall, { color: palette.text }]}>Public</Text>
                                <Text style={[Type.bodySmall, { color: palette.textMuted, marginTop: 2 }]}>
                                    {isPublic
                                        ? 'Anyone with the link can view'
                                        : 'Only you can see this list'}
                                </Text>
                            </View>
                            <Switch
                                value={isPublic}
                                onValueChange={setIsPublic}
                                trackColor={{ false: palette.outlineVariant, true: palette.primary }}
                                thumbColor="#fff"
                            />
                        </View>

                        {/* Create */}
                        <Pressable
                            onPress={handleCreate}
                            disabled={createList.isPending}
                            style={({ pressed }) => [
                                styles.createButton,
                                {
                                    backgroundColor: palette.primary,
                                    opacity: pressed || createList.isPending ? 0.7 : 1,
                                },
                            ]}
                        >
                            {createList.isPending ? (
                                <ActivityIndicator size="small" color={palette.textInverse} />
                            ) : (
                                <Text style={[Type.titleMedium, { color: palette.textInverse }]}>Create list</Text>
                            )}
                        </Pressable>
                    </ScrollView>
                </View>
            </KeyboardAvoidingView>
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    topBar: {
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    content: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.md,
    },
    field: {
        marginBottom: Spacing.lg,
    },
    input: {
        borderWidth: 1,
        borderRadius: Radius.md,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
    },
    toggleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: Spacing.md,
        borderTopWidth: 1,
        marginBottom: Spacing.sm,
    },
    createButton: {
        paddingVertical: Spacing.md,
        borderRadius: Radius.md,
        alignItems: 'center',
        marginTop: Spacing.xl,
    },
});
