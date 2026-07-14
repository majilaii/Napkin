/**
 * ListDetailSheet — the hand-rolled three-snap bottom sheet in front of
 * `ScopedListMap` (TICKET-186). Reanimated-4 + RNGH-2.28, NOT @gorhom (A10) and
 * NOT PanResponder (can't compose with a native ScrollView for the handoff).
 *
 * Snaps (visible heights, A8): peek ≈ 0.16·H (floor 176) · half ≈ 0.56·H
 * (default) · full ≈ 0.92·H. The sheet is a FIXED-height opaque paper view
 * pinned bottom:0 and moved down by `translateY` (0 = full). Drag is 100%
 * shared-value; the host is told a snap SETTLED only from the spring's
 * completion (Codex #3), so the map re-pads/reframes at rest.
 *
 * The scroll↔pan handoff (A9) is the genuinely hard part — two pans (header +
 * list) composed with the list's own `Gesture.Native()` scroll, ownership
 * latched once in `onBegin`, `onFinalize` always settling. This exact
 * composition was type-verified against the installed RNGH/Reanimated (ticket
 * spike); do not improvise it.
 */
import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
    runOnJS,
    runOnUI,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import DraggableFlatList, { type RenderItemParams } from 'react-native-draggable-flatlist';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { ListEntry } from '@/hooks/lists/useList';
import { ListDetailHeader, type ListDetailHeaderProps } from './ListDetailHeader';
import {
    FULL,
    HALF,
    PEEK,
    offsetsFor,
    resolveSnap,
    sheetHeight,
    type Snap,
} from './listSheetMath';

export interface ListDetailSheetHandle {
    snapTo: (snap: Snap) => void;
    currentSnap: () => Snap;
}

export interface ListDetailSheetProps {
    headerProps: ListDetailHeaderProps;
    description: string | null;
    entries: ListEntry[];
    renderRow: (entry: ListEntry, index: number, drag?: () => void) => React.ReactElement | null;
    editing: boolean;
    onDragEnd: (params: { data: ListEntry[]; from: number; to: number }) => void;
    onSnapSettle: (snap: Snap) => void;
    emptyComponent: React.ReactElement | null;
    sheetRef: React.Ref<ListDetailSheetHandle>;
    /** Usable height (screen − top inset), measured by the host; offsets re-derive. */
    H: number;
}

const SPRING = { damping: 22, stiffness: 220 } as const;

