/**
 * FastLogSheet — bottom-sheet wrapper around FastLogForm.
 *
 * Used from the restaurant page's "Log a visit → Solo log" path.
 * Canvas: napkin-design-system/project/ui_kits/napkin-app/logger-canvas.html
 * (sheet presentation owns the SheetHeader above the form).
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

import { Colors, Radius, Shadow } from '@/constants/theme';
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

    const handleOpenFullEntry = (prefill: {
        rating: number;
        axes: { food: number; vibe: number; service: number; value: number };
        lockedRestaurant: LockedRestaurant;
        tableId: string | null;
        note: string;
    }) => {
        onClose();

        const params: Record<string, string> = { mode: 'solo' };

        if (prefill.lockedRestaurant.placePayload) {
            params.placePayload = JSON.stringify(prefill.lockedRestaurant.placePayload);
        } else if (prefill.lockedRestaurant.external_id) {
            params.placePayload = JSON.stringify({
                id: prefill.lockedRestaurant.external_id,
                name: prefill.lockedRestaurant.name,
            });
        } else if (prefill.lockedRestaurant.id) {
            params.restaurantId = prefill.lockedRestaurant.id;
        }

        if (prefill.rating > 0) {
            params.rating = String(prefill.rating);
        }
        if (prefill.tableId) {
            params.tableId = prefill.tableId;
        }
        if (prefill.note.trim()) {
            params.note = prefill.note.trim();
        }
        if (prefill.axes.food > 0) params.foodRating = String(prefill.axes.food);
        if (prefill.axes.vibe > 0) params.vibeRating = String(prefill.axes.vibe);
        if (prefill.axes.service > 0) params.serviceRating = String(prefill.axes.service);
        if (prefill.axes.value > 0) params.valueRating = String(prefill.axes.value);

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
                    rightLabel=""
                    onLeftPress={onClose}
                    showHandle
                />

                <FastLogForm
                    lockedRestaurant={restaurant}
                    initialTableId={initialTableId}
                    onSubmitted={handleSubmitted}
                    onOpenFullEntry={handleOpenFullEntry}
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
