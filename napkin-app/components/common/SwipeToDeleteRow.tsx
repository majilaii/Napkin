/**
 * SwipeToDeleteRow — TICKET-111: a thin wrapper that reveals a terracotta
 * trash panel on a right-to-left swipe. Used on ledger surfaces only (wishlist
 * Pinned rows, list-detail entries). Swipe REVEALS; tapping the trash panel
 * fires `onDelete` (the caller opens the confirm sheet or runs the delete-then-
 * toast undo pattern) — a release never deletes on its own, so "destructive
 * taps always confirm" holds.
 *
 * Gesture coexistence: on a DraggableFlatList / scrolling FlatList the swipe
 * must yield vertical drags. `dragOffsetFromRightEdge` requires a clear
 * horizontal pull before the panel activates, so a vertical drag/scroll (or a
 * long-press-drag from the reorder handle) is never captured by the swipe.
 *
 * When `enabled` is false (viewer isn't the owner, or a reorder drag is in
 * flight on a ranked list) the wrapper renders its children plain — no
 * Swipeable is mounted, so a swipe can't start mid-reorder.
 *
 * `ReanimatedSwipeable` (gesture-handler 2.28) has no `enabled` prop and no
 * literal `activeOffsetX` — we gate by conditionally mounting and tune
 * horizontal activation via `dragOffsetFromRightEdge` (the modern analogue).
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable, {
    type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    /** Owner-only + not mid-reorder. When false, children render without swipe. */
    enabled: boolean;
    /** Fired when the revealed trash panel is tapped (caller confirms/deletes). */
    onDelete: () => void;
    children: React.ReactNode;
}

const PANEL_WIDTH = 76;

export function SwipeToDeleteRow({ enabled, onDelete, children }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const swipeRef = React.useRef<SwipeableMethods | null>(null);

    if (!enabled) return <>{children}</>;

    const renderRightActions = () => (
        <Pressable
            onPress={() => {
                // Close the reveal, then hand off to the caller's confirm step.
                swipeRef.current?.close();
                onDelete();
            }}
            style={[styles.panel, { backgroundColor: palette.error }]}
            accessibilityRole="button"
            accessibilityLabel="Delete"
        >
            <Ionicons name="trash-outline" size={20} color={palette.textInverse} />
        </Pressable>
    );

    return (
        <ReanimatedSwipeable
            ref={swipeRef}
            friction={2}
            rightThreshold={40}
            // Require a clear horizontal pull so vertical drag/scroll (and the
            // reorder handle's long-press-drag) never triggers the swipe.
            dragOffsetFromRightEdge={20}
            overshootRight={false}
            renderRightActions={renderRightActions}
        >
            <View>{children}</View>
        </ReanimatedSwipeable>
    );
}

const styles = StyleSheet.create({
    panel: {
        width: PANEL_WIDTH,
        alignItems: 'center',
        justifyContent: 'center',
        alignSelf: 'stretch',
    },
});