export function ListDetailSheet({
    headerProps,
    description,
    entries,
    renderRow,
    editing,
    onDragEnd,
    onSnapSettle,
    emptyComponent,
    sheetRef,
    H,
}: ListDetailSheetProps) {
    const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();

    const offsets = useMemo(() => offsetsFor(H), [H]);
    const SHEET_H = sheetHeight(H);

    const translateY = useSharedValue(0);
    const snapIndex = useSharedValue<Snap>(HALF);
    const startY = useSharedValue(0);
    const atFull = useSharedValue(false);
    const beganTop = useSharedValue(true);
    const owns = useSharedValue(false);
    const scrollOffset = useSharedValue(0);

    const [scrollEnabled, setScrollEnabled] = useState(false);

    const onScroll = useAnimatedScrollHandler((e) => {
        scrollOffset.value = e.contentOffset.y;
    });

    // JS thread — fired only from the spring's `finished` completion (Codex #3).
    const commitSettle = (index: Snap) => {
        setScrollEnabled(index === FULL);
        onSnapSettle(index);
    };
    const settle = (index: Snap) => {
        'worklet';
        snapIndex.value = index;
        translateY.value = withSpring(offsets[index], SPRING, (finished) => {
            if (finished) runOnJS(commitSettle)(index);
        });
    };
    const clamp = (v: number) => {
        'worklet';
        return Math.min(Math.max(v, 0), offsets[PEEK]);
    };

    // Re-align to the current snap when H changes (mount → half; rotation). Runs
    // on the JS thread; also the source of the initial settle so the map pads.
    useEffect(() => {
        if (H <= 0) return;
        const snap = snapIndex.value;
        translateY.value = withTiming(offsets[snap], { duration: 220 });
        setScrollEnabled(snap === FULL);
        onSnapSettle(snap);
        // snapIndex/translateY are stable shared values; onSnapSettle is memoized.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [H, offsets]);

    // Edit mode → full + pan-locked; "done" → back to half (Codex/A9).
    const prevEditingRef = useRef(editing);
    useEffect(() => {
        if (prevEditingRef.current === editing) return;
        if (H <= 0) return; // wait for layout; act once H arrives
        prevEditingRef.current = editing;
        runOnUI(settle)(editing ? FULL : HALF);
        // settle is a per-render worklet closure; runs on an editing change only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editing, H]);

    // No deps array: the handle is rebuilt each render so snapTo/currentSnap
    // always close over the latest `settle`/shared values.
    useImperativeHandle(sheetRef, () => ({
        snapTo: (snap: Snap) => runOnUI(settle)(snap),
        currentSnap: () => snapIndex.value,
    }));

    // ── A9 gesture machine (type-verified spike; do not improvise) ───────────────
    const nativeScroll = Gesture.Native();

    const listPan = Gesture.Pan()
        .activeOffsetY([-10, 10])
        .enabled(!editing)
        .simultaneousWithExternalGesture(nativeScroll)
        .onBegin(() => {
            startY.value = translateY.value;      // Codex #2: capture at touch-begin
            atFull.value = snapIndex.value === FULL;
            beganTop.value = scrollOffset.value <= 0;
            owns.value = false;
        })
        .onUpdate((e) => {
            if (!owns.value) {
                if (!atFull.value) owns.value = true;                       // A9-1
                else if (beganTop.value && e.translationY > 0) {           // A9-2 down-from-top
                    owns.value = true;
                    runOnJS(setScrollEnabled)(false);                      // Codex #3: leave full now
                }
            }
            if (owns.value) translateY.value = clamp(startY.value + e.translationY);
            // else A9-3: at full, up / not-from-top → list scrolls natively
        })
        .onFinalize((e) => {
            if (owns.value) settle(resolveSnap(translateY.value, e.velocityY, offsets));
        });

    const headerPan = Gesture.Pan()
        .activeOffsetY([-10, 10])
        .enabled(!editing)
        .onBegin(() => {
            startY.value = translateY.value;
            owns.value = true;
        })
        .onUpdate((e) => {
            translateY.value = clamp(startY.value + e.translationY);
        })
        .onFinalize((e) => {
            settle(resolveSnap(translateY.value, e.velocityY, offsets));
        });

    const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

    const listHeader = useMemo(
        () => (description ? (
            <Text style={[styles.description, { color: palette.textSecondary }]}>{description}</Text>
        ) : null),
        [description, palette.textSecondary],
    );

    const contentPad = { paddingBottom: insets.bottom + Spacing.xxl };

    return (
        <GestureDetector gesture={headerPan}>
            <Animated.View
                style={[
                    styles.sheet,
                    { height: SHEET_H, backgroundColor: palette.background },
                    sheetStyle,
                ]}
            >
                {/* Fixed drag zone: handle + header (headerPan drives; taps win). */}
                <View style={styles.handleZone}>
                    <View style={[styles.handle, { backgroundColor: palette.ruleWarmNib }]} />
                </View>
                <ListDetailHeader {...headerProps} />

                {editing ? (
                    <DraggableFlatList
                        data={entries}
                        keyExtractor={(item) => item.id}
                        onDragEnd={onDragEnd}
                        ListHeaderComponent={listHeader}
                        ListEmptyComponent={emptyComponent}
                        renderItem={({ item, getIndex, drag }: RenderItemParams<ListEntry>) =>
                            renderRow(item, getIndex() ?? 0, drag)}
                        contentContainerStyle={contentPad}
                        showsVerticalScrollIndicator={false}
                    />
                ) : (
                    <GestureDetector gesture={Gesture.Simultaneous(listPan, nativeScroll)}>
                        <Animated.FlatList
                            data={entries}
                            keyExtractor={(item: ListEntry) => item.id}
                            onScroll={onScroll}
                            scrollEventThrottle={16}
                            scrollEnabled={scrollEnabled}
                            bounces={false}
                            overScrollMode="never"
                            ListHeaderComponent={listHeader}
                            ListEmptyComponent={emptyComponent}
                            renderItem={({ item, index }: { item: ListEntry; index: number }) =>
                                renderRow(item, index)}
                            contentContainerStyle={contentPad}
                            showsVerticalScrollIndicator={false}
                        />
                    </GestureDetector>
                )}
            </Animated.View>
        </GestureDetector>
    );
}

const styles = StyleSheet.create({
    sheet: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        overflow: 'hidden',
        // Ambient lift above the map (soft glow, not a hard drop).
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: -6 },
        shadowOpacity: 0.08,
        shadowRadius: 24,
        elevation: 12,
    },
    handleZone: {
        alignItems: 'center',
        paddingTop: 8,
        paddingBottom: 6,
    },
    handle: {
        width: 40,
        height: 5,
        borderRadius: 3,
        opacity: 0.6,
    },
    description: {
        ...Type.editorialBody,
        paddingHorizontal: Spacing.md,
        paddingTop: 4,
        paddingBottom: Spacing.sm,
    },
});
