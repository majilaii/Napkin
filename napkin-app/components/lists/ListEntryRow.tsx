import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SwipeToDeleteRow } from '@/components/common';
import { PressableScale } from '@/components/ui/napkin/PressableScale';
import type { ListEntry } from '@/hooks/lists/useList';

type Palette = typeof Colors.light;

interface Props {
    entry: ListEntry;
    rank?: number;
    isOwner: boolean;
    isEditing: boolean;
    isRanked: boolean;
    isDragDisabled?: boolean;
    isWishlisted?: boolean;
    isWishlistPending?: boolean;
    canShowOnMap?: boolean;
    onPress: () => void;
    onShowOnMap: () => void;
    onRemove: () => void;
    onNoteChange: (note: string | null) => void;
    onToggleWishlist?: () => void;
    drag?: () => void;
}

export function ListEntryRow({
    entry,
    rank,
    isOwner,
    isEditing,
    isRanked,
    isDragDisabled,
    isWishlisted,
    isWishlistPending = false,
    canShowOnMap = true,
    onPress,
    onShowOnMap,
    onRemove,
    onNoteChange,
    onToggleWishlist,
    drag,
}: Props) {
    const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
    const palette = Colors[scheme] as Palette;
    const [editingNote, setEditingNote] = useState(false);
    const [noteText, setNoteText] = useState(entry.note ?? '');
    const submittedDraftRef = useRef<string | null | undefined>(undefined);
    const restaurant = entry.restaurant;

    useEffect(() => {
        setNoteText(entry.note ?? '');
        submittedDraftRef.current = undefined;
    }, [entry.note]);

    const meta = [
        restaurant.cuisine,
        restaurant.city,
        restaurant.price_level ? '$'.repeat(Math.min(4, Math.max(1, restaurant.price_level))) : null,
    ].filter(Boolean).join(' · ');

    const commitNote = useCallback(() => {
        setEditingNote(false);
        const next = noteText.trim() || null;
        if (next !== entry.note && submittedDraftRef.current !== next) {
            submittedDraftRef.current = next;
            onNoteChange(next);
        }
    }, [entry.note, noteText, onNoteChange]);

    useEffect(() => {
        if (!isEditing && editingNote) commitNote();
    }, [commitNote, editingNote, isEditing]);

    const row = (
        <View style={[styles.row, { borderBottomColor: palette.dividerSoft }]}>
            {isRanked && rank !== undefined ? (
                <View style={styles.rankColumn}>
                    <Text style={[styles.rank, { color: palette.primary }]}>{String(rank).padStart(2, '0')}</Text>
                    {isEditing && isOwner && drag ? (
                        <PressableScale
                            onLongPress={drag}
                            disabled={isDragDisabled}
                            hitSlop={8}
                            haptic="selection"
                            style={[styles.editTarget, { opacity: isDragDisabled ? 0.3 : 1 }]}
                            accessibilityRole="button"
                            accessibilityLabel={`Move ${restaurant.name}`}
                            accessibilityHint="Long press, then drag to change its position"
                        >
                            <Ionicons name="reorder-three-outline" size={20} color={palette.textMuted} />
                        </PressableScale>
                    ) : null}
                </View>
            ) : null}

            <View style={styles.content}>
                <PressableScale onPress={onPress} haptic="light" style={styles.placeTap}>
                    <View style={[styles.photo, { backgroundColor: palette.surfaceContainerHigh }]}>
                        {restaurant.photo_url ? (
                            <Image
                                source={{ uri: restaurant.photo_url }}
                                style={StyleSheet.absoluteFillObject}
                                contentFit="cover"
                                transition={180}
                            />
                        ) : (
                            <Ionicons name="restaurant-outline" size={21} color={palette.textMuted} />
                        )}
                        <View
                            pointerEvents="none"
                            style={[StyleSheet.absoluteFillObject, styles.imageOutline, { borderColor: palette.imageOutline }]}
                        />
                    </View>

                    <View style={styles.copy}>
                        <Text style={[styles.name, { color: palette.text }]} numberOfLines={2}>
                            {restaurant.name}
                        </Text>
                        {meta ? (
                            <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={2}>
                                {meta}
                            </Text>
                        ) : null}
                    </View>
                </PressableScale>

                {isEditing && isOwner ? (
                    editingNote ? (
                        <TextInput
                            value={noteText}
                            onChangeText={(text) => setNoteText(text.slice(0, 140))}
                            onBlur={commitNote}
                            onSubmitEditing={commitNote}
                            autoFocus
                            returnKeyType="done"
                            maxLength={140}
                            placeholder="Add a note…"
                            placeholderTextColor={palette.textMuted}
                            style={[styles.noteInput, { color: palette.text, backgroundColor: palette.surfaceContainerLow }]}
                        />
                    ) : (
                        <PressableScale
                            onPress={() => setEditingNote(true)}
                            style={styles.noteTarget}
                            accessibilityRole="button"
                            accessibilityLabel={entry.note ? `Edit note for ${restaurant.name}` : `Add a note to ${restaurant.name}`}
                        >
                            <Ionicons name="create-outline" size={14} color={palette.textMuted} />
                            <Text
                                style={[styles.noteText, styles.note, { color: entry.note ? palette.textSecondary : palette.textMuted }]}
                                numberOfLines={2}
                            >
                                {entry.note ?? 'Add note'}
                            </Text>
                        </PressableScale>
                    )
                ) : entry.note ? (
                    <Text style={[styles.noteText, styles.readNote, { color: palette.textSecondary }]} numberOfLines={2}>
                        — {entry.note}
                    </Text>
                ) : null}
            </View>

            <View style={styles.trailing}>
                <PressableScale
                    onPress={canShowOnMap ? onShowOnMap : undefined}
                    disabled={!canShowOnMap}
                    haptic="selection"
                    style={[
                        styles.iconButton,
                        {
                            backgroundColor: palette.surfaceContainerLow,
                            opacity: canShowOnMap ? 1 : 0.4,
                        },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={canShowOnMap ? `Show ${restaurant.name} on map` : `${restaurant.name} has no map location`}
                    accessibilityState={{ disabled: !canShowOnMap }}
                >
                    <Ionicons name="locate-outline" size={19} color={palette.primary} />
                </PressableScale>

                {isEditing && isOwner ? (
                    <PressableScale
                        onPress={onRemove}
                        haptic="medium"
                        style={[styles.iconButton, { backgroundColor: palette.primaryMuted }]}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${restaurant.name} from this list`}
                    >
                        <Ionicons name="trash-outline" size={18} color={palette.error} />
                    </PressableScale>
                ) : onToggleWishlist ? (
                    <PressableScale
                        onPress={onToggleWishlist}
                        disabled={isWishlistPending}
                        haptic="medium"
                        style={[
                            styles.iconButton,
                            {
                                backgroundColor: isWishlisted
                                    ? palette.primaryMuted
                                    : palette.surfaceContainerLow,
                                opacity: isWishlistPending ? 0.5 : 1,
                            },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={isWishlisted
                            ? `Remove ${restaurant.name} from Wishlist`
                            : `Save ${restaurant.name} to Wishlist`}
                        accessibilityState={{ selected: isWishlisted, disabled: isWishlistPending }}
                    >
                        <Ionicons
                            name={isWishlisted ? 'heart' : 'heart-outline'}
                            size={18}
                            color={isWishlisted ? palette.primary : palette.textMuted}
                        />
                    </PressableScale>
                ) : null}
            </View>
        </View>
    );

    return (
        <SwipeToDeleteRow enabled={isOwner && isEditing && !isDragDisabled} onDelete={onRemove}>
            {row}
        </SwipeToDeleteRow>
    );
}

const styles = StyleSheet.create({
    row: {
        minHeight: 104,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: Spacing.sm,
        paddingHorizontal: Spacing.md,
        paddingVertical: 8,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    rankColumn: {
        width: 28,
        alignItems: 'center',
        gap: 4,
        paddingTop: 2,
    },
    rank: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 17,
        fontVariant: ['tabular-nums'],
    },
    editTarget: {
        width: 44,
        height: 44,
        marginHorizontal: -8,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
    content: {
        flex: 1,
        minWidth: 0,
    },
    placeTap: {
        minHeight: 72,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
    },
    photo: {
        width: 64,
        height: 72,
        borderRadius: Radius.md,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    imageOutline: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: Radius.md,
    },
    copy: {
        flex: 1,
        minWidth: 0,
        paddingTop: 2,
    },
    name: {
        fontFamily: 'Newsreader_700Bold',
        fontSize: 18,
        lineHeight: 21,
        letterSpacing: -0.15,
    },
    meta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        lineHeight: 16,
        marginTop: 4,
    },
    noteTarget: {
        minHeight: 40,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        marginLeft: 74,
    },
    noteText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
        lineHeight: 17,
    },
    note: {
        flex: 1,
    },
    readNote: {
        marginLeft: 74,
        marginTop: 4,
    },
    noteInput: {
        minHeight: 40,
        borderRadius: Radius.md,
        paddingHorizontal: 10,
        paddingVertical: 8,
        marginTop: 6,
        marginLeft: 74,
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
    trailing: {
        width: 44,
        alignItems: 'center',
        gap: 0,
    },
    iconButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
