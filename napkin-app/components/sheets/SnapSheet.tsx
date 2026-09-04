import React, {
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
    runOnJS,
    runOnUI,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
    type SharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import {
    FULL,
    HALF,
    listPanOwnsSheet,
    offsetsFor,
    resolveSnap,
    sheetHeight,
    visibleHeight,
    type Snap,
    type SnapMetrics,
} from './snapSheetMath';

export interface SnapSheetHandle {
    snapTo: (snap: Snap) => void;
    currentSnap: () => Snap;
}

export interface SnapSheetContentContext {
    scrollEnabled: boolean;
    onScroll: ReturnType<typeof useAnimatedScrollHandler>;
}

interface SnapSheetProps {
    H: number;
    initialSnap?: Snap;
    locked?: boolean;
    lockedSnap?: Snap;
    unlockedSnap?: Snap;
    sheetRef: React.Ref<SnapSheetHandle>;
    onSettle: (snap: Snap, height: number) => void;
    onPanStart?: () => void;
    renderHeader?: () => React.ReactNode;
    renderContent: (context: SnapSheetContentContext) => React.ReactNode;
    /** Identity of the mounted scroll surface; changing it resets native-list handoff state. */
    contentKey?: string;
    backgroundColor?: string;
    handleColor?: string;
    metrics?: SnapMetrics;
    style?: StyleProp<ViewStyle>;
    /** Optional caller-owned translation channel, written on every drag and spring frame. */
    translateY?: SharedValue<number>;
}

// Reanimated's mass default is 4. Explicit mass 1 keeps the proven TICKET-186
// settle timing and avoids visible overshoot.
const SPRING = { damping: 22, stiffness: 220, mass: 1 } as const;

export function SnapSheet({
    H,
    initialSnap = HALF,
    locked = false,
    lockedSnap = FULL,
    unlockedSnap = HALF,
    sheetRef,
    onSettle,
    onPanStart,
    renderHeader,
    renderContent,
    contentKey,
    backgroundColor = Colors.light.surfaceNote,
    handleColor = Colors.light.ruleWarmNib,
    metrics,
    style,
    translateY: externalTranslateY,
}: SnapSheetProps) {
    const offsets = useMemo(() => offsetsFor(H, metrics), [H, metrics]);
    const firstSnap = locked ? lockedSnap : initialSnap;
    const internalTranslateY = useSharedValue(offsets[firstSnap]);
    const seededExternalTranslateY = useRef<SharedValue<number> | null>(null);
    if (externalTranslateY && seededExternalTranslateY.current !== externalTranslateY) {
        externalTranslateY.value = offsets[firstSnap];
        seededExternalTranslateY.current = externalTranslateY;
    }
    const translateY = externalTranslateY ?? internalTranslateY;
    const snapIndex = useSharedValue<Snap>(firstSnap);

    // Disjoint gesture state. Ownership is captured onBegin, never onStart.
    const listStartY = useSharedValue(0);
    const listAtFull = useSharedValue(false);
    const listBeganTop = useSharedValue(true);
    const listOwns = useSharedValue(false);
    const headerStartY = useSharedValue(0);
    const scrollOffset = useSharedValue(0);
    const [scrollEnabled, setScrollEnabled] = useState(firstSnap === FULL);

    const onScroll = useAnimatedScrollHandler((event) => {
        scrollOffset.value = event.contentOffset.y;
    });

    const disableScroll = () => setScrollEnabled(false);
    const commitSettle = (snap: Snap) => {
        setScrollEnabled(snap === FULL);
        onSettle(snap, visibleHeight(H, snap, metrics));
    };
    const settle = (snap: Snap) => {
        'worklet';
        snapIndex.value = snap;
        if (snap !== FULL) runOnJS(disableScroll)();
        translateY.value = withSpring(offsets[snap], SPRING, (finished) => {
            if (finished) runOnJS(commitSettle)(snap);
        });
    };
    const clamp = (value: number) => {
        'worklet';
        return Math.min(Math.max(value, 0), offsets[0]);
    };

    // Initial metric/rotation alignment. Emit synchronously so callers receive
    // the mount detent even when the timing callback is interrupted.
    useEffect(() => {
        if (H <= 0) return;
        const snap = snapIndex.value;
        translateY.value = withTiming(offsets[snap], { duration: 220 });
        commitSettle(snap);
        // shared values and the render-local worklet are intentionally omitted.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [H, offsets]);

    const previousLocked = useRef(locked);
    useEffect(() => {
        if (previousLocked.current === locked || H <= 0) return;
        previousLocked.current = locked;
        scrollOffset.value = 0;
        runOnUI(settle)(locked ? lockedSnap : unlockedSnap);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [locked, H, lockedSnap, unlockedSnap]);

    const previousContentKey = useRef(contentKey);
    useEffect(() => {
        if (contentKey === undefined || previousContentKey.current === contentKey) return;
        previousContentKey.current = contentKey;
        runOnUI(() => {
            'worklet';
            scrollOffset.value = 0;
            listBeganTop.value = true;
        })();
        // Shared values are stable Reanimated handles.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contentKey]);

    useImperativeHandle(sheetRef, () => ({
        snapTo: (snap) => runOnUI(settle)(locked ? lockedSnap : snap),
        currentSnap: () => snapIndex.value,
    }));

    const nativeScroll = Gesture.Native();
    const listPan = Gesture.Pan()
        .activeOffsetY([-10, 10])
        .enabled(!locked)
        .simultaneousWithExternalGesture(nativeScroll)
        .onBegin(() => {
            listStartY.value = translateY.value;
            listAtFull.value = snapIndex.value === FULL;
            listBeganTop.value = scrollOffset.value <= 0;
            listOwns.value = false;
        })
        .onStart(() => {
            if (onPanStart) runOnJS(onPanStart)();
        })
        .onUpdate((event) => {
            if (
                !listOwns.value
                && listPanOwnsSheet(listAtFull.value, listBeganTop.value, event.translationY)
            ) {
                listOwns.value = true;
                if (listAtFull.value) runOnJS(disableScroll)();
            }
            if (listOwns.value) {
                translateY.value = clamp(listStartY.value + event.translationY);
            }
        })
        .onFinalize((event) => {
            if (listOwns.value) settle(resolveSnap(translateY.value, event.velocityY, offsets));
        });

    const headerPan = Gesture.Pan()
        .activeOffsetY([-10, 10])
        .enabled(!locked)
        .onBegin(() => {
            headerStartY.value = translateY.value;
        })
        .onStart(() => {
            if (onPanStart) runOnJS(onPanStart)();
        })
        .onUpdate((event) => {
            translateY.value = clamp(headerStartY.value + event.translationY);
        })
        .onFinalize((event) => {
            settle(resolveSnap(translateY.value, event.velocityY, offsets));
        });

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: translateY.value }],
    }));

    return (
        <Animated.View
            style={[
                styles.sheet,
                { height: sheetHeight(H, metrics), backgroundColor },
                style,
                animatedStyle,
            ]}
        >
            <GestureDetector gesture={headerPan}>
                <View collapsable={false}>
                    <View style={styles.handleZone}>
                        <View style={[styles.handle, { backgroundColor: handleColor }]} />
                    </View>
                    {renderHeader?.()}
                </View>
            </GestureDetector>
            <GestureDetector gesture={Gesture.Simultaneous(listPan, nativeScroll)}>
                {/* Keyed on contentKey so the native scroll surface remounts atomically
                    with the handoff reset — a retained (placeholderData) list can never
                    stay scrolled while the controller believes it is at the top. */}
                <View key={contentKey ?? 'content'} style={styles.content} collapsable={false}>
                    {renderContent({ scrollEnabled, onScroll })}
                </View>
            </GestureDetector>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    sheet: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        borderTopLeftRadius: Radius.xl,
        borderTopRightRadius: Radius.xl,
        overflow: 'hidden',
        ...Shadow.nav,
    },
    handleZone: {
        alignItems: 'center',
        paddingTop: Spacing.sheet.handleTop,
        paddingBottom: Spacing.sheet.handleBottom,
    },
    handle: {
        width: Spacing.sheet.handleWidth,
        height: Spacing.sheet.handleHeight,
        borderRadius: Radius.full,
    },
    content: {
        flex: 1,
    },
});
