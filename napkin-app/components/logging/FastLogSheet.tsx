/**
 * FastLogSheet — bottom-sheet wrapper around FastLogForm.
 *
 * Used from the restaurant page's "Log a visit → Solo log" path.
 * Mirrors the Modal+backdrop pattern from LogVisitSheet.tsx.
 *
 * On submit: calls onSubmitted so the parent can invalidate restaurant queries.
 * "Add details": pushes to /create-entry with the locked restaurant + rating prefilled.
 *
 * UI kit migration (TICKET-023): uses SheetHeader for the Cancel / title / Save
 * row; Save driver is delegated to FastLogForm via the CTA pill (kept inside
 * form for atomicity of submission state). Handle pill remains above the row.
 */
import React from 'react';
import {
    Modal,
    View,
    TouchableWithoutFeedback,
    StyleSheet,
    Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Shadow, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SheetHeader } from '@/components/ui';
import { FastLogForm, type LockedRestaurant } from './FastLogForm';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface FastLogSheetProps {
    visible: boolean;
    onClose: () => void;
    /** Locked restaurant from the restaurant page */
    restaurant: LockedRestaurant;
    /** Optional table to pre-select */
    initialTableId?: string;
    /** Called after successful submission */
    onSubmitted: (entryId: string) => void;
}

export function FastLogSheet({
    visible,
    onClose,
    restaurant,
    initialTableId,
    onSubmitted,
}: FastLogSheetProps) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'];
    const insets = useSafeAreaInsets();
    const router = useRouter();

    const handleAddDetails = (prefill: {
        rating: number;
        restaurant: any;
        lockedRestaurant?: LockedRestaurant;
        tableId: string | null;
    }) => {
        // Dismiss sheet first, then push to composer
        onClose();

        // Build params for create-entry
        const params: Record<string, string> = { mode: 'solo' };

        if (prefill.lockedRestaurant?.placePayload) {
            params.placePayload = JSON.stringify(prefill.lockedRestaurant.placePayload);
        } else if (prefill.lockedRestaurant?.external_id) {
            // Construct a minimal placePayload from locked restaurant data
            params.placePayload = JSON.stringify({
                id: prefill.lockedRestaurant.external_id,
                name: prefill.lockedRestaurant.name,
            });
        } else if (prefill.lockedRestaurant?.id) {
            params.restaurantId = prefill.lockedRestaurant.id;
        }

        if (prefill.rating > 0) {
            params.rating = String(prefill.rating);
        }
        if (prefill.tableId) {
            params.tableId = prefill.tableId;
        }

        router.push({ pathname: '/create-entry', params });
    };

    const handleSubmitted = (entryId: string) => {
        onClose();
        onSubmitted(entryId);
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onClose}
        >
            {/* Backdrop */}
            <TouchableWithoutFeedback onPress={onClose}>
                <View style={[styles.backdrop, { backgroundColor: palette.overlay }]} />
            </TouchableWithoutFeedback>

            {/* Sheet */}
            <View
                style={[
                    styles.sheet,
                    {
                        backgroundColor: palette.card,
                        paddingBottom: insets.bottom + 16,
                        minHeight: SCREEN_HEIGHT * 0.6,
                        maxHeight: SCREEN_HEIGHT * 0.9,
                    },
                    Shadow.ambient,
                ]}
            >
                <SheetHeader
                    title="Quick log"
                    leftLabel="Cancel"
                    // Right action stays inside the form (submit state lives there).
                    // Passing no onRightPress + label makes the slot silent.
                    rightLabel=""
                    onLeftPress={onClose}
                    showHandle
                />
                <FastLogForm
                    presentation="sheet"
                    lockedRestaurant={restaurant}
                    initialTableId={initialTableId}
                    onSubmitted={handleSubmitted}
                    onAddDetails={handleAddDetails}
                    onClose={onClose}
                />
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
    },
    sheet: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        borderTopLeftRadius: Radius.xxl,
        borderTopRightRadius: Radius.xxl,
        overflow: 'hidden',
    },
});
