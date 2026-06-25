/**
 * ProfileTopFourSheet — editor for the curated profile Top 4.
 *
 * Global (not city-scoped). Up to 4 ordered slots — drag-and-drop to reorder
 * (long-press a row and drag), × to remove. During editing it's words-only: a
 * numbered list of spot names, no thumbnails.
 * "+ add a spot" opens TopFourSearchModal — a full-screen Google Places search;
 * any restaurant is featurable, logged or not (a ghost is upserted to mint an
 * id first). Save → useSetProfileTopFour. Saving with 0 picks clears the override
 * and the profile reverts to the auto-derived list.
 */
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
    View,
    Text,
    Modal,
    Pressable,
    StyleSheet,
    Alert,
    ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSetProfileTopFour } from '@/hooks/users/useSetProfileTopFour';
import { TopFourSearchScreen, type TopFourSearchPick } from './TopFourSearchScreen';

export interface ProfileTopFourPick {
    restaurant_id: string;
    name: string;
    photo_url: string | null;
}

interface DraftItem {
    key: string;
    restaurant_id: string;
    name: string;
    photo_url: string | null;
}

interface Props {
    visible: boolean;
    onClose: () => void;
    userId: string | null | undefined;
    currentPicks: ProfileTopFourPick[];
}

// ── Draggable slot ───────────────────────────────────────────────────────────

interface SlotItemProps {
    item: DraftItem;
    index: number;
    drag: () => void;
    isActive: boolean;
    palette: typeof Colors.light;
    onRemove: (id: string) => void;
}

function SlotItem({ item, index, drag, isActive, palette, onRemove }: SlotItemProps) {
    return (
        <ScaleDecorator>
            {/* Whole row is the drag handle — long-press and drag to reorder. */}
            <Pressable
                onLongPress={drag}
                delayLongPress={150}
                disabled={isActive}
                style={[
                    styles.slotRow,
                    {
                        backgroundColor: isActive ? palette.surfaceContainerLow : palette.card,
                        borderColor: palette.dividerSoft,
                    },
                ]}
                accessibilityLabel={`${item.name}, position ${index + 1}. Long-press and drag to reorder.`}
            >
                <Text
                    style={[
                        Type.rating,
                        { fontFamily: 'Manrope_700Bold', fontSize: 18, color: palette.textMuted, width: 24, textAlign: 'center' },
                    ]}
                >
                    {index + 1}
                </Text>

                <Text
                    style={[
                        Type.headlineItalic,
                        { fontFamily: 'Newsreader_400Regular_Italic', fontStyle: 'italic', fontSize: 17, color: palette.text, flex: 1 },
                    ]}
                    numberOfLines={1}
                >
                    {item.name}
                </Text>

                <Pressable
                    onPress={() => onRemove(item.restaurant_id)}
                    hitSlop={8}
                    style={styles.slotCtl}
                    accessibilityLabel={`Remove ${item.name}`}
                >
                    <Ionicons name="close" size={20} color={palette.textMuted} />
                </Pressable>
            </Pressable>
        </ScaleDecorator>
    );
}

// ── Sheet ────────────────────────────────────────────────────────────────────

