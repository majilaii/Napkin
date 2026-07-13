/**
 * ListEditForm — full edit form for a list.
 * Handles: rename, toggle ranked, personal-list privacy, and delete.
 * Delete uses a destructive action sheet (Alert).
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
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useUpdateList } from '@/hooks/lists/useUpdateList';
import { useDeleteList } from '@/hooks/lists/useDeleteList';
import { ListEmojiPicker } from './ListEmojiPicker';
import type { ListDetail } from '@/hooks/lists/useList';

type Palette = typeof Colors.light;

interface Props {
    list: ListDetail;
    userId: string;
    onDone: () => void;
    onDeleted: () => void;
}

export function ListEditForm({ list, userId, onDone, onDeleted }: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;
    const insets = useSafeAreaInsets();

    const [title, setTitle] = useState(list.title);
    const [description, setDescription] = useState(list.description ?? '');
    const [ranked, setRanked] = useState(list.ranked);
    const [isPublic, setIsPublic] = useState(list.privacy === 'public');
    const [emoji, setEmoji] = useState<string | null>(list.emoji ?? null);
    const isTableList = !!list.table_id;

    const updateList = useUpdateList(userId);
    const deleteList = useDeleteList(userId);

    const isDirty =
        title.trim() !== list.title ||
        description.trim() !== (list.description ?? '') ||
        ranked !== list.ranked ||
        (!isTableList && isPublic !== (list.privacy === 'public')) ||
        emoji !== (list.emoji ?? null);

    const handleSave = () => {
        const trimmedTitle = title.trim();
        if (!trimmedTitle || trimmedTitle.length > 60) {
            Alert.alert('Invalid title', 'Name must be between 1 and 60 characters.');
            return;
        }

        updateList.mutate(
            {
                list_id: list.id,
                title: trimmedTitle,
                description: description.trim() || null,
                ranked,
                ...(!isTableList ? { privacy: isPublic ? 'public' as const : 'private' as const } : {}),
                emoji,
            },
            {
                onSuccess: () => onDone(),
                onError: () => Alert.alert("Couldn't save changes", 'Try again'),
            },
        );
    };

    const handleDelete = () => {
        Alert.alert(
            'Delete this list?',
            "This can't be undone. Your logs, wishlist, and restaurant pages are not affected.",
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => {
                        deleteList.mutate(list.id, {
                            onSuccess: () => onDeleted(),
                            onError: () => Alert.alert("Couldn't delete list", 'Try again'),
                        });
                    },
                },
            ],
        );
    };

    return (
        <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
                styles.container,
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
                    placeholder="List name"
                    placeholderTextColor={palette.textMuted}
                    maxLength={60}
                />
                <Text style={[Type.caption, { color: palette.textMuted, textAlign: 'right', marginTop: 2 }]}>
                    {title.length}/60
                </Text>
            </View>

            {/* Description */}
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
                        },
                    ]}
                    value={description}
                    onChangeText={(t) => setDescription(t.slice(0, 140))}
                    placeholder="A short description…"
                    placeholderTextColor={palette.textMuted}
                    maxLength={140}
                    multiline
                    numberOfLines={3}
                />
                <Text style={[Type.caption, { color: palette.textMuted, textAlign: 'right', marginTop: 2 }]}>
                    {description.length}/140
                </Text>
            </View>

            {/* Icon (emoji) — differentiates lists on the map */}
            <ListEmojiPicker value={emoji} onChange={setEmoji} palette={palette} />

            {/* Ranked toggle */}
            <View style={[styles.toggleRow, { borderTopColor: palette.surfaceContainerLow }]}>
                <View>
                    <Text style={[Type.titleSmall, { color: palette.text }]}>Ranked</Text>
                    <Text style={[Type.bodySmall, { color: palette.textMuted, marginTop: 2 }]}>
                        {ranked
                            ? 'Entries are numbered in order'
                            : 'Entries are shown most-recent first'}
                    </Text>
                </View>
                <Switch
                    value={ranked}
                    onValueChange={setRanked}
                    trackColor={{ false: palette.outlineVariant, true: palette.primary }}
                    thumbColor="#fff"
                />
            </View>

            {/* Table Lists are always shared with Table members and excluded from
                public discovery; only personal Lists expose a privacy switch. */}
            {isTableList ? (
                <View style={[styles.toggleRow, { borderTopColor: palette.surfaceContainerLow }]}>
                    <View style={{ flex: 1 }}>
                        <Text style={[Type.titleSmall, { color: palette.text }]}>Shared with the Table</Text>
                        <Text style={[Type.bodySmall, { color: palette.textMuted, marginTop: 2 }]}>
                            Everyone at this Table can view and add spots
                        </Text>
                    </View>
                </View>
            ) : (
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
            )}

            {/* Save */}
            <Pressable
                onPress={handleSave}
                disabled={!isDirty || updateList.isPending}
                style={({ pressed }) => [
                    styles.saveButton,
                    {
                        backgroundColor: palette.primary,
                        opacity: pressed || !isDirty || updateList.isPending ? 0.5 : 1,
                    },
                ]}
            >
                {updateList.isPending ? (
                    <ActivityIndicator size="small" color={palette.textInverse} />
                ) : (
                    <Text style={[Type.titleMedium, { color: palette.textInverse }]}>Save changes</Text>
                )}
            </Pressable>

            {/* Delete — destructive */}
            <Pressable
                onPress={handleDelete}
                disabled={deleteList.isPending}
                style={({ pressed }) => [
                    styles.deleteButton,
                    {
                        borderColor: palette.error,
                        opacity: pressed || deleteList.isPending ? 0.6 : 1,
                    },
                ]}
            >
                <Text style={[Type.titleSmall, { color: palette.error }]}>
                    Delete this list
                </Text>
            </Pressable>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.lg,
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
    saveButton: {
        paddingVertical: Spacing.md,
        borderRadius: Radius.md,
        alignItems: 'center',
        marginTop: Spacing.lg,
    },
    deleteButton: {
        paddingVertical: Spacing.md,
        borderRadius: Radius.md,
        alignItems: 'center',
        marginTop: Spacing.md,
        borderWidth: 1,
    },
});
