/**
 * ListEntryRow — a single restaurant entry inside a list detail screen.
 *
 * Shows: rank number (ranked lists), restaurant name + city/cuisine line,
 * per-entry note (if any), drag handle (owner + ranked + not reordering).
 * Tapping navigates to the standard restaurant page.
 */
import React, { useState } from 'react';
import {
    View,
    Text,
    Pressable,
    TextInput,
    StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { ListEntry } from '@/hooks/lists/useList';

type Palette = typeof Colors.light;

interface Props {
    entry: ListEntry;
    rank?: number; // undefined = unranked list
    isOwner: boolean;
    isRanked: boolean;
    isDragDisabled?: boolean;
    onPress: () => void;
    onRemove: () => void;
    onNoteChange: (note: string | null) => void;
    /** Drag handle props injected by DraggableFlatList (if present) */
    drag?: () => void;
}

export function ListEntryRow({
    entry,
    rank,
    isOwner,
    isRanked,
    isDragDisabled,
    onPress,
    onRemove,
    onNoteChange,
    drag,
}: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;

    const [editingNote, setEditingNote] = useState(false);
    const [noteText, setNoteText] = useState(entry.note ?? '');

    const r = entry.restaurant;
    const metaParts: string[] = [];
    if (r.city) metaParts.push(r.city);
    if (r.cuisine) metaParts.push(r.cuisine);
    const metaLine = metaParts.join(' · ');

    const handleNoteBlur = () => {
        setEditingNote(false);
        const trimmed = noteText.trim() || null;
        if (trimmed !== entry.note) {
            onNoteChange(trimmed);
        }
    };

    // Tap removes immediately; caller surfaces a subtle undo toast. No modal.
    const handleRemove = () => {
        onRemove();
    };

    return (
        <View style={[styles.row, { backgroundColor: palette.card }]}>
            {/* Rank number */}
            {isRanked && rank !== undefined && (
                <Text style={[styles.rank, Type.headlineItalic, { color: palette.textMuted }]}>
                    {rank}
                </Text>
            )}

            {/* Body — tappable to navigate */}
            <Pressable
                onPress={onPress}
                style={({ pressed }) => [
                    styles.body,
                    { opacity: pressed ? 0.75 : 1 },
                ]}
            >
                <Text
                    style={[Type.titleSmall, { color: palette.text }]}
                    numberOfLines={1}
                >
                    {r.name}
                </Text>
                {metaLine ? (
                    <Text style={[Type.bodySmall, { color: palette.textMuted, marginTop: 2 }]}>
                        {metaLine}
                    </Text>
                ) : null}

                {/* Note area */}
                {isOwner ? (
                    editingNote ? (
                        <TextInput
                            style={[
                                Type.bodySmall,
                                styles.noteInput,
                                { color: palette.text, borderBottomColor: palette.primary },
                            ]}
                            value={noteText}
                            onChangeText={(t) => setNoteText(t.slice(0, 140))}
                            onBlur={handleNoteBlur}
                            placeholder="Add a note…"
                            placeholderTextColor={palette.textMuted}
                            autoFocus
                            maxLength={140}
                            returnKeyType="done"
                            onSubmitEditing={handleNoteBlur}
                        />
                    ) : (
                        <Pressable onPress={() => setEditingNote(true)}>
                            <Text
                                style={[
                                    Type.bodySmall,
                                    {
                                        color: entry.note ? palette.textSecondary : palette.textMuted,
                                        marginTop: 2,
                                        fontStyle: entry.note ? 'normal' : 'italic',
                                    },
                                ]}
                                numberOfLines={2}
                            >
                                {entry.note ?? 'Add a note…'}
                            </Text>
                        </Pressable>
                    )
                ) : entry.note ? (
                    <Text
                        style={[Type.bodySmall, { color: palette.textSecondary, marginTop: 2 }]}
                        numberOfLines={2}
                    >
                        {entry.note}
                    </Text>
                ) : null}
            </Pressable>

            {/* Owner actions */}
            {isOwner && (
                <View style={styles.actions}>
                    {/* Drag handle — only for ranked lists */}
                    {isRanked && drag && (
                        <Pressable
                            onLongPress={drag}
                            disabled={isDragDisabled}
                            hitSlop={8}
                            style={{ opacity: isDragDisabled ? 0.3 : 1 }}
                        >
                            <Ionicons name="reorder-three-outline" size={22} color={palette.textMuted} />
                        </Pressable>
                    )}
                    {/* Remove */}
                    <Pressable onPress={handleRemove} hitSlop={8}>
                        <Ionicons name="close-circle-outline" size={20} color={palette.textMuted} />
                    </Pressable>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.md,
        borderRadius: Radius.md,
        gap: Spacing.md,
    },
    rank: {
        width: 24,
        textAlign: 'right',
        flexShrink: 0,
    },
    body: {
        flex: 1,
    },
    noteInput: {
        marginTop: 4,
        paddingVertical: 2,
        borderBottomWidth: 1,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        flexShrink: 0,
    },
});
