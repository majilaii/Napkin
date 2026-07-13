import React, { useState } from 'react';
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
    isRanked: boolean;
    isDragDisabled?: boolean;
    isPinned?: boolean;
    onPress: () => void;
    onRemove: () => void;
    onNoteChange: (note: string | null) => void;
    onPinToWishlist?: () => void;
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
    const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
    const palette = Colors[scheme] as Palette;
    const [editingNote, setEditingNote] = useState(false);
    const [noteText, setNoteText] = useState(entry.note ?? '');
    const restaurant = entry.restaurant;

    const meta = [
        restaurant.cuisine,
        restaurant.city,
        restaurant.price_level ? '$'.repeat(Math.min(4, Math.max(1, restaurant.price_level))) : null,
    ].filter(Boolean).join(' · ');

    const commitNote = () => {
        setEditingNote(false);
        const next = noteText.trim() || null;
        if (next !== entry.note) onNoteChange(next);
    };

    const row = (
        <View style={[styles.row, { borderBottomColor: palette.dividerSoft }]}>
            {isRanked && rank !== undefined ? (
                <View style={styles.rankColumn}>
                    <Text style={[styles.rank, { color: palette.primary }]}>{String(rank).padStart(2, '0')}</Text>
                    {isOwner && drag ? (
                        <PressableScale
                            onLongPress={drag}
                            disabled={isDragDisabled}
                            haptic="selection"
                            style={[styles.iconTarget, { opacity: isDragDisabled ? 0.3 : 1 }]}
                            accessibilityRole="button"
                            accessibilityLabel={`Move ${restaurant.name}`}
                        >
                            <Ionicons name="reorder-three-outline" size={21} color={palette.textMuted} />
                        </PressableScale>
                    ) : null}
                </View>
            ) : null}

            <View style={styles.content}>
                <PressableScale onPress={onPress} haptic="light" style={styles.placeTap}>
                    <View
                        style={[
                            styles.photo,
                            { backgroundColor: palette.surfaceContainerHigh },
                            restaurant.photo_url && {
                                borderWidth: StyleSheet.hairlineWidth,
                                borderColor: scheme === 'dark'
                                    ? 'rgba(255, 255, 255, 0.1)'
                                    : 'rgba(0, 0, 0, 0.1)',
                            },
                        ]}
                    >
                        {restaurant.photo_url ? (
                            <Image
                                source={{ uri: restaurant.photo_url }}
                                style={StyleSheet.absoluteFillObject}
                                contentFit="cover"
                                transition={180}
                            />
                        ) : (
                            <Ionicons name="restaurant-outline" size={22} color={palette.textMuted} />
                        )}
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

                {isOwner ? (
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
                            accessibilityLabel={entry.note ? 'Edit note' : 'Add a note'}
                        >
                            <Text
                                style={[styles.note, { color: entry.note ? palette.textSecondary : palette.textMuted }]}
                                numberOfLines={3}
                            >
                                {entry.note ? `— ${entry.note}` : 'add a note…'}
                            </Text>
                        </PressableScale>
                    )
                ) : entry.note ? (
                    <Text style={[styles.note, { color: palette.textSecondary }]} numberOfLines={3}>
                        — {entry.note}
                    </Text>
                ) : null}
            </View>

            <View style={styles.trailing}>
                {onPinToWishlist ? (
                    <PressableScale
                        onPress={isPinned ? undefined : onPinToWishlist}
                        disabled={isPinned}
                        haptic="medium"
                        style={[
                            styles.pinButton,
                            {
                                backgroundColor: isPinned
                                    ? palette.secondaryContainer
                                    : palette.primaryMuted,
                            },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={isPinned ? `${restaurant.name} is pinned` : `Pin ${restaurant.name} to wishlist`}
                    >
                        <Ionicons
                            name={isPinned ? 'checkmark' : 'add'}
                            size={21}
                            color={isPinned ? palette.text : palette.primary}
                        />
                    </PressableScale>
                ) : null}

                {isOwner ? (
                    <PressableScale
                        onPress={onRemove}
                        haptic="light"
                        style={[styles.iconTarget, { backgroundColor: palette.surfaceContainerLow }]}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${restaurant.name} from list`}
                    >
                        <Ionicons name="close" size={18} color={palette.textMuted} />
                    </PressableScale>
                ) : null}
            </View>
        </View>
    );

    return (
        <SwipeToDeleteRow enabled={isOwner && !isDragDisabled} onDelete={onRemove}>
            {row}
        </SwipeToDeleteRow>
    );
}

const styles = StyleSheet.create({
    row: {
        minHeight: 126,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.md,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    rankColumn: {
        width: 34,
        alignItems: 'center',
        gap: 8,
        paddingTop: 2,
    },
    rank: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 18,
        fontVariant: ['tabular-nums'],
    },
    content: {
        flex: 1,
        minWidth: 0,
    },
    placeTap: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
    },
    photo: {
        width: 78,
        height: 92,
        borderRadius: Radius.md,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    copy: {
        flex: 1,
        minWidth: 0,
        paddingTop: 3,
    },
    name: {
        fontFamily: 'Newsreader_700Bold',
        fontSize: 19,
        lineHeight: 23,
        letterSpacing: -0.2,
    },
    meta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        lineHeight: 17,
        marginTop: 5,
    },
    noteTarget: {
        minHeight: 40,
        justifyContent: 'center',
        marginLeft: 90,
    },
    note: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13.5,
        lineHeight: 18,
    },
    noteInput: {
        minHeight: 40,
        borderRadius: Radius.sm,
        paddingHorizontal: 10,
        paddingVertical: 8,
        marginTop: 7,
        marginLeft: 90,
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
    trailing: {
        width: 44,
        alignItems: 'center',
        gap: 8,
    },
    pinButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },
    iconTarget: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
