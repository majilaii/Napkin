/**
 * FastLogSheet — bottom-sheet wrapper around FastLogForm.
 *
 * Used from the restaurant page's "Log a visit → Solo log" path.
 *
 * Pull-up affordance: a PanResponder on the handle/header area detects an
 * upward drag past PULL_UP_THRESHOLD and routes to /create-entry with the
 * current rating pre-filled. The italic "⌃ pull up for the full log"
 * whisper at the bottom of FastLogForm is the tap-fallback.
 */
import React, { useRef, useState } from 'react';
import {
    Modal,
    View,
    TouchableWithoutFeedback,
    StyleSheet,
    Dimensions,
    PanResponder,
    Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius, Shadow } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SheetHeader } from '@/components/ui';
import { FastLogForm, type LockedRestaurant } from './FastLogForm';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
/** Upward drag distance (in px) past which we transition to the full composer. */
const PULL_UP_THRESHOLD = 60;
/** Velocity (px/ms upward) that triggers the transition even before threshold. */
const PULL_UP_VELOCITY = 0.6;

interface FastLogSheetProps {
    visible: boolean;
    onClose: () => void;
    restaurant: LockedRestaurant;
    initialTableId?: string;
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

    // Rating lives here so the swipe-up gesture can pass it to /create-entry.
    const [rating, setRating] = useState(0);
    const ratingRef = useRef(rating);
    ratingRef.current = rating;

    // Live drag offset for visual lift while the user pulls up.
    const dragOffset = useRef(new Animated.Value(0)).current;

    // Reset on close so the next open starts fresh.
    // dragOffset reset lives here too because both close branches in
    // onPanResponderRelease (pulledUp/dismissed) just call onClose without
    // springing the offset back, and a stale value would paint the sheet at
    // the wrong altitude on reopen.
    React.useEffect(() => {
        if (!visible) {
            setRating(0);
            dragOffset.setValue(0);
        }
    }, [visible, dragOffset]);

    const handleOpenFullEntry = () => {
        const params: Record<string, string> = { mode: 'solo' };

        if (restaurant.placePayload) {
            params.placePayload = JSON.stringify(restaurant.placePayload);
        } else if (restaurant.external_id) {
            params.placePayload = JSON.stringify({
                id: restaurant.external_id,
                name: restaurant.name,
            });
        } else if (restaurant.id) {
            params.restaurantId = restaurant.id;
        }

        const currentRating = ratingRef.current;
        if (currentRating > 0) {
            params.rating = String(currentRating);
        }
        if (initialTableId) {
            params.tableId = initialTableId;
        }

        onClose();
        router.push({ pathname: '/create-entry', params });
    };

    const handleSubmitted = (entryId: string) => {
        onClose();
        onSubmitted(entryId);
    };

    // PanResponder is created once via useRef, so its callbacks would otherwise
    // close over the first-render handleOpenFullEntry / onClose — which in turn
    // capture stale `restaurant`, `initialTableId`, `router`, etc. Mirror the
    // ratingRef pattern: stash the latest handlers in refs and dispatch through
    // them inside the gesture callbacks.
    const handleOpenFullEntryRef = useRef(handleOpenFullEntry);
    handleOpenFullEntryRef.current = handleOpenFullEntry;
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => false,
            // Capture only meaningful vertical drags so taps on the handle still work.
            onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 4 && Math.abs(gs.dy) > Math.abs(gs.dx),
            onPanResponderMove: (_, gs) => {
                // Mirror finger movement (negative dy = upward = negative offset).
                if (gs.dy < 0) dragOffset.setValue(gs.dy);
                // Allow downward drag too — bottom-sheet dismiss feel.
                else dragOffset.setValue(gs.dy * 0.5);
            },
            onPanResponderRelease: (_, gs) => {
                const pulledUp = gs.dy < -PULL_UP_THRESHOLD || gs.vy < -PULL_UP_VELOCITY;
                const dismissed = gs.dy > 80 || gs.vy > 0.8;
                if (pulledUp) {
                    handleOpenFullEntryRef.current();
                } else if (dismissed) {
                    onCloseRef.current();
                } else {
                    Animated.spring(dragOffset, {
                        toValue: 0,
                        useNativeDriver: true,
                        damping: 22,
                        stiffness: 220,
                    }).start();
                }
            },
        })
    ).current;

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
            <Animated.View
                style={[
                    styles.sheet,
                    {
                        backgroundColor: palette.card,
                        paddingBottom: insets.bottom + 16,
                        minHeight: SCREEN_HEIGHT * 0.6,
                        maxHeight: SCREEN_HEIGHT * 0.9,
                        transform: [{ translateY: dragOffset }],
                    },
                    Shadow.ambient,
                ]}
            >
                {/* Pull-up gesture lives on the handle/header area only — leaves
                    the form's ScrollView free to scroll without fighting the gesture. */}
                <View {...panResponder.panHandlers}>
                    <SheetHeader
                        title="Quick log"
                        leftLabel="Cancel"
                        rightLabel=""
                        onLeftPress={onClose}
                        showHandle
                    />
                </View>

                <FastLogForm
                    lockedRestaurant={restaurant}
                    initialTableId={initialTableId}
                    onSubmitted={handleSubmitted}
                    rating={rating}
                    onRatingChange={setRating}
                    onOpenFullEntry={handleOpenFullEntry}
                />
            </Animated.View>
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