export function ProfileTopFourSheet({ visible, onClose, userId, currentPicks }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();

    const setPicks = useSetProfileTopFour();

    const [draft, setDraft] = useState<DraftItem[]>([]);
    const [searchVisible, setSearchVisible] = useState(false);

    // Reset the draft only on the closed→open transition, so a profile refetch
    // (new currentPicks identity) can't clobber an in-progress edit.
    const wasVisible = useRef(false);
    useEffect(() => {
        if (visible && !wasVisible.current) {
            setDraft(
                currentPicks.map((p) => ({
                    key: p.restaurant_id,
                    restaurant_id: p.restaurant_id,
                    name: p.name,
                    photo_url: p.photo_url,
                })),
            );
        }
        wasVisible.current = visible;
    }, [visible, currentPicks]);

    const pickedIds = useMemo(() => new Set(draft.map((d) => d.restaurant_id)), [draft]);

    const hasDiff = useMemo(() => {
        if (draft.length !== currentPicks.length) return true;
        return draft.some((d, i) => d.restaurant_id !== currentPicks[i]?.restaurant_id);
    }, [draft, currentPicks]);

    const handleAdd = useCallback((pick: TopFourSearchPick) => {
        setDraft((prev) => {
            if (prev.length >= 4) return prev;
            if (prev.some((d) => d.restaurant_id === pick.restaurant_id)) return prev;
            return [
                ...prev,
                {
                    key: pick.restaurant_id,
                    restaurant_id: pick.restaurant_id,
                    name: pick.name,
                    photo_url: pick.photo_url,
                },
            ];
        });
    }, []);

    const handleRemove = useCallback((id: string) => {
        setDraft((prev) => prev.filter((d) => d.restaurant_id !== id));
    }, []);

    const handleSave = useCallback(() => {
        if (!hasDiff) return;
        const picks = draft.map((d, i) => ({
            position: (i + 1) as 1 | 2 | 3 | 4,
            restaurant_id: d.restaurant_id,
        }));
        setPicks.mutate(picks, {
            onSuccess: onClose,
            onError: () => Alert.alert('Could not save', 'Please try again.'),
        });
    }, [hasDiff, draft, setPicks, onClose]);

    const handleCancel = useCallback(() => {
        if (hasDiff) {
            Alert.alert('Discard changes?', 'Your edits will be lost.', [
                { text: 'Keep editing', style: 'cancel' },
                { text: 'Discard', style: 'destructive', onPress: onClose },
            ]);
        } else {
            onClose();
        }
    }, [hasDiff, onClose]);

    const isPending = setPicks.isPending;
    const atCapacity = draft.length >= 4;

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={searchVisible ? () => setSearchVisible(false) : handleCancel}
        >
            {searchVisible ? (
                <TopFourSearchScreen
                    onClose={() => setSearchVisible(false)}
                    onPick={handleAdd}
                    userId={userId}
                    pickedIds={pickedIds}
                    atCapacity={atCapacity}
                />
            ) : (
            <View style={[styles.container, { backgroundColor: palette.background }]}>
                {/* Header */}
                <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
                    <Pressable onPress={handleCancel} hitSlop={8}>
                        <Text style={[Type.body, { color: palette.textMuted }]}>Cancel</Text>
                    </Pressable>
                    <Text
                        style={[
                            Type.headlineItalic,
                            { fontFamily: 'Newsreader_400Regular_Italic', fontStyle: 'italic', fontSize: 18, color: palette.text },
                        ]}
                    >
                        Top 4
                    </Text>
                    <Pressable onPress={handleSave} hitSlop={8} disabled={!hasDiff || isPending}>
                        {isPending ? (
                            <ActivityIndicator color={palette.primary} size="small" />
                        ) : (
                            <Text
                                style={[
                                    Type.body,
                                    { color: hasDiff ? palette.primary : palette.textMuted, fontFamily: 'Manrope_700Bold' },
                                ]}
                            >
                                Save
                            </Text>
                        )}
                    </Pressable>
                </View>

                {/* Subtitle */}
                <Text
                    style={[
                        Type.bodySmall,
                        {
                            color: palette.textMuted,
                            fontFamily: 'Newsreader_400Regular_Italic',
                            fontStyle: 'italic',
                            marginHorizontal: 22,
                            marginBottom: Spacing.sm,
                        },
                    ]}
                >
                    Pick up to 4 and long-press a row to drag it into order. Leave it empty to go back to automatic.
                </Text>

                {/* Draft slots */}
                <View style={[styles.slotsSection, { borderBottomColor: palette.dividerSoft }]}>
                    {draft.length === 0 ? (
                        <View style={styles.emptyDraft}>
                            <Text style={[Type.bodySmall, { color: palette.textMuted }]}>
                                Add up to four favourites below
                            </Text>
                        </View>
                    ) : (
                        // Own GestureHandlerRootView — draggable-flatlist needs one
                        // INSIDE the Modal (the app-root one doesn't reach here). It
                        // MUST have an explicit height: a draggable FlatList in an
                        // auto-height parent collapses to 0 and renders NOTHING — that
                        // was the "4 selected but no rows / can't delete" bug. Bound it
                        // to the row count (each SlotItem ≈ 64px tall).
                        <GestureHandlerRootView style={{ height: draft.length * 64 }}>
                            <DraggableFlatList
                                data={draft}
                                onDragEnd={({ data }) => setDraft(data)}
                                keyExtractor={(item) => item.key}
                                renderItem={({ item, drag, isActive, getIndex }) => (
                                    <SlotItem
                                        item={item}
                                        index={getIndex() ?? 0}
                                        drag={drag}
                                        isActive={isActive}
                                        palette={palette}
                                        onRemove={handleRemove}
                                    />
                                )}
                                scrollEnabled={false}
                                activationDistance={12}
                            />
                        </GestureHandlerRootView>
                    )}

                    <Text
                        style={[Type.labelSmall, { color: palette.textMuted, margin: Spacing.sm, textAlign: 'center' }]}
                    >
                        {draft.length} / 4 selected
                    </Text>
                </View>

                {/* Add a spot — opens the full-screen Places search */}
                <Pressable
                    onPress={() => setSearchVisible(true)}
                    style={({ pressed }) => [
                        styles.addBtn,
                        {
                            borderColor: 'rgba(160,63,40,0.35)',
                            backgroundColor: pressed ? palette.primaryMuted : 'transparent',
                        },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Add a spot to your Top 4"
                >
                    <Ionicons name="search" size={18} color={palette.primary} />
                    <Text style={[styles.addBtnLabel, { color: palette.primary }]}>
                        {atCapacity ? 'swap a spot' : 'add a spot'}
                    </Text>
                </Pressable>
            </View>
            )}
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 22,
        paddingBottom: Spacing.sm,
    },
    slotsSection: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        marginHorizontal: 22,
        paddingBottom: Spacing.xs,
    },
    slotRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: Spacing.sm,
        paddingLeft: Spacing.md,
        paddingRight: Spacing.xs,
        minHeight: 56,
        borderRadius: Radius.sm,
        borderBottomWidth: StyleSheet.hairlineWidth,
        gap: Spacing.sm,
        marginBottom: 4,
        ...Shadow.clip,
    },
    slotCtl: {
        width: 40,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyDraft: {
        paddingVertical: Spacing.md,
        alignItems: 'center',
    },
    addBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        marginHorizontal: 22,
        marginTop: Spacing.lg,
        height: 48,
        borderRadius: Radius.full,
        borderWidth: 1,
    },
    addBtnLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 14,
        letterSpacing: 0.3,
    },
});
