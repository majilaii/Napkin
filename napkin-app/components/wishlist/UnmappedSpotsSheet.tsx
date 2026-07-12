/**
 * UnmappedSpotsSheet — tap-through for the map's "N saved spots have no map
 * location" murmur (founder ask 2026-07-12): WHICH spots, and a fix per row.
 *
 * A row opens PlacePickerModal prefilled with the spot's name; picking a place
 * persists it (idempotent upsert-from-place → a restaurant WITH coords) and
 * re-points the wishlist item via the `wishlist` repoint action. The wishlist
 * refetch drops the row (and the murmur count) — the sheet stays up so all N
 * can be fixed in one sitting, and auto-closes when the last one lands.
 *
 * The picker is nested INSIDE this sheet's Modal (Fabric modal-stacking law —
 * a sibling would silently never present while the sheet is up).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView, StyleSheet, TouchableWithoutFeedback } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import type { PersonalWishlistItem } from '@/hooks/wishlist';
import { useRepointWishlistItem } from '@/hooks/wishlist/useRepointWishlistItem';
import { usePersistPlace } from '@/hooks/search/usePersistPlace';
import { PlacePickerModal, type PlacePickerResult } from './PlacePickerModal';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Props {
    visible: boolean;
    onClose: () => void;
    /** The saves with no coordinates (parent derives from buildMapPins ids). */
    items: PersonalWishlistItem[];
    userId: string | null | undefined;
    palette: typeof Colors.light;
}

export function UnmappedSpotsSheet({ visible, onClose, items, userId, palette }: Props) {
    const insets = useSafeAreaInsets();
    const [fixTarget, setFixTarget] = useState<PersonalWishlistItem | null>(null);
    const [fixError, setFixError] = useState(false);

    const { mutateAsync: persistPlace, isPending: persisting } = usePersistPlace();
    const { mutateAsync: repoint, isPending: repointing } = useRepointWishlistItem(
        userId,
        fixTarget?.job_id ?? null,
    );
    const busy = persisting || repointing;

    // Auto-close once the last unmapped spot gains a location (the refetch
    // empties `items` while we're open). Skipped while a fix is mid-flight.
    const wasVisible = useRef(false);
    useEffect(() => {
        if (visible && wasVisible.current && items.length === 0 && !fixTarget) onClose();
        wasVisible.current = visible;
    }, [visible, items.length, fixTarget, onClose]);

    const handlePick = useCallback(
        async (r: PlacePickerResult) => {
            const target = fixTarget;
            if (!target) return;
            setFixError(false);
            try {
                // Picker ids are Napkin UUIDs (persisted) or Google place ids —
                // persist first so repoint always gets a UUID (and the upsert
                // refreshes coords even when re-picking the same restaurant).
                const restaurantId = UUID_RE.test(r.id) ? r.id : await persistPlace(r.id);
                await repoint({ item_id: target.id, restaurant_id: restaurantId });
                setFixTarget(null);
            } catch {
                setFixError(true); // inline in the picker — root toast is covered
            }
        },
        [fixTarget, persistPlace, repoint],
    );

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <TouchableWithoutFeedback onPress={onClose}>
                <View style={[styles.backdrop, { backgroundColor: palette.overlay }]} />
            </TouchableWithoutFeedback>

            <View
                style={[
                    styles.sheet,
                    { backgroundColor: palette.background, paddingBottom: insets.bottom + Spacing.md },
                    Shadow.ambient,
                ]}
            >
                <View style={[styles.handle, { backgroundColor: palette.outlineVariant }]} />
                <Text style={[styles.kicker, { color: palette.textMuted }]}>NO MAP LOCATION</Text>

                <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
                    {items.map((item) => (
                        <Pressable
                            key={item.id}
                            onPress={() => {
                                setFixError(false);
                                setFixTarget(item);
                            }}
                            style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
                            accessibilityRole="button"
                            accessibilityLabel={`fix ${item.restaurant?.name ?? 'this spot'}`}
                        >
                            <View style={styles.rowBody}>
                                <Text style={[styles.rowName, { color: palette.text }]} numberOfLines={1}>
                                    {item.restaurant?.name ?? 'unnamed spot'}
                                </Text>
                                {item.restaurant?.city ? (
                                    <Text style={[styles.rowMeta, { color: palette.textMuted }]} numberOfLines={1}>
                                        {item.restaurant.city}
                                    </Text>
                                ) : null}
                            </View>
                            <Text style={[styles.fixLabel, { color: palette.primary }]}>fix</Text>
                            <Ionicons name="chevron-forward" size={13} color={palette.textMuted} />
                        </Pressable>
                    ))}
                </ScrollView>

                {/* Nested INSIDE the open Modal — Fabric modal-stacking law. */}
                <PlacePickerModal
                    visible={fixTarget !== null}
                    title="find it on the map"
                    initialQuery={fixTarget?.restaurant?.name ?? ''}
                    busy={busy}
                    errorText={fixError ? "couldn't place that spot — try again" : null}
                    onSelect={handlePick}
                    onDismiss={() => setFixTarget(null)}
                    palette={palette}
                />
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1 },
    sheet: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        borderTopLeftRadius: Radius.xxl,
        borderTopRightRadius: Radius.xxl,
        paddingTop: Spacing.sm,
        maxHeight: '70%',
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: Radius.full,
        alignSelf: 'center',
        marginBottom: Spacing.md,
    },
    kicker: {
        ...Type.sectionKicker,
        letterSpacing: 1.5,
        paddingHorizontal: 22,
        marginBottom: Spacing.xs,
    },
    list: { flexGrow: 0 },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 12,
        paddingHorizontal: 22,
    },
    rowBody: { flex: 1, gap: 2, minWidth: 0 },
    rowName: {
        ...Type.editorialBody,
    },
    rowMeta: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
    fixLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12.5,
        letterSpacing: 0.2,
    },
});

export default UnmappedSpotsSheet;
