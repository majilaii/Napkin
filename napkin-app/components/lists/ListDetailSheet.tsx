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
 *
 * Gesture topology (review F2): the two pans live on DISJOINT subtrees —
 * headerPan's detector wraps ONLY the handle+header block, listPan+nativeScroll
 * wrap the list — so they never contend for a touch and need no declared
 * relationship with each other. Each pan owns its own gesture-state shared
 * values. The list's scroll is disabled when a path leaves full: listPan's
 * A9-2 takeover disables mid-drag (the finger is ON the list), and `settle()`
 * disables for every non-full target (header drag release, imperative snapTo,
 * edit lock — review G4 dropped headerPan's redundant mid-drag disable).
 * Re-enable happens only from the spring completion at full.
 */
import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
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
    listPanOwnsSheet,
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
    /** The edit LOCK: force-full + both pans disabled (review F3 — derives
     * from `isEditingPlaces && canEditEntries`, regardless of ranked). */
    editing: boolean;
    /** `editing && ranked` → DraggableFlatList; unranked edit = a plain
     * scrollable list at full (review F3: ranked gates ONLY the reorder swap). */
    reorder: boolean;
    onDragEnd: (params: { data: ListEntry[]; from: number; to: number }) => void;
    onSnapSettle: (snap: Snap) => void;
    /** Fires when either pan ACTIVATES (a real drag past ±10pt, not a tap) —
     * the host discards a pending focus the new gesture supersedes (G1). */
    onPanStart?: () => void;
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
    reorder,
    onDragEnd,
    onSnapSettle,
    onPanStart,
    emptyComponent,
    sheetRef,
    H,
}: ListDetailSheetProps) {
    const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();

    const offsets = useMemo(() => offsetsFor(H), [H]);
    const SHEET_H = sheetHeight(H);

    // First paint at the HALF offset, never at full (review F5c). The host only
    // mounts the sheet once H is measured, so the prop is the real metric; the
    // H-effect below re-aligns exactly (a no-op on mount).
    const translateY = useSharedValue(offsetsFor(H)[HALF]);
    const snapIndex = useSharedValue<Snap>(HALF);
    // listPan gesture state — its own set; never shared with headerPan (F2).
    const listStartY = useSharedValue(0);
    const listAtFull = useSharedValue(false);
    const listBeganTop = useSharedValue(true);
    const listOwns = useSharedValue(false);
    // headerPan gesture state — independent (F2).
    const headerStartY = useSharedValue(0);
    const scrollOffset = useSharedValue(0);

    const [scrollEnabled, setScrollEnabled] = useState(false);

    const onScroll = useAnimatedScrollHandler((e) => {
        scrollOffset.value = e.contentOffset.y;
    });

    // JS thread. `disableScroll` fires the moment any path LEAVES full (F2);
    // `commitSettle` fires only from the spring's `finished` completion
    // (Codex #3) and is the sole path that re-enables scroll.
    const disableScroll = () => setScrollEnabled(false);
    const commitSettle = (index: Snap) => {
        setScrollEnabled(index === FULL);
        onSnapSettle(index);
    };
    const settle = (index: Snap) => {
        'worklet';
        snapIndex.value = index;
        // Every path that leaves full — pan release, imperative snapTo, edit
        // lock — stops the list scrolling NOW, not when the spring lands (F2).
        if (index !== FULL) runOnJS(disableScroll)();
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
        // G3: the list implementation swaps on every edit toggle and the fresh
        // instance mounts at top — reset the tracked offset or the stranded
        // positive value makes `beganTop` false forever (dead drag at full).
        scrollOffset.value = 0;
        runOnUI(settle)(editing ? FULL : HALF);
        // settle is a per-render worklet closure; runs on an editing change only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editing, H]);

    // No deps array: the handle is rebuilt each render so snapTo/currentSnap
    // always close over the latest `settle`/`editing`.
    useImperativeHandle(sheetRef, () => ({
        // While the edit lock holds, ANY caller's snap clamps to FULL (G1).
        snapTo: (snap: Snap) => runOnUI(settle)(editing ? FULL : snap),
        currentSnap: () => snapIndex.value,
    }));

    // ── A9 gesture machine (type-verified spike; do not improvise) ───────────────
    // Explicit compose relationships (F2): listPan ↔ nativeScroll run
    // simultaneously (declared both via `simultaneousWithExternalGesture` and
    // the `Gesture.Simultaneous` composition in the detector). headerPan is on
    // a disjoint subtree (handle+header only) and relates to neither.
    const nativeScroll = Gesture.Native();

    const listPan = Gesture.Pan()
        .activeOffsetY([-10, 10])
        .enabled(!editing)
        .simultaneousWithExternalGesture(nativeScroll)
        .onBegin(() => {
            listStartY.value = translateY.value;  // Codex #2: capture at touch-begin
            listAtFull.value = snapIndex.value === FULL;
            listBeganTop.value = scrollOffset.value <= 0;
            listOwns.value = false;
        })
        .onStart(() => {
            if (onPanStart) runOnJS(onPanStart)(); // G1: a real drag supersedes a pending focus
        })
        .onUpdate((e) => {
            // A9-1 / A9-2 ownership — the pure, jest-probed predicate (G3).
            if (!listOwns.value
                && listPanOwnsSheet(listAtFull.value, listBeganTop.value, e.translationY)) {
                listOwns.value = true;
                if (listAtFull.value) runOnJS(disableScroll)();            // Codex #3: leave full now
            }
            if (listOwns.value) translateY.value = clamp(listStartY.value + e.translationY);
            // else A9-3: at full, up / not-from-top → list scrolls natively
        })
        .onFinalize((e) => {
            if (listOwns.value) settle(resolveSnap(translateY.value, e.velocityY, offsets));
        });

    const headerPan = Gesture.Pan()
        .activeOffsetY([-10, 10])
        .enabled(!editing)
        .onBegin(() => {
            headerStartY.value = translateY.value;
        })
        .onStart(() => {
            if (onPanStart) runOnJS(onPanStart)(); // G1: a real drag supersedes a pending focus
        })
        .onUpdate((e) => {
            // No mid-drag scroll disable here (G4): the finger is on the
            // header, and `settle()` disables on release for non-full targets.
            translateY.value = clamp(headerStartY.value + e.translationY);
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
        <Animated.View
            style={[
                styles.sheet,
                { height: SHEET_H, backgroundColor: palette.background },
                sheetStyle,
            ]}
        >
            {/* Fixed drag zone: handle + header ONLY (F2 — headerPan must not
                wrap the list subtree; taps on header actions win via the ±10pt
                activation offset). */}
            <GestureDetector gesture={headerPan}>
                <View collapsable={false}>
                    <View style={styles.handleZone}>
                        <View style={[styles.handle, { backgroundColor: palette.ruleWarmNib }]} />
                    </View>
                    <ListDetailHeader {...headerProps} />
                </View>
            </GestureDetector>

            {editing ? (
                reorder ? (
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
                    // Unranked edit (F3): plain scrollable list at full; the
                    // sheet is pan-locked, so no handoff tracking is needed.
                    <FlatList
                        data={entries}
                        keyExtractor={(item) => item.id}
                        ListHeaderComponent={listHeader}
                        ListEmptyComponent={emptyComponent}
                        renderItem={({ item, index }) => renderRow(item, index)}
                        contentContainerStyle={contentPad}
                        showsVerticalScrollIndicator={false}
                    />
                )
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
