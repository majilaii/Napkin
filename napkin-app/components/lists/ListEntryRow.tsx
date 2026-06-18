/**
 * ListEntryRow — a single restaurant entry inside a list detail screen.
 *
 * Shows: rank number (ranked lists), restaurant name + city/cuisine line,
 * quiet `pin to wishlist` affordance (or `pinned` tag when already on the
 * wishlist — TICKET-074: a spot can live in both; lists never feed Tables),
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

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { ListEntry } from '@/hooks/lists/useList';

type Palette = typeof Colors.light;

interface Props {
    entry: ListEntry;
    rank?: number; // undefined = unranked list
    isOwner: boolean;
    isRanked: boolean;
    isDragDisabled?: boolean;
    /**
     * TICKET-074 fix-pass: viewer-scoped "already on MY wishlist" flag, derived
     * ONCE by the screen from the cached personal wishlist (derivePinnedIds) —
     * replaces a per-row useIsWishlisted edge call (O(rows) request burst).
     */
    isPinned?: boolean;
    onPress: () => void;
    onRemove: () => void;
    onNoteChange: (note: string | null) => void;
    /** TICKET-074: add this entry's restaurant to the caller's wishlist. */
    onPinToWishlist?: () => void;
    /** Drag handle props injected by DraggableFlatList (if present) */
    drag?: () => void;
}

export function ListEntryRow({
    entry,
    rank,
    isOwner,
    isRanked,
    isDragDisabled,
    isPinned,
    onPress,
    onRemove,
    onNoteChange,
    onPinToWishlist,
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
        <View style={[styles.row, { backgroundColor: palette.card }, Shadow.subtle]}>
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
                    style={[styles.name, { color: palette.text }]}
                    numberOfLines={1}
                >
                    {r.name}
                </Text>
                {metaLine ? (
                    <Text style={[Type.bodySmall, { color: palette.textMuted, marginTop: 2 }]}>
                        {metaLine}
                    </Text>
                ) : null}

                {/* Quiet wishlist affordance (TICKET-074) */}
                {isPinned ? (
                    <Text style={[styles.pinTag, { color: palette.textMuted }]}>
                        pinned
                    </Text>
                ) : onPinToWishlist ? (
                    <Pressable onPress={onPinToWishlist} hitSlop={8}>
                        <Text style={[styles.pinAffordance, { color: palette.primary }]}>
                            pin to wishlist
                        </Text>
                    </Pressable>
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
                    ) : entry.note ? (
                        <Pressable onPress={() => setEditingNote(true)}>
                            <Text
                                style={[styles.noteQuote, { color: palette.textSecondary }]}
                                numberOfLines={3}
                            >
                                {`— ${entry.note}`}
                            </Text>
                        </Pressable>
                    ) : (
                        <Pressable onPress={() => setEditingNote(true)}>
                            <Text
                                style={[
                                    Type.bodySmall,
                                    { color: palette.textMuted, marginTop: 4, fontStyle: 'italic' },
                                ]}
                            >
                                add a note…
                            </Text>
                        </Pressable>
                    )
                ) : entry.note ? (
                    <Text
                        style={[styles.noteQuote, { color: palette.textSecondary }]}
                        numberOfLines={3}
                    >
                        {`— ${entry.note}`}
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
    name: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 17,
        lineHeight: 21,
    },
    noteQuote: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
        lineHeight: 19,
        marginTop: 5,
    },
    noteInput: {
        marginTop: 4,
        paddingVertical: 2,
        borderBottomWidth: 1,
    },
    pinAffordance: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 1.0,
        textTransform: 'lowercase',
        marginTop: 6,
    },
    pinTag: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11,
        letterSpacing: 1.0,
        textTransform: 'lowercase',
        marginTop: 6,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        flexShrink: 0,
    },
});
