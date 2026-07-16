/**
 * TableUnmappedSpotsSheet — the table map's residual manual repair net.
 *
 * Every row is saver-attributed. Only a row carrying the JWT viewer's exact
 * wishlist item id can open the repair picker; other members' saves remain
 * readable but cannot be mutated. The picker is nested inside this Modal for
 * React Native Fabric's stacked-modal presentation law.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableWithoutFeedback,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { usePersistPlace } from '@/hooks/search/usePersistPlace';
import { useRepointWishlistItem } from '@/hooks/wishlist/useRepointWishlistItem';
import {
    PlacePickerModal,
    type PlacePickerResult,
} from '@/components/wishlist/PlacePickerModal';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UnmappableRow {
    restaurantId: string;
    name: string;
    city: string | null;
    saverLabel: string;
    viewerItemId: string | null;
}

interface Props {
    visible: boolean;
    onClose: () => void;
    rows: UnmappableRow[];
    tableId: string | null | undefined;
    userId: string | null | undefined;
    palette: typeof Colors.light;
}

interface FixSelection {
    viewerItemId: string;
    restaurantId: string;
    userId: string | null;
    tableId: string | null;
}

export function TableUnmappedSpotsSheet({
    visible,
    onClose,
    rows,
    tableId,
    userId,
    palette,
}: Props) {
    const insets = useSafeAreaInsets();
    // Keep private display data out of state, and bind the selection to the
    // viewer/Table that opened it. Re-deriving the live row makes a cache refresh
    // or in-place auth/Table switch invalidate the picker synchronously.
    const [fixSelection, setFixSelection] = useState<FixSelection | null>(null);
    const [fixError, setFixError] = useState(false);
    const fixTarget = fixSelection
        && fixSelection.userId === (userId ?? null)
        && fixSelection.tableId === (tableId ?? null)
        ? rows.find(
            (row) =>
                row.viewerItemId === fixSelection.viewerItemId
                && row.restaurantId === fixSelection.restaurantId,
        ) ?? null
        : null;

    const { mutateAsync: persistPlace, isPending: persisting } = usePersistPlace();
    const { mutateAsync: repoint, isPending: repointing } = useRepointWishlistItem(
        userId,
        null,
        tableId,
    );
    const busy = persisting || repointing;

    const wasVisible = useRef(false);
    useEffect(() => {
        if (visible && wasVisible.current && rows.length === 0 && !fixTarget) onClose();
        wasVisible.current = visible;
    }, [fixTarget, onClose, rows.length, visible]);

    const handlePick = useCallback(
        async (result: PlacePickerResult) => {
            const target = fixTarget;
            if (!target?.viewerItemId) return;
            setFixError(false);
            try {
                const restaurantId = UUID_RE.test(result.id)
                    ? result.id
                    : await persistPlace(result.id);
                await repoint({
                    item_id: target.viewerItemId,
                    restaurant_id: restaurantId,
                });
                setFixSelection(null);
            } catch {
                setFixError(true);
            }
        },
        [fixTarget, persistPlace, repoint],
    );

    const rowContents = (row: UnmappableRow, repairable: boolean) => {
        const metadata = [row.city, `saved by ${row.saverLabel}`].filter(Boolean).join(' · ');
        return (
            <>
                <View style={styles.rowBody}>
                    <Text style={[styles.rowName, { color: palette.text }]} numberOfLines={1}>
                        {row.name}
                    </Text>
                    <Text style={[styles.rowMeta, { color: palette.textMuted }]} numberOfLines={1}>
                        {metadata}
                    </Text>
                </View>
                {repairable ? (
                    <>
                        <Text style={[styles.fixLabel, { color: palette.primary }]}>fix</Text>
                        <Ionicons name="chevron-forward" size={13} color={palette.textMuted} />
                    </>
                ) : null}
            </>
        );
    };

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
                    {rows.map((row) =>
                        row.viewerItemId ? (
                            <Pressable
                                key={row.restaurantId}
                                onPress={() => {
                                    setFixError(false);
                                    setFixSelection({
                                        viewerItemId: row.viewerItemId!,
                                        restaurantId: row.restaurantId,
                                        userId: userId ?? null,
                                        tableId: tableId ?? null,
                                    });
                                }}
                                style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
                                accessibilityRole="button"
                                accessibilityLabel={`fix ${row.name}`}
                            >
                                {rowContents(row, true)}
                            </Pressable>
                        ) : (
                            <View key={row.restaurantId} style={styles.row}>
                                {rowContents(row, false)}
                            </View>
                        ),
                    )}
                </ScrollView>

                {/* Nested INSIDE the open Modal — Fabric modal-stacking law. */}
                <PlacePickerModal
                    visible={fixTarget !== null}
                    title="find it on the map"
                    initialQuery={fixTarget?.name ?? ''}
                    busy={busy}
                    errorText={fixError ? "couldn't place that spot — try again" : null}
                    onSelect={handlePick}
                    onDismiss={() => setFixSelection(null)}
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
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        paddingVertical: 12,
        paddingHorizontal: 22,
    },
    rowBody: { flex: 1, gap: 2, minWidth: 0 },
    rowName: Type.editorialBody,
    rowMeta: Type.metadata,
    fixLabel: {
        ...Type.metadata,
        fontFamily: 'Manrope_600SemiBold',
        letterSpacing: 0.2,
    },
});

export default TableUnmappedSpotsSheet;
