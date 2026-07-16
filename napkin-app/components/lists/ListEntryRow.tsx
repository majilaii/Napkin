import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { Colors, IconSize, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SwipeToDeleteRow } from '@/components/common';
import { PressableScale } from '@/components/ui/napkin/PressableScale';
import { resolveSourcedPhoto } from '@/components/ui/PlacesCredit';
import { listRowPhotoFailureKey } from './listHeaderUtils';
import type { ListEntry } from '@/hooks/lists/useList';

type Palette = typeof Colors.light;

const THUMBNAIL_SIZE = 54;
const RANK_COLUMN_WIDTH = 17;
const ACTION_VISUAL_SIZE = IconSize.xxl;
const ACTION_MIN_TARGET = 44;
const ACTION_HIT_SLOP = (ACTION_MIN_TARGET - ACTION_VISUAL_SIZE) / 2;
const ACTION_GAP = ACTION_HIT_SLOP * 2;

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
    failedPhotoKeys?: ReadonlySet<string>;
    onPhotoError?: (failureKey: string) => void;
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
    failedPhotoKeys = new Set(),
    onPhotoError,
}: Props) {
    const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
    const palette = Colors[scheme] as Palette;
    const [editingNote, setEditingNote] = useState(false);
    const [noteText, setNoteText] = useState(entry.note ?? '');
    const submittedDraftRef = useRef<string | null | undefined>(undefined);
    const restaurant = entry.restaurant;
    const resolvedPhoto = resolveSourcedPhoto({
        url: restaurant.photo_url,
        photoSource: restaurant.photo_source,
        attributionHtml: restaurant.places_photo_attribution_html,
        restaurantName: restaurant.name,
    });
    const photoFailureKey = listRowPhotoFailureKey(entry);
    const visiblePhotoUrl = photoFailureKey && failedPhotoKeys.has(photoFailureKey)
        ? null
        : resolvedPhoto.url;

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
        <View testID="list-entry-row" style={[styles.row, { borderBottomColor: palette.dividerSoft }]}>
            {isRanked && rank !== undefined ? (
                <View style={styles.rankColumn}>
                    <Text style={[styles.rank, { color: palette.terracottaWarm }]}>{rank}</Text>
                </View>
            ) : null}

            <View style={styles.content}>
                <PressableScale onPress={onPress} haptic="light" style={styles.placeTap}>
                    <View
                        testID="list-row-thumbnail"
                        style={[styles.photo, { backgroundColor: palette.surfaceContainerHigh }]}
                    >
                        {visiblePhotoUrl ? (
                            <Image
                                source={{ uri: visiblePhotoUrl }}
                                style={StyleSheet.absoluteFillObject}
                                contentFit="cover"
                                transition={180}
                                onError={() => photoFailureKey && onPhotoError?.(photoFailureKey)}
                            />
                        ) : null}
                        <View
                            pointerEvents="none"
                            style={[StyleSheet.absoluteFillObject, styles.imageOutline, { borderColor: palette.imageOutline }]}
                        />
                    </View>

                    <View style={styles.copy}>
                        <Text
                            testID="list-row-name"
                            style={[styles.name, { color: palette.text }]}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                        >
                            {restaurant.name}
                        </Text>
                        {meta ? (
                            <Text
                                testID="list-row-meta"
                                style={[styles.meta, { color: palette.textSecondary }]}
                                numberOfLines={1}
                                ellipsizeMode="tail"
                            >
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

            <View testID="list-row-actions" style={styles.actions}>
                {isEditing && isOwner && drag ? (
                    <PressableScale
                        onLongPress={drag}
                        disabled={isDragDisabled}
                        hitSlop={ACTION_HIT_SLOP}
                        haptic="selection"
                        style={[styles.actionButton, { opacity: isDragDisabled ? 0.3 : 1 }]}
                        accessibilityRole="button"
                        accessibilityLabel={`Move ${restaurant.name}`}
                        accessibilityHint="Long press, then drag to change its position"
                    >
                        <Ionicons name="reorder-three-outline" size={IconSize.md} color={palette.textMuted} />
                    </PressableScale>
                ) : (
                    <PressableScale
                        onPress={canShowOnMap ? onShowOnMap : undefined}
                        disabled={!canShowOnMap}
                        hitSlop={ACTION_HIT_SLOP}
                        haptic="selection"
                        style={[styles.actionButton, { opacity: canShowOnMap ? 1 : 0.4 }]}
                        accessibilityRole="button"
                        accessibilityLabel={canShowOnMap ? `Show ${restaurant.name} on map` : `${restaurant.name} has no map location`}
                        accessibilityState={{ disabled: !canShowOnMap }}
                    >
                        <Ionicons name="locate-outline" size={IconSize.md} color={palette.secondary} />
                    </PressableScale>
                )}

                {isEditing && isOwner ? (
                    <PressableScale
                        onPress={onRemove}
                        hitSlop={ACTION_HIT_SLOP}
                        haptic="medium"
                        style={styles.actionButton}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${restaurant.name} from this list`}
                    >
                        <Ionicons name="trash-outline" size={IconSize.md} color={palette.error} />
                    </PressableScale>
                ) : onToggleWishlist ? (
                    <PressableScale
                        onPress={onToggleWishlist}
                        disabled={isWishlistPending}
                        hitSlop={ACTION_HIT_SLOP}
                        haptic="medium"
                        style={[styles.actionButton, { opacity: isWishlistPending ? 0.5 : 1 }]}
                        accessibilityRole="button"
                        accessibilityLabel={isWishlisted
                            ? `Remove ${restaurant.name} from Wishlist`
                            : `Save ${restaurant.name} to Wishlist`}
                        accessibilityState={{ selected: !!isWishlisted, disabled: isWishlistPending }}
                    >
                        <Ionicons
                            name={isWishlisted ? 'heart' : 'heart-outline'}
                            size={IconSize.md}
                            color={palette.primary}
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
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: Spacing.sm,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    rankColumn: {
        width: RANK_COLUMN_WIDTH,
        height: THUMBNAIL_SIZE,
        alignItems: 'flex-end',
        justifyContent: 'center',
    },
    rank: {
        ...Type.label,
        lineHeight: 16,
        letterSpacing: 0,
        textTransform: 'none',
        fontVariant: ['tabular-nums'],
    },
    content: {
        flex: 1,
        minWidth: 0,
    },
    placeTap: {
        minHeight: THUMBNAIL_SIZE,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    photo: {
        width: THUMBNAIL_SIZE,
        height: THUMBNAIL_SIZE,
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
        minHeight: THUMBNAIL_SIZE,
        justifyContent: 'center',
    },
    name: {
        ...Type.editorialBody,
        fontSize: 16.5,
        lineHeight: 20,
        letterSpacing: -0.1,
    },
    meta: {
        ...Type.metadata,
        marginTop: 2,
    },
    noteTarget: {
        minHeight: 40,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        marginLeft: THUMBNAIL_SIZE + Spacing.sm,
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
        marginLeft: THUMBNAIL_SIZE + Spacing.sm,
        marginTop: 4,
    },
    noteInput: {
        minHeight: 40,
        borderRadius: Radius.md,
        paddingHorizontal: 10,
        paddingVertical: 8,
        marginTop: 6,
        marginLeft: THUMBNAIL_SIZE + Spacing.sm,
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
    },
    actions: {
        minHeight: ACTION_MIN_TARGET,
        flexDirection: 'row',
        alignItems: 'center',
        gap: ACTION_GAP,
        paddingHorizontal: ACTION_HIT_SLOP,
        paddingVertical: ACTION_HIT_SLOP,
        marginHorizontal: -ACTION_HIT_SLOP,
        marginTop: (THUMBNAIL_SIZE - ACTION_MIN_TARGET) / 2,
    },
    actionButton: {
        width: ACTION_VISUAL_SIZE,
        height: ACTION_VISUAL_SIZE,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
