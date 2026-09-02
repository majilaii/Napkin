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
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { Colors } from '@/constants/theme';
import {
    FULL,
    HALF,
    listPanOwnsSheet,
    offsetsFor,
    resolveSnap,
    sheetHeight,
    visibleHeight,
    type Snap,
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
    backgroundColor?: string;
    style?: StyleProp<ViewStyle>;
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
    backgroundColor = Colors.light.surfaceNote,
    style,
}: SnapSheetProps) {
    const offsets = useMemo(() => offsetsFor(H), [H]);
    const firstSnap = locked ? lockedSnap : initialSnap;
    const translateY = useSharedValue(offsetsFor(H)[firstSnap]);
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
        onSettle(snap, visibleHeight(H, snap));
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

    // Initial metric/rotation alignment. Settled height is emitted only at rest.
    useEffect(() => {
        if (H <= 0) return;
        const snap = snapIndex.value;
        translateY.value = withTiming(offsets[snap], { duration: 220 }, (finished) => {
            if (finished) runOnJS(commitSettle)(snap);
        });
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
                { height: sheetHeight(H), backgroundColor },
                style,
                animatedStyle,
            ]}
        >
            <GestureDetector gesture={headerPan}>
                <View collapsable={false}>
                    <View style={styles.handleZone}>
                        <View style={styles.handle} />
                    </View>
                    {renderHeader?.()}
                </View>
            </GestureDetector>
            <GestureDetector gesture={Gesture.Simultaneous(listPan, nativeScroll)}>
                <View style={styles.content} collapsable={false}>
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
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        overflow: 'hidden',
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
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: 'rgba(28,28,25,0.12)',
    },
    content: {
        flex: 1,
    },
});
