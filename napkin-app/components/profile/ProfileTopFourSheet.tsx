/**
 * ProfileTopFourSheet — editor for the curated profile Top 4.
 *
 * Letterboxd-style FIXED SLOTS: four numbered squares (a 2×2 grid). Each square is
 * a position — tap an empty one to set that spot, tap a filled one to swap it for
 * another, × to clear it. Words only, no thumbnails. Picking opens
 * TopFourSearchScreen (Google Places; any restaurant, logged or not — a ghost is
 * upserted to mint an id). Save → useSetProfileTopFour; the saved order is the
 * filled slots in slot order. Saving with 0 picks clears the override and the
 * profile reverts to the auto-derived list.
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
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSetProfileTopFour } from '@/hooks/users/useSetProfileTopFour';
import { TopFourSearchScreen, type TopFourSearchPick } from './TopFourSearchScreen';
import { ChooseMemorySheet } from './ChooseMemorySheet';
import { toProfileTopFourPicks } from './topFourPicks';

export interface ProfileTopFourPick {
    restaurant_id: string;
    name: string;
    photo_url: string | null;
    /** TICKET-144 pt2 — chosen-memory hero (the owner's own entry photo). */
    hero_entry_photo_id?: string | null;
    hero_photo_url?: string | null;
}

interface SlotData {
    restaurant_id: string;
    name: string;
    photo_url: string | null;
    /** TICKET-144 pt2 — per-slot chosen-memory hero + its URL for preview. */
    hero_entry_photo_id: string | null;
    hero_photo_url: string | null;
}

interface Props {
    visible: boolean;
    onClose: () => void;
    userId: string | null | undefined;
    currentPicks: ProfileTopFourPick[];
}

const SLOT_COUNT = 4;

// ── A single fixed slot (square) ────────────────────────────────────────────────

function SlotCard({
    index,
    slot,
    palette,
    onPress,
    onClear,
    onChooseMemory,
}: {
    index: number;
    slot: SlotData | null;
    palette: typeof Colors.light;
    onPress: () => void;
    onClear: () => void;
    onChooseMemory: () => void;
}) {
    const filled = !!slot;
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.card,
                filled
                    ? { backgroundColor: palette.card, ...Shadow.clip }
                    : {
                          borderWidth: 1.5,
                          borderStyle: 'dashed',
                          borderColor: 'rgba(160,63,40,0.35)',
                          backgroundColor: 'rgba(160,63,40,0.03)',
                      },
                pressed ? { opacity: 0.85 } : null,
            ]}
            accessibilityRole="button"
            accessibilityLabel={
                filled
                    ? `Slot ${index + 1}: ${slot!.name}. Tap to swap it.`
                    : `Empty slot ${index + 1}. Tap to add a spot.`
            }
        >
            <Text style={[styles.cardNum, { color: palette.textMuted }]}>{index + 1}</Text>

            {filled ? (
                <>
                    <Text style={[styles.cardName, { color: palette.text }]} numberOfLines={2}>
                        {slot!.name}
                    </Text>
                    <Pressable
                        onPress={onClear}
                        hitSlop={10}
                        style={styles.cardRemove}
                        accessibilityLabel={`Remove ${slot!.name}`}
                    >
                        <Ionicons name="close" size={15} color={palette.textMuted} />
                    </Pressable>

                    {/* Choose-a-memory affordance — a hero thumbnail once set. */}
                    <Pressable
                        onPress={onChooseMemory}
                        hitSlop={6}
                        style={styles.memoryAffordance}
                        accessibilityLabel={
                            slot!.hero_photo_url ? `Change the featured photo for ${slot!.name}` : `Add a featured photo for ${slot!.name}`
                        }
                    >
                        {slot!.hero_photo_url ? (
                            <>
                                <Image source={{ uri: slot!.hero_photo_url }} style={styles.memoryThumb} contentFit="cover" />
                                <Text style={[styles.memoryLabel, { color: palette.primary }]}>photo</Text>
                            </>
                        ) : (
                            <>
                                <Ionicons name="image-outline" size={13} color={palette.textMuted} />
                                <Text style={[styles.memoryLabel, { color: palette.textMuted }]}>add photo</Text>
                            </>
                        )}
                    </Pressable>
                </>
            ) : (
                <Ionicons name="add" size={24} color={palette.primary} />
            )}
        </Pressable>
    );
}

