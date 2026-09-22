import { useEffect } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import Animated, {
    cancelAnimation,
    Easing,
    FadeIn,
    interpolate,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withDelay,
    withRepeat,
    withSequence,
    withTiming,
} from 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';

import { PressableScale } from '@/components/ui/napkin';
import { Colors, Radius, Spacing } from '@/constants/theme';

import { LAUNCH_LAYOUT, SPLASH_WORDMARK_SIZE } from './launchLayout';
import {
    isLaunchBusy,
    LAUNCH_COPY,
    LAUNCH_TIMING,
    launchStatusLine,
    type LaunchMode,
    type LaunchPhase,
    type LaunchStatus,
} from './launchState';

const SPLASH_WORDMARK = require('@/assets/images/splash-wordmark.png');

// The app and its native splash are light-only (hooks/use-color-scheme).
const palette = Colors.light;

/** A pen stroke: quick to leave the nib, slow to settle. */
const DRAW = Easing.bezier(0.22, 1, 0.36, 1);
const LEAVE = Easing.in(Easing.cubic);
const DISSOLVE = Easing.out(Easing.cubic);
const NIB_FADE_MS = 160;
/** Rules draw in full terracotta, then dry to the masthead's quiet 25%. */
const WET_INK = 0.9;
const DRY_INK = 0.25;

interface Props {
    mode: LaunchMode;
    phase: LaunchPhase;
    status: LaunchStatus;
    slow: boolean;
    onWordmarkLoaded: () => void;
}

/**
 * The Napkin launch screen: the wordmark from the native splash, framed by the
 * masthead hairlines, with a pen stroke running along the lower rule while
 * the app restores the session and checks the account. It is the only thing
 * a cold launch shows until the first real screen is ready.
 */
