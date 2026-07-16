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

import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import type { ListEntry } from '@/hooks/lists/useList';
import { useRepairListGhost } from '@/hooks/lists/useRepairListGhost';
import { usePersistPlace } from '@/hooks/search/usePersistPlace';
import {
    PlacePickerModal,
    type PlacePickerResult,
} from '@/components/wishlist/PlacePickerModal';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Props {
    visible: boolean;
    onClose: () => void;
    listId: string;
    entries: ListEntry[];
    palette: typeof Colors.light;
}

export function UnmappedListSpotsSheet({ visible, onClose, listId, entries, palette }: Props) {
    const insets = useSafeAreaInsets();
    const [targetId, setTargetId] = useState<string | null>(null);
    const [pickerError, setPickerError] = useState<string | null>(null);
    const target = targetId ? entries.find((entry) => entry.id === targetId) ?? null : null;
    const repair = useRepairListGhost();
    const { mutateAsync: persistPlace, isPending: persisting } = usePersistPlace();
    const busy = repair.isPending || persisting;

    const wasVisible = useRef(false);
    useEffect(() => {
        if (visible && wasVisible.current && entries.length === 0 && !target) onClose();
        wasVisible.current = visible;
    }, [entries.length, onClose, target, visible]);

    const dismiss = useCallback(() => {
        if (busy) return;
        setTargetId(null);
        setPickerError(null);
        onClose();
    }, [busy, onClose]);

    const handlePick = useCallback(
        async (result: PlacePickerResult) => {
            if (!target || busy) return;
            const replacementExternalId =
                result.external_id ?? (UUID_RE.test(result.id) ? null : result.id);
            const expectedVersion = target.restaurant.completeness_version;
            if (!replacementExternalId || !Number.isSafeInteger(expectedVersion)) {
                setPickerError("couldn't verify that replacement — try another");
                return;
            }
            setPickerError(null);
            try {
                // A text-search result is only a provider candidate. Persisting
                // it forces server-side Details attestation and a verified row;
                // fn_repair_list_ghost independently requires both that row and
                // a fresh place_attestations record before canonicalizing.
                await persistPlace(replacementExternalId);
                await repair.mutateAsync({
                    entry_id: target.id,
                    list_id: listId,
                    replacement_external_id: replacementExternalId,
                    expected_version: expectedVersion!,
                });
                setTargetId(null);
            } catch {
                setPickerError("couldn't repair that spot — try again");
            }
        },
        [busy, listId, persistPlace, repair, target],
    );

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={dismiss}>
            <TouchableWithoutFeedback onPress={dismiss}>
                <View style={[styles.backdrop, { backgroundColor: palette.overlay }]} />
            </TouchableWithoutFeedback>

            <View
                style={[
                    styles.sheet,
                    {
                        backgroundColor: palette.background,
                        paddingBottom: insets.bottom + Spacing.md,
                    },
                    Shadow.ambient,
                ]}
            >
                <View style={[styles.handle, { backgroundColor: palette.outlineVariant }]} />
                <Text style={[styles.kicker, { color: palette.textMuted }]}>NOT ON THE MAP</Text>
                <Text style={[styles.murmur, { color: palette.textMuted }]}>choose the right place to repair it</Text>

                <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
                    {entries.map((entry) => (
                        <Pressable
                            key={entry.id}
                            onPress={() => {
                                setPickerError(null);
                                setTargetId(entry.id);
                            }}
                            style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
                            accessibilityRole="button"
                            accessibilityLabel={`repair ${entry.restaurant.name}`}
                        >
                            <View style={styles.rowBody}>
                                <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                                    {entry.restaurant.name}
                                </Text>
                                {entry.restaurant.city ? (
                                    <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>
                                        {entry.restaurant.city}
                                    </Text>
                                ) : null}
                            </View>
                            <Text style={[styles.fix, { color: palette.primary }]}>fix</Text>
                            <Ionicons name="chevron-forward" size={13} color={palette.textMuted} />
                        </Pressable>
                    ))}
                </ScrollView>

                <Pressable onPress={dismiss} disabled={busy} style={styles.closeTarget}>
                    <Text style={[styles.close, { color: palette.textMuted }]}>done</Text>
                </Pressable>

                <PlacePickerModal
                    visible={target !== null}
                    title="find the right place"
                    subtitle={`repair ${target?.restaurant.name ?? 'this spot'}`}
                    initialQuery={[target?.restaurant.name, target?.restaurant.city]
                        .filter(Boolean)
                        .join(' ')}
                    busy={busy}
                    errorText={pickerError}
                    onSelect={handlePick}
                    onDismiss={() => {
                        if (busy) return;
                        setTargetId(null);
                        setPickerError(null);
                    }}
                    palette={palette}
                />
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject },
    sheet: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        maxHeight: '78%',
        borderTopLeftRadius: Radius.xl,
        borderTopRightRadius: Radius.xl,
        paddingHorizontal: 22,
        paddingTop: Spacing.sm,
    },
    handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: Spacing.lg },
    kicker: { fontFamily: 'Manrope_700Bold', fontSize: 11, letterSpacing: 1.5 },
    murmur: { fontFamily: 'Manrope_400Regular', fontSize: 16, marginTop: 4, marginBottom: Spacing.md },
    list: { flexGrow: 0 },
    row: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
    rowBody: { flex: 1, minWidth: 0 },
    name: { fontFamily: 'Newsreader_400Regular', fontSize: 17 },
    meta: { fontFamily: 'Manrope_500Medium', fontSize: 13, marginTop: 2 },
    fix: { fontFamily: 'Manrope_700Bold', fontSize: 13 },
    closeTarget: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.sm },
    close: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
});