// ── Sheet ────────────────────────────────────────────────────────────────────

export function ProfileTopFourSheet({ visible, onClose, userId, currentPicks }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();

    const setPicks = useSetProfileTopFour();

    // Fixed 4 slots; null = empty. Position = slot index + 1.
    const [slots, setSlots] = useState<(SlotData | null)[]>([null, null, null, null]);
    // Which slot the search is filling (null = search closed).
    const [addingSlot, setAddingSlot] = useState<number | null>(null);
    // Which slot the chosen-memory picker is filling (null = picker closed).
    const [choosingSlot, setChoosingSlot] = useState<number | null>(null);

    // Seed from currentPicks only on the closed→open transition, so a profile
    // refetch (new currentPicks identity) can't clobber an in-progress edit.
    const wasVisible = useRef(false);
    useEffect(() => {
        if (visible && !wasVisible.current) {
            const next: (SlotData | null)[] = [null, null, null, null];
            currentPicks.slice(0, SLOT_COUNT).forEach((p, i) => {
                next[i] = {
                    restaurant_id: p.restaurant_id,
                    name: p.name,
                    photo_url: p.photo_url,
                    hero_entry_photo_id: p.hero_entry_photo_id ?? null,
                    hero_photo_url: p.hero_photo_url ?? null,
                };
            });
            setSlots(next);
            setAddingSlot(null);
            setChoosingSlot(null);
        }
        wasVisible.current = visible;
    }, [visible, currentPicks]);

    // Filled slots compacted in slot order — the saved + compared order.
    const filled = useMemo(() => slots.filter((s): s is SlotData => !!s), [slots]);

    // Ids already used (so the search greys out dupes). Excludes the slot being
    // edited, so re-opening a filled slot doesn't grey out its own occupant.
    const pickedIds = useMemo(
        () => new Set(slots.filter((s, i) => s && i !== addingSlot).map((s) => s!.restaurant_id)),
        [slots, addingSlot],
    );

    const hasDiff = useMemo(() => {
        if (filled.length !== currentPicks.length) return true;
        return filled.some(
            (d, i) =>
                d.restaurant_id !== currentPicks[i]?.restaurant_id ||
                (d.hero_entry_photo_id ?? null) !== (currentPicks[i]?.hero_entry_photo_id ?? null),
        );
    }, [filled, currentPicks]);

    const handlePick = useCallback(
        (pick: TopFourSearchPick) => {
            setSlots((prev) => {
                if (addingSlot == null) return prev;
                // Ignore a dupe already held by ANOTHER slot.
                if (prev.some((s, i) => s?.restaurant_id === pick.restaurant_id && i !== addingSlot)) {
                    return prev;
                }
                const next = [...prev];
                // Swapping to a DIFFERENT restaurant invalidates the old hero
                // (it belonged to the previous spot); re-picking the same one keeps it.
                const existing = prev[addingSlot];
                const sameRestaurant = existing?.restaurant_id === pick.restaurant_id;
                next[addingSlot] = {
                    restaurant_id: pick.restaurant_id,
                    name: pick.name,
                    photo_url: pick.photo_url,
                    hero_entry_photo_id: sameRestaurant ? existing!.hero_entry_photo_id : null,
                    hero_photo_url: sameRestaurant ? existing!.hero_photo_url : null,
                };
                return next;
            });
            setAddingSlot(null);
        },
        [addingSlot],
    );

    // Chosen-memory picker committed a photo (or "none") for `choosingSlot`.
    const handleChooseMemory = useCallback(
        (entryPhotoId: string | null, photoUrl: string | null) => {
            setSlots((prev) => {
                if (choosingSlot == null) return prev;
                const cur = prev[choosingSlot];
                if (!cur) return prev;
                const next = [...prev];
                next[choosingSlot] = { ...cur, hero_entry_photo_id: entryPhotoId, hero_photo_url: photoUrl };
                return next;
            });
        },
        [choosingSlot],
    );

    const clearSlot = useCallback((i: number) => {
        setSlots((prev) => {
            const next = [...prev];
            next[i] = null;
            return next;
        });
    }, []);

    const handleSave = useCallback(() => {
        if (!hasDiff) return;
        // Only position · restaurant_id · hero_entry_photo_id ride to the server
        // (consent contract) — preview-only fields never leave the client.
        const picks = toProfileTopFourPicks(filled);
        setPicks.mutate(picks, {
            onSuccess: onClose,
            onError: () => Alert.alert('Could not save', 'Please try again.'),
        });
    }, [hasDiff, filled, setPicks, onClose]);

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
    const memorySlot = choosingSlot != null ? slots[choosingSlot] : null;

    return (
        <>
            <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={addingSlot != null ? () => setAddingSlot(null) : handleCancel}
        >
            {addingSlot != null ? (
                <TopFourSearchScreen
                    onClose={() => setAddingSlot(null)}
                    onPick={handlePick}
                    userId={userId}
                    pickedIds={pickedIds}
                    atCapacity={false}
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
                                marginBottom: Spacing.lg,
                            },
                        ]}
                    >
                        Tap a square to set that spot, tap a filled one to swap it, × to clear. Empty = back to automatic.
                    </Text>

                    {/* 2×2 fixed slots */}
                    <View style={styles.grid}>
                        <View style={styles.gridRow}>
                            <SlotCard index={0} slot={slots[0]} palette={palette} onPress={() => setAddingSlot(0)} onClear={() => clearSlot(0)} onChooseMemory={() => setChoosingSlot(0)} />
                            <SlotCard index={1} slot={slots[1]} palette={palette} onPress={() => setAddingSlot(1)} onClear={() => clearSlot(1)} onChooseMemory={() => setChoosingSlot(1)} />
                        </View>
                        <View style={styles.gridRow}>
                            <SlotCard index={2} slot={slots[2]} palette={palette} onPress={() => setAddingSlot(2)} onClear={() => clearSlot(2)} onChooseMemory={() => setChoosingSlot(2)} />
                            <SlotCard index={3} slot={slots[3]} palette={palette} onPress={() => setAddingSlot(3)} onClear={() => clearSlot(3)} onChooseMemory={() => setChoosingSlot(3)} />
                        </View>
                    </View>
                </View>
            )}

            {/* Per-slot chosen-memory picker. MUST live INSIDE this Modal: on
                Fabric a Modal presents from the VC its host view is mounted in
                (RCTModalHostViewComponentView), so a SIBLING of an open pageSheet
                presents from the root VC — already presenting — and is silently
                rejected with _isPresented latched true. Nested here it presents
                from the pageSheet VC (legal stacked presentation). */}
            <ChooseMemorySheet
                visible={choosingSlot != null}
                onClose={() => setChoosingSlot(null)}
                userId={userId}
                restaurantId={memorySlot?.restaurant_id ?? null}
                restaurantName={memorySlot?.name}
                currentPhotoId={memorySlot?.hero_entry_photo_id ?? null}
                onSelect={handleChooseMemory}
            />
            </Modal>
        </>
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
    grid: {
        paddingHorizontal: 22,
        gap: 12,
    },
    gridRow: {
        flexDirection: 'row',
        gap: 12,
    },
    card: {
        flex: 1,
        height: 100,
        borderRadius: Radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: Spacing.md,
        overflow: 'hidden',
    },
    cardNum: {
        position: 'absolute',
        top: 8,
        left: 11,
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
    },
    cardName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontStyle: 'italic',
        fontSize: 17,
        lineHeight: 21,
        textAlign: 'center',
    },
    cardRemove: {
        position: 'absolute',
        top: 5,
        right: 5,
        width: 28,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
    },
    memoryAffordance: {
        position: 'absolute',
        bottom: 7,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    memoryThumb: {
        width: 16,
        height: 16,
        borderRadius: 3,
    },
    memoryLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9.5,
        letterSpacing: 0.4,
        textTransform: 'lowercase',
    },
});