export function LaunchScreen({ mode, phase, status, slow, onWordmarkLoaded }: Props) {
    const reduceMotion = useReducedMotion();
    const startDrawn = mode === 'resume';

    const upperRule = useSharedValue(startDrawn ? 1 : 0);
    const lowerRule = useSharedValue(startDrawn ? 1 : 0);
    const ink = useSharedValue(startDrawn || reduceMotion ? DRY_INK : WET_INK);
    const masthead = useSharedValue(startDrawn ? 0 : 1);
    const lift = useSharedValue(0);
    const paper = useSharedValue(1);
    const nib = useSharedValue(0);
    const nibVisible = useSharedValue(0);

    useEffect(() => {
        if (phase !== 'intro') return;
        if (mode === 'resume') {
            masthead.set(withTiming(1, { duration: LAUNCH_TIMING.resumeFadeMs }));
            return;
        }
        if (reduceMotion) {
            // No drawing: the finished rules simply fade in.
            const fade = { duration: LAUNCH_TIMING.resumeFadeMs };
            upperRule.set(withTiming(1, fade));
            lowerRule.set(withTiming(1, fade));
            return;
        }
        const draw = { duration: LAUNCH_TIMING.ruleDrawMs, easing: DRAW };
        upperRule.set(withDelay(LAUNCH_TIMING.ruleDelayMs, withTiming(1, draw)));
        lowerRule.set(
            withDelay(LAUNCH_TIMING.ruleDelayMs + LAUNCH_TIMING.ruleStaggerMs, withTiming(1, draw)),
        );
        ink.set(
            withDelay(
                LAUNCH_TIMING.inkDryDelayMs,
                withTiming(DRY_INK, { duration: LAUNCH_TIMING.inkDryMs, easing: DISSOLVE }),
            ),
        );
    }, [phase, mode, reduceMotion, masthead, upperRule, lowerRule, ink]);

    const busy = phase === 'waiting' && isLaunchBusy(status);
    useEffect(() => {
        if (!busy) {
            cancelAnimation(nib);
            nibVisible.set(withTiming(0, { duration: NIB_FADE_MS }));
            return;
        }
        nibVisible.set(withTiming(1, { duration: NIB_FADE_MS }));
        nib.set(0);
        nib.set(
            reduceMotion
                // Reduced motion: the lower rule breathes in place instead.
                ? withRepeat(withTiming(1, { duration: LAUNCH_TIMING.nibPassMs }), -1, true)
                : withRepeat(
                      withSequence(
                          withTiming(1, {
                              duration: LAUNCH_TIMING.nibPassMs,
                              easing: Easing.inOut(Easing.cubic),
                          }),
                          withTiming(1, { duration: LAUNCH_TIMING.nibRestMs }),
                          withTiming(0, { duration: 0 }),
                      ),
                      -1,
                  ),
        );
    }, [busy, reduceMotion, nib, nibVisible]);

    useEffect(() => {
        if (phase !== 'exiting') return;
        const leave = { duration: LAUNCH_TIMING.exitMastheadMs, easing: LEAVE };
        masthead.set(withTiming(0, leave));
        if (!reduceMotion) lift.set(withTiming(-LAUNCH_LAYOUT.exitLift, leave));
        paper.set(
            withDelay(
                LAUNCH_TIMING.exitPaperDelayMs,
                withTiming(0, { duration: LAUNCH_TIMING.exitPaperMs, easing: DISSOLVE }),
            ),
        );
    }, [phase, reduceMotion, masthead, lift, paper]);

    const paperStyle = useAnimatedStyle(() => ({ opacity: paper.get() }));
    const mastheadStyle = useAnimatedStyle(() => ({
        opacity: masthead.get(),
        transform: [{ translateY: lift.get() }],
    }));
    // Drawn outward from the centre; with reduced motion the rules fade in.
    const upperRuleStyle = useAnimatedStyle(() =>
        reduceMotion
            ? { opacity: upperRule.get() * DRY_INK }
            : { opacity: ink.get(), transform: [{ scaleX: upperRule.get() }] },
    );
    const lowerRuleStyle = useAnimatedStyle(() =>
        reduceMotion
            ? { opacity: lowerRule.get() }
            : { transform: [{ scaleX: lowerRule.get() }] },
    );
    const lowerInkStyle = useAnimatedStyle(() => ({
        opacity: reduceMotion ? DRY_INK : ink.get(),
    }));
    const nibStyle = useAnimatedStyle(() => {
        if (reduceMotion) {
            return {
                width: LAUNCH_LAYOUT.ruleWidth,
                opacity: nibVisible.get() * (0.15 + 0.45 * nib.get()),
                transform: [{ translateX: 0 }],
            };
        }
        const progress = nib.get();
        return {
            width: LAUNCH_LAYOUT.nibWidth,
            opacity: nibVisible.get() * interpolate(progress, [0, 0.18, 0.82, 1], [0, 1, 1, 0]),
            transform: [
                {
                    translateX: interpolate(
                        progress,
                        [0, 1],
                        [-LAUNCH_LAYOUT.nibWidth, LAUNCH_LAYOUT.ruleWidth],
                    ),
                },
            ],
        };
    });

    const exiting = phase === 'exiting' || phase === 'done';
    const line = launchStatusLine(status, slow);
    const needsRetry = status.kind === 'offline' || status.kind === 'unreachable';
    const retrying = status.kind === 'offline' && status.retrying;

    return (
        <View
            style={StyleSheet.absoluteFill}
            pointerEvents={exiting ? 'none' : 'auto'}
            accessibilityViewIsModal={!exiting}
            testID="launch-screen"
        >
            <Animated.View style={[StyleSheet.absoluteFill, styles.paper, paperStyle]} />
            <View style={styles.center} pointerEvents="box-none">
                <Animated.View style={[styles.stage, mastheadStyle]} pointerEvents="box-none">
                    <Image
                        source={SPLASH_WORDMARK}
                        style={styles.wordmark}
                        resizeMode="contain"
                        fadeDuration={0}
                        onLoad={onWordmarkLoaded}
                        accessible
                        accessibilityRole="image"
                        accessibilityLabel="Napkin"
                        testID="launch-wordmark"
                    />
                    <Animated.View style={[styles.upperRule, upperRuleStyle]} />
                    <Animated.View
                        style={[styles.lowerRule, lowerRuleStyle]}
                        accessible={busy}
                        accessibilityRole={busy ? 'progressbar' : undefined}
                        accessibilityLabel={busy ? 'Loading' : undefined}
                        accessibilityState={busy ? { busy: true } : undefined}
                    >
                        <Animated.View style={[styles.lowerHairline, lowerInkStyle]} />
                        <Animated.View style={[styles.nib, nibStyle]} />
                    </Animated.View>
                    {line ? (
                        <Animated.View
                            key={line}
                            entering={FadeIn.duration(220)}
                            style={styles.status}
                            accessibilityRole={needsRetry ? 'alert' : undefined}
                            accessibilityLiveRegion="polite"
                            testID="launch-status"
                        >
                            <Text style={needsRetry ? styles.problem : styles.quiet}>{line}</Text>
                            {needsRetry ? (
                                <PressableScale
                                    onPress={status.retry}
                                    disabled={retrying}
                                    haptic="selection"
                                    accessibilityRole="button"
                                    accessibilityLabel={
                                        status.kind === 'offline'
                                            ? 'Try connection again'
                                            : 'Try reaching Napkin again'
                                    }
                                    accessibilityState={{ busy: retrying, disabled: retrying }}
                                    testID="launch-retry"
                                    style={[styles.retry, { opacity: retrying ? 0.6 : 1 }]}
                                >
                                    {retrying ? (
                                        <ActivityIndicator size="small" color={palette.primary} />
                                    ) : (
                                        <Text style={styles.retryLabel}>{LAUNCH_COPY.retry}</Text>
                                    )}
                                </PressableScale>
                            ) : null}
                        </Animated.View>
                    ) : null}
                </Animated.View>
            </View>
            {exiting ? null : <StatusBar style="dark" />}
        </View>
    );
}

