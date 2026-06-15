/**
 * ProfileTopFourSheet — full-screen editor for the curated profile Top 4.
 *
 * Global (not city-scoped). Top: up to 4 ordered slots (DraggableFlatList to
 * reorder, × to remove). Below: every restaurant the user has logged, tap to add.
 * Save → useSetProfileTopFour. Saving with 0 picks clears the override and the
 * profile reverts to the auto-derived list.
 *
 * Mirrors EditTopFourSheet (TICKET-047) minus the claim-a-city machinery.
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
    ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image as ExpoImage } from 'expo-image';
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useMyEligibleRestaurants } from '@/hooks/users/useMyEligibleRestaurants';
import { useSetProfileTopFour } from '@/hooks/users/useSetProfileTopFour';
import { EligibleRestaurantRow } from '@/components/top-fours/EligibleRestaurantRow';
import type { EligibleRestaurant } from '@/hooks/top-fours/useEligibleRestaurantsForCity';

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
            <Pressable
                onLongPress={drag}
                disabled={isActive}
                style={[
                    styles.slotRow,
                    {
                        backgroundColor: isActive ? palette.surfaceContainerLow : palette.card,
                        borderColor: palette.dividerSoft,
                    },
                ]}
            >
                <Text style={[Type.rating, { fontSize: 18, color: palette.textMuted, width: 20, textAlign: 'center' }]}>
                    {index + 1}
                </Text>

                {/* Thumb — photo when present, else blank warm tile (no letter) */}
                <View style={[styles.slotThumb, { backgroundColor: palette.surfaceJournalHi, borderRadius: Radius.sm }]}>
                    {item.photo_url ? (
                        <ExpoImage
                            source={{ uri: item.photo_url }}
                            style={StyleSheet.absoluteFill}
                            contentFit="cover"
                        />
                    ) : null}
                </View>

                <Text
                    style={[
                        Type.headlineItalic,
                        { fontFamily: 'Newsreader_400Regular_Italic', fontStyle: 'italic', fontSize: 15, color: palette.text, flex: 1 },
                    ]}
                    numberOfLines={1}
                >
                    {item.name}
                </Text>

                <Text style={[Type.caption, { color: palette.textMuted, marginRight: Spacing.sm }]}>⠿</Text>

                <Pressable onPress={() => onRemove(item.restaurant_id)} hitSlop={8} accessibilityLabel={`Remove ${item.name}`}>
                    <Text style={[Type.caption, { color: palette.textMuted, fontSize: 18 }]}>×</Text>
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
    const { data: eligible, isLoading: eligibleLoading } = useMyEligibleRestaurants(userId, visible);

    const [draft, setDraft] = useState<DraftItem[]>([]);

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

    const handleAdd = useCallback((restaurant: EligibleRestaurant) => {
        if (pickedIds.has(restaurant.restaurant_id)) return;
        if (draft.length >= 4) return;
        setDraft((prev) => [
            ...prev,
            {
                key: restaurant.restaurant_id,
                restaurant_id: restaurant.restaurant_id,
                name: restaurant.name,
                photo_url: restaurant.photo_url,
            },
        ]);
    }, [pickedIds, draft.length]);

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

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCancel}>
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
                    Pick up to 4 and drag to reorder. Leave it empty to go back to automatic.
                </Text>

                {/* Draft slots (draggable) */}
                <View style={[styles.slotsSection, { borderBottomColor: palette.dividerSoft }]}>
                    {draft.length === 0 ? (
                        <View style={styles.emptyDraft}>
                            <Text style={[Type.bodySmall, { color: palette.textMuted }]}>
                                Tap restaurants below to add them
                            </Text>
                        </View>
                    ) : (
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
                            containerStyle={{ maxHeight: 4 * 60 }}
                        />
                    )}

                    <Text
                        style={[Type.labelSmall, { color: palette.textMuted, margin: Spacing.sm, textAlign: 'center' }]}
                    >
                        {draft.length} / 4 selected
                    </Text>
                </View>

                {/* Eligible restaurants list */}
                <Text
                    style={[Type.labelSmall, { color: palette.textMuted, marginHorizontal: 22, marginTop: Spacing.md, marginBottom: Spacing.xs }]}
                >
                    YOUR LOGGED SPOTS
                </Text>

                {eligibleLoading ? (
                    <ActivityIndicator color={palette.primary} style={{ marginTop: Spacing.xl }} />
                ) : (
                    <ScrollView
                        style={{ flex: 1 }}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
                    >
                        {(eligible ?? []).map((r) => (
                            <EligibleRestaurantRow
                                key={r.restaurant_id}
                                restaurant={r}
                                isSelected={pickedIds.has(r.restaurant_id)}
                                onPress={
                                    draft.length < 4 || pickedIds.has(r.restaurant_id) ? handleAdd : () => {}
                                }
                            />
                        ))}
                        {(eligible ?? []).length === 0 && (
                            <Text
                                style={[
                                    Type.bodySmall,
                                    {
                                        color: palette.textMuted,
                                        textAlign: 'center',
                                        paddingHorizontal: Spacing.xl,
                                        paddingTop: Spacing.xl,
                                    },
                                ]}
                            >
                                Log a few restaurants to see them here.
                            </Text>
                        )}
                    </ScrollView>
                )}
            </View>
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
        padding: Spacing.sm,
        borderRadius: Radius.sm,
        borderBottomWidth: StyleSheet.hairlineWidth,
        gap: Spacing.sm,
        marginBottom: 4,
        ...Shadow.clip,
    },
    slotThumb: {
        width: 40,
        height: 40,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    emptyDraft: {
        paddingVertical: Spacing.md,
        alignItems: 'center',
    },
});