const half = SPLASH_WORDMARK_SIZE / 2;
const hairline = StyleSheet.hairlineWidth;
const ruleLeft = (SPLASH_WORDMARK_SIZE - LAUNCH_LAYOUT.ruleWidth) / 2;
// The lower rule is a strip as tall as the pen stroke, with the hairline
// running through its middle, so the stroke is centred on the rule.
const lowerRuleTop = half + LAUNCH_LAYOUT.ruleOffset + hairline / 2 - LAUNCH_LAYOUT.nibHeight / 2;

const styles = StyleSheet.create({
    paper: {
        backgroundColor: palette.background,
    },
    center: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
    },
    // The only in-flow child is the wordmark square, so the square sits at the
    // exact centre of the screen, where the native splash draws it.
    stage: {
        width: SPLASH_WORDMARK_SIZE,
        height: SPLASH_WORDMARK_SIZE,
    },
    wordmark: {
        width: SPLASH_WORDMARK_SIZE,
        height: SPLASH_WORDMARK_SIZE,
    },
    upperRule: {
        position: 'absolute',
        top: half - LAUNCH_LAYOUT.ruleOffset,
        left: ruleLeft,
        width: LAUNCH_LAYOUT.ruleWidth,
        height: hairline,
        backgroundColor: palette.primary,
    },
    lowerRule: {
        position: 'absolute',
        top: lowerRuleTop,
        left: ruleLeft,
        width: LAUNCH_LAYOUT.ruleWidth,
        height: LAUNCH_LAYOUT.nibHeight,
        overflow: 'hidden',
    },
    lowerHairline: {
        position: 'absolute',
        top: (LAUNCH_LAYOUT.nibHeight - hairline) / 2,
        left: 0,
        right: 0,
        height: hairline,
        backgroundColor: palette.primary,
    },
    nib: {
        position: 'absolute',
        top: 0,
        left: 0,
        height: LAUNCH_LAYOUT.nibHeight,
        borderRadius: LAUNCH_LAYOUT.nibHeight,
        backgroundColor: palette.primary,
    },
    status: {
        position: 'absolute',
        top: half + LAUNCH_LAYOUT.statusTop,
        left: (SPLASH_WORDMARK_SIZE - LAUNCH_LAYOUT.statusWidth) / 2,
        width: LAUNCH_LAYOUT.statusWidth,
        alignItems: 'center',
        gap: Spacing.md,
    },
    quiet: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
        lineHeight: 18,
        color: palette.textMuted,
        textAlign: 'center',
    },
    problem: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 16,
        lineHeight: 22,
        color: palette.text,
        textAlign: 'center',
    },
    retry: {
        minWidth: LAUNCH_LAYOUT.retryMinWidth,
        minHeight: LAUNCH_LAYOUT.retryMinHeight,
        paddingHorizontal: Spacing.lg,
        borderRadius: Radius.full,
        borderWidth: 1,
        borderColor: palette.primary,
        alignItems: 'center',
        justifyContent: 'center',
    },
    retryLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
        letterSpacing: 0.3,
        color: palette.primary,
    },
});
