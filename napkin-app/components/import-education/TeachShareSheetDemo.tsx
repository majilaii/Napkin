/**
 * Full-screen, interaction-gated walkthrough for TikTok → iOS share → Napkin.
 *
 * v3: plays bundled screen-recording footage of the REAL flow full-bleed and
 * draws the coaching layer on top - dim scrim with a spotlight hole, a pulsing
 * ring, a coach pill, a magnified callout for small targets, and typewriter
 * captions. Each clip freezes on its decision frame and only a tap on the real
 * target advances the flow (advanceOnTarget), so the walkthrough remains
 * deterministic, offline, and replayable. The hand-built share-sheet replica
 * this replaced lives in git history.
 *
 * Footage assets are placeholders until the real recording lands - see
 * assets/onboarding/teach/FOOTAGE.md for the file-for-file swap.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Image,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { useEventListener } from 'expo';
import { VideoView, useVideoPlayer } from 'expo-video';
import Animated, {
    cancelAnimation,
    Easing,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withRepeat,
    withSequence,
    withTiming,
} from 'react-native-reanimated';

import { Colors } from '@/constants/theme';
import {
    BEAT_COUNT,
    LAST_BEAT,
    TEACH_COPY,
    type TeachTarget,
    advanceOnTarget,
    coverTransform,
    magnifierLayout,
    spotlightBox,
} from './teachDemoUtils';
import { TEACH_FOOTAGE, footageForBeat } from './teachFootage';

type Palette = typeof Colors.light;

export interface TeachShareSheetDemoProps {
    palette: Palette;
    topInset?: number;
    bottomInset?: number;
    onDone?: () => void;
    onClose?: () => void;
    doneLabel?: string;
    isPending?: boolean;
    completionError?: string | null;
}

const RESULT_THUMB = require('../../assets/onboarding/tiktok-crudo.png');
const FIRST_FRAME_FALLBACK_MS = 250;

const SAVED_PLACES = [
    { name: 'Lita', detail: 'Marylebone · Mediterranean', score: '4.8' },
    { name: 'Donia', detail: 'Soho · Filipino', score: '4.7' },
    { name: 'Berenjak', detail: 'Borough · Persian', score: '4.6' },
] as const;

type StageSize = { width: number; height: number };
type BeatPhase = 'playing' | 'ready';

export function TeachShareSheetDemo({
    palette,
    topInset = 0,
    bottomInset = 0,
    onDone,
    onClose,
    doneLabel = TEACH_COPY.doneCta,
    isPending = false,
    completionError = null,
}: TeachShareSheetDemoProps) {
    const reduced = useReducedMotion();
    const [beat, setBeat] = useState(0);
    const [phase, setPhase] = useState<BeatPhase>('playing');
    const [videoFailed, setVideoFailed] = useState(false);
    const [loadedStillBeat, setLoadedStillBeat] = useState<number | null>(null);
    const [liveVideoBeat, setLiveVideoBeat] = useState<number | null>(null);
    const [stage, setStage] = useState<StageSize | null>(null);
    const lastHapticBeat = useRef(beat);
    const activeBeat = useRef(beat);
    const activePlaybackBeat = useRef<number | null>(null);
    const pendingFirstFrameBeat = useRef<number | null>(null);
    const firstFrameFallback = useRef<ReturnType<typeof setTimeout> | null>(null);

    const footage = footageForBeat(beat);
    // Reduced motion never autoplays; a playback error falls back the same way.
    const stillOnly = reduced || videoFailed;
    const stillLoaded = loadedStillBeat === beat;
    const decisionReady = phase === 'ready' && stillLoaded;

    const revealPendingVideo = useCallback(() => {
        const pendingBeat = pendingFirstFrameBeat.current;
        if (pendingBeat === null || pendingBeat !== activeBeat.current) return;
        pendingFirstFrameBeat.current = null;
        if (firstFrameFallback.current) {
            clearTimeout(firstFrameFallback.current);
            firstFrameFallback.current = null;
        }
        setLiveVideoBeat(pendingBeat);
    }, []);

    const player = useVideoPlayer(TEACH_FOOTAGE[0].video, (instance) => {
        instance.muted = true;
        instance.loop = false;
    });

    useEventListener(player, 'playToEnd', () => {
        // A genuine end leaves the playhead at the end of the CURRENT clip. A
        // stale event from a just-replaced (or watchdog-recovered) source finds
        // the new clip near zero and must not mark the new beat ready.
        if (
            activePlaybackBeat.current === activeBeat.current &&
            player.duration > 0 &&
            player.currentTime >= player.duration - 0.3
        ) {
            setPhase('ready');
        }
    });
    useEventListener(player, 'statusChange', ({ status }) => {
        if (status === 'error') setVideoFailed(true);
    });

    useEffect(() => {
        pendingFirstFrameBeat.current = null;
        activePlaybackBeat.current = null;
        if (firstFrameFallback.current) {
            clearTimeout(firstFrameFallback.current);
            firstFrameFallback.current = null;
        }
        if (!footage) {
            // Intro and result beats render no video; a watchdog-recovered clip
            // must not keep playing invisibly behind them.
            try {
                player.pause();
            } catch {
                // player already released during teardown
            }
            return;
        }
        if (stillOnly) {
            try {
                player.pause();
            } catch {
                // player already released during teardown
            }
            setPhase('ready');
            return;
        }
        setPhase('playing');
        let cancelled = false;
        (async () => {
            try {
                await player.replaceAsync(footage.video);
                if (cancelled || activeBeat.current !== beat) return;
                player.currentTime = 0;
                activePlaybackBeat.current = beat;
                pendingFirstFrameBeat.current = beat;
                await Promise.resolve(player.play());
                if (
                    cancelled ||
                    activeBeat.current !== beat ||
                    pendingFirstFrameBeat.current !== beat
                ) {
                    return;
                }
                // onFirstFrameRender is the authoritative cover-release signal.
                // Keep a short fallback for native callback misses.
                firstFrameFallback.current = setTimeout(
                    revealPendingVideo,
                    FIRST_FRAME_FALLBACK_MS,
                );
            } catch {
                if (!cancelled && activeBeat.current === beat) setVideoFailed(true);
            }
        })();
        // If a clip stalls (bad swap, decoder hiccup), unlock the target anyway.
        const watchdog = setTimeout(() => {
            if (!cancelled) setPhase('ready');
        }, footage.durationMs + 3000);
        return () => {
            cancelled = true;
            clearTimeout(watchdog);
            if (pendingFirstFrameBeat.current === beat) {
                pendingFirstFrameBeat.current = null;
            }
            if (activePlaybackBeat.current === beat) {
                activePlaybackBeat.current = null;
            }
            if (firstFrameFallback.current) {
                clearTimeout(firstFrameFallback.current);
                firstFrameFallback.current = null;
            }
            try {
                player.pause();
            } catch {
                // player already released during teardown
            }
        };
    }, [beat, footage, player, revealPendingVideo, stillOnly]);

    useEffect(() => {
        if (lastHapticBeat.current === beat) return;
        lastHapticBeat.current = beat;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    }, [beat]);

    useEffect(() => {
        if (!decisionReady || !footage) return;
        Haptics.selectionAsync().catch(() => undefined);
    }, [decisionReady, footage]);

    const ringPulse = useSharedValue(0);
    useEffect(() => {
        cancelAnimation(ringPulse);
        ringPulse.value = 0;
        if (reduced || !decisionReady || !footage) return;
        ringPulse.value = withRepeat(
            withSequence(
                withTiming(1, { duration: 850, easing: Easing.inOut(Easing.quad) }),
                withTiming(0, { duration: 850, easing: Easing.inOut(Easing.quad) }),
            ),
            -1,
            false,
        );
        return () => cancelAnimation(ringPulse);
    }, [decisionReady, footage, reduced, ringPulse]);

    const ringPulseStyle = useAnimatedStyle(() => ({
        opacity: 0.75 + ringPulse.value * 0.25,
        transform: [{ scale: 1 + ringPulse.value * 0.045 }],
    }));

    const completeTarget = (target: TeachTarget) => {
        // Reset phase in the same batch as the beat change: leaving phase
        // 'ready' until the playback effect runs would flash the NEXT beat's
        // freeze state (still + spotlight + gate) and fire its ready haptic
        // for a frame before the clip starts.
        const next = advanceOnTarget(beat, target);
        if (next === beat) return;
        activeBeat.current = next;
        activePlaybackBeat.current = null;
        pendingFirstFrameBeat.current = null;
        if (firstFrameFallback.current) {
            clearTimeout(firstFrameFallback.current);
            firstFrameFallback.current = null;
        }
        setPhase(stillOnly ? 'ready' : 'playing');
        setLoadedStillBeat(null);
        setLiveVideoBeat(null);
        setBeat(next);
    };

    const overlayGeometry =
        footage && decisionReady && stage
            ? computeOverlayGeometry(footage, stage, topInset)
            : null;
    const holdPreviousFrame = footage && !decisionReady && liveVideoBeat !== beat;

    return (
        <View style={styles.root} accessibilityViewIsModal>
            <StatusBar style={beat === LAST_BEAT ? 'auto' : 'light'} />

            {beat < LAST_BEAT ? (
                <View
                    style={StyleSheet.absoluteFill}
                    pointerEvents="none"
                    onLayout={(event) => setStage(event.nativeEvent.layout)}
                >
                    {!stillOnly && footage ? (
                        <VideoView
                            player={player}
                            style={StyleSheet.absoluteFill}
                            contentFit="cover"
                            nativeControls={false}
                            onFirstFrameRender={revealPendingVideo}
                        />
                    ) : null}
                    {footage ? (
                        // Decode from beat start, but reveal only once both playback
                        // has frozen and this exact beat's still has loaded.
                        <Image
                            key={beat}
                            source={footage.still}
                            resizeMode="cover"
                            onLoad={() => {
                                if (activeBeat.current === beat) setLoadedStillBeat(beat);
                            }}
                            onError={() => {
                                // A still that fails to decode must not gate the walkthrough
                                // shut - degrade to overlaying the paused final frame.
                                if (activeBeat.current === beat) setLoadedStillBeat(beat);
                            }}
                            style={[
                                StyleSheet.absoluteFill,
                                { opacity: decisionReady ? 1 : 0 },
                            ]}
                        />
                    ) : null}
                    {holdPreviousFrame ? <PlaybackCover beat={beat} /> : null}
                </View>
            ) : null}

            {footage ? (
                <View
                    pointerEvents="none"
                    style={[styles.captionWrap, { top: topInset + 34 }]}
                >
                    <TypewriterText
                        key={beat}
                        text={footage.caption}
                        instant={reduced || phase === 'ready'}
                    />
                </View>
            ) : null}

            {footage && overlayGeometry ? (
                <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
                    <View pointerEvents="none" style={overlayGeometry.scrim} />
                    <Animated.View
                        pointerEvents="none"
                        style={[overlayGeometry.ring, ringPulseStyle]}
                    />
                    {overlayGeometry.magnifier ? (
                        <View pointerEvents="none" style={overlayGeometry.magnifier.box}>
                            <Image
                                source={footage.still}
                                resizeMode="stretch"
                                style={overlayGeometry.magnifier.image}
                            />
                        </View>
                    ) : null}
                    {footage.pill === 'left' ? (
                        <CoachMark text={footage.hint} style={overlayGeometry.pill} />
                    ) : (
                        <View pointerEvents="none" style={overlayGeometry.pill}>
                            <CoachMark text={footage.hint} direction="down" />
                        </View>
                    )}
                    <Pressable
                        onPress={() => completeTarget(footage.target)}
                        accessibilityRole="button"
                        accessibilityLabel={footage.a11yLabel}
                        accessibilityHint={footage.a11yHint}
                        style={overlayGeometry.hitbox}
                    />
                </View>
            ) : null}

            {beat === 0 ? (
                <IntroOverlay
                    topInset={topInset}
                    bottomInset={bottomInset}
                    onStart={() => completeTarget('start')}
                />
            ) : null}

            {beat === LAST_BEAT ? (
                <ResultScreen
                    palette={palette}
                    topInset={topInset}
                    bottomInset={bottomInset}
                    doneLabel={doneLabel}
                    isPending={isPending}
                    completionError={completionError}
                    onDone={onDone}
                />
            ) : null}

            {beat > 0 && beat < LAST_BEAT ? (
                <View
                    style={[styles.progressRail, { top: topInset + 4 }]}
                    accessibilityLabel={`Step ${beat} of ${BEAT_COUNT - 1}`}
                >
                    {Array.from({ length: BEAT_COUNT - 1 }).map((_, index) => (
                        <View
                            key={index}
                            style={[styles.progressSegment, { opacity: index < beat ? 0.95 : 0.28 }]}
                        />
                    ))}
                </View>
            ) : null}

            {onClose ? (
                <Pressable
                    onPress={onClose}
                    accessibilityRole="button"
                    accessibilityLabel="Close import tutorial"
                    hitSlop={8}
                    style={({ pressed }) => [
                        styles.closeButton,
                        { top: topInset + 18, transform: [{ scale: pressed ? 0.96 : 1 }] },
                    ]}
                >
                    <Ionicons name="close" size={20} color="#fff" />
                </Pressable>
            ) : null}
        </View>
    );
}

interface OverlayGeometry {
    scrim: object;
    ring: object;
    hitbox: object;
    pill: object;
    magnifier: { box: object; image: object } | null;
}

/**
 * All overlay positioning happens here, in plain objects, from one
 * cover-transform of the footage into the stage. Pure math lives in
 * teachDemoUtils; this only assembles styles.
 */
function computeOverlayGeometry(
    footage: (typeof TEACH_FOOTAGE)[number],
    stage: StageSize,
    topInset: number,
): OverlayGeometry {
    const transform = coverTransform(
        footage.videoWidth,
        footage.videoHeight,
        stage.width,
        stage.height,
    );
    const box = spotlightBox(transform, footage.shape);
    const pad = Math.max(stage.width, stage.height);

    const scrim = {
        position: 'absolute' as const,
        left: box.x - pad,
        top: box.y - pad,
        width: box.width + pad * 2,
        height: box.height + pad * 2,
        borderWidth: pad,
        borderColor: 'rgba(0,0,0,0.55)',
        borderRadius: box.radius + pad,
    };

    const ring = {
        position: 'absolute' as const,
        left: box.x - 3,
        top: box.y - 3,
        width: box.width + 6,
        height: box.height + 6,
        borderRadius: box.radius + 3,
        borderWidth: 2.5,
        borderColor: 'rgba(255,255,255,0.95)',
    };

    const hitbox = {
        position: 'absolute' as const,
        left: box.x - 8,
        top: box.y - 8,
        width: box.width + 16,
        height: box.height + 16,
    };

    const pill =
        footage.pill === 'left'
            ? {
                  position: 'absolute' as const,
                  top: box.y + box.height / 2 - 23,
                  right: stage.width - box.x + 14,
              }
            : {
                  position: 'absolute' as const,
                  left: 0,
                  right: 0,
                  top: Math.max(topInset + 64, box.y - 62),
                  alignItems: 'center' as const,
              };

    let magnifier: OverlayGeometry['magnifier'] = null;
    if (footage.magnifier) {
        const boxWidth = Math.min(stage.width - 48, 340);
        const boxHeight = Math.round(boxWidth * 0.35);
        const layout = magnifierLayout(
            footage.videoWidth,
            footage.videoHeight,
            footage.magnifier.focusX,
            footage.magnifier.focusY,
            footage.magnifier.focusW,
            boxWidth,
            boxHeight,
        );
        magnifier = {
            box: {
                position: 'absolute' as const,
                left: (stage.width - boxWidth) / 2,
                top: Math.max(topInset + 76, box.y - boxHeight - 84),
                width: boxWidth,
                height: boxHeight,
                borderRadius: 22,
                borderWidth: 2.5,
                borderColor: 'rgba(255,255,255,0.95)',
                backgroundColor: '#000',
                overflow: 'hidden' as const,
                shadowColor: '#000',
                shadowOpacity: 0.35,
                shadowRadius: 18,
                shadowOffset: { width: 0, height: 8 },
                elevation: 9,
            },
            image: {
                position: 'absolute' as const,
                left: layout.imageLeft,
                top: layout.imageTop,
                width: layout.imageWidth,
                height: layout.imageHeight,
            },
        };
    }

    return { scrim, ring, hitbox, pill, magnifier };
}

function TypewriterText({ text, instant }: { text: string; instant: boolean }) {
    const [count, setCount] = useState(instant ? text.length : 0);

    useEffect(() => {
        if (instant) {
            setCount(text.length);
            return;
        }
        setCount(0);
        let shown = 0;
        const timer = setInterval(() => {
            shown += 1;
            setCount(shown);
            if (shown >= text.length) clearInterval(timer);
        }, 26);
        return () => clearInterval(timer);
    }, [text, instant]);

    return (
        <Text style={styles.caption} accessibilityLiveRegion="polite">
            {text.slice(0, count)}
        </Text>
    );
}

function PlaybackCover({ beat }: { beat: number }) {
    const previousFootage = footageForBeat(beat - 1);
    if (previousFootage) {
        return (
            <Image
                source={previousFootage.still}
                resizeMode="cover"
                style={StyleSheet.absoluteFill}
            />
        );
    }
    return <IntroBackdrop />;
}

function IntroBackdrop() {
    return (
        <>
            <Image
                source={TEACH_FOOTAGE[0].still}
                resizeMode="cover"
                blurRadius={22}
                style={StyleSheet.absoluteFill}
            />
            <View style={styles.introScrim} />
        </>
    );
}

function IntroOverlay({
    topInset,
    bottomInset,
    onStart,
}: {
    topInset: number;
    bottomInset: number;
    onStart: () => void;
}) {
    return (
        <View style={styles.introOverlay}>
            <IntroBackdrop />
            <View
                style={[
                    styles.introContent,
                    { paddingTop: topInset + 28, paddingBottom: bottomInset + 24 },
                ]}
            >
                <View style={styles.introBadge}>
                    <Ionicons name="logo-tiktok" size={23} color="#fff" />
                </View>
                <Text style={styles.introTitle}>{TEACH_COPY.introTitle}</Text>
                <Text style={styles.introBody}>{TEACH_COPY.introBody}</Text>
                <Pressable
                    onPress={onStart}
                    accessibilityRole="button"
                    accessibilityLabel={TEACH_COPY.startCta}
                    style={({ pressed }) => [
                        styles.introButton,
                        { transform: [{ scale: pressed ? 0.96 : 1 }] },
                    ]}
                >
                    <Text style={styles.introButtonText}>{TEACH_COPY.startCta}</Text>
                    <Ionicons name="arrow-forward" size={18} color="#111" />
                </Pressable>
            </View>
        </View>
    );
}

function ResultScreen({
    palette,
    topInset,
    bottomInset,
    doneLabel,
    isPending,
    completionError,
    onDone,
}: {
    palette: Palette;
    topInset: number;
    bottomInset: number;
    doneLabel: string;
    isPending: boolean;
    completionError: string | null;
    onDone?: () => void;
}) {
    const actionLabel = completionError ? 'Try again' : doneLabel;

    return (
        <View
            style={[
                styles.resultScreen,
                {
                    backgroundColor: palette.background,
                    paddingTop: topInset + 20,
                    paddingBottom: bottomInset + 16,
                },
            ]}
        >
            <View style={styles.resultHeader}>
                <View>
                    <Text style={[styles.resultKicker, { color: palette.primary }]}>NAPKIN</Text>
                    <Text style={[styles.resultPageTitle, { color: palette.text }]}>Wishlist</Text>
                </View>
                <View style={[styles.resultProfile, { backgroundColor: palette.surfaceJournalHi }]}>
                    <Ionicons name="person" size={19} color={palette.textMuted} />
                </View>
            </View>

            <View style={[styles.importSuccess, { backgroundColor: palette.surfaceNote }]}>
                <View style={[styles.successIcon, { backgroundColor: palette.secondaryContainer }]}>
                    <Ionicons name="checkmark" size={21} color={palette.secondary} />
                </View>
                <View style={styles.successCopy}>
                    <Text style={[styles.successTitle, { color: palette.text }]}>{TEACH_COPY.resultTitle}</Text>
                    <Text style={[styles.successBody, { color: palette.textSecondary }]}>{TEACH_COPY.resultBody}</Text>
                </View>
            </View>

            <View style={styles.savedList}>
                {SAVED_PLACES.map((place, index) => (
                    <View
                        key={place.name}
                        style={[
                            styles.savedRow,
                            index < SAVED_PLACES.length - 1
                                ? { borderBottomColor: palette.dividerSoft, borderBottomWidth: StyleSheet.hairlineWidth }
                                : null,
                        ]}
                    >
                        <Image source={RESULT_THUMB} style={styles.savedThumb} />
                        <View style={styles.savedCopy}>
                            <Text style={[styles.savedName, { color: palette.text }]}>{place.name}</Text>
                            <Text style={[styles.savedDetail, { color: palette.textMuted }]}>{place.detail}</Text>
                            <View style={styles.ratingRow}>
                                <Ionicons name="star" size={13} color="#d99522" />
                                <Text style={[styles.rating, { color: palette.textSecondary }]}>{place.score}</Text>
                            </View>
                        </View>
                        <View style={[styles.savedBookmark, { backgroundColor: palette.primaryMuted }]}>
                            <Ionicons name="bookmark" size={17} color={palette.primary} />
                        </View>
                    </View>
                ))}
            </View>

            {completionError ? (
                <View
                    accessible
                    accessibilityRole="alert"
                    accessibilityLiveRegion="polite"
                    style={[
                        styles.completionError,
                        { backgroundColor: palette.surfaceNote, borderColor: palette.error },
                    ]}
                >
                    <Ionicons name="alert-circle" size={19} color={palette.error} />
                    <Text style={[styles.completionErrorText, { color: palette.error }]}>
                        {completionError}
                    </Text>
                </View>
            ) : null}

            <View style={styles.resultSpacer} />
            <Pressable
                onPress={onDone}
                disabled={isPending}
                accessibilityRole="button"
                accessibilityLabel={actionLabel}
                style={({ pressed }) => [
                    styles.doneButton,
                    {
                        backgroundColor: palette.primary,
                        opacity: isPending ? 0.6 : 1,
                        transform: [{ scale: pressed ? 0.96 : 1 }],
                    },
                ]}
            >
                {isPending ? (
                    <ActivityIndicator color={palette.textInverse} />
                ) : (
                    <>
                        <Text style={[styles.doneText, { color: palette.textInverse }]}>{actionLabel}</Text>
                        <Ionicons name="arrow-forward" size={18} color={palette.textInverse} />
                    </>
                )}
            </Pressable>
        </View>
    );
}

function CoachMark({
    text,
    direction = 'right',
    style,
}: {
    text: string;
    direction?: 'right' | 'down';
    style?: object | object[];
}) {
    return (
        <View style={[styles.coachMark, style]} pointerEvents="none">
            <Text style={styles.coachText}>{text}</Text>
            <Ionicons
                name={direction === 'right' ? 'arrow-forward' : 'arrow-down'}
                size={17}
                color="#111"
            />
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
    captionWrap: { position: 'absolute', left: 24, right: 24, alignItems: 'center', zIndex: 40 },
    caption: {
        color: '#fff', fontFamily: 'Manrope_700Bold', fontSize: 17, lineHeight: 23, textAlign: 'center',
        textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5,
    },
    coachMark: {
        height: 46, borderRadius: 23, paddingLeft: 17, paddingRight: 14, backgroundColor: '#fff',
        flexDirection: 'row', alignItems: 'center', gap: 9, shadowColor: '#000', shadowOpacity: 0.2,
        shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 7, zIndex: 30,
    },
    coachText: { color: '#111', fontFamily: 'Manrope_700Bold', fontSize: 14 },
    progressRail: { position: 'absolute', left: 13, right: 13, height: 3, flexDirection: 'row', gap: 4, zIndex: 50 },
    progressSegment: { flex: 1, height: 3, borderRadius: 2, backgroundColor: '#fff' },
    closeButton: {
        position: 'absolute', right: 14, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)',
        alignItems: 'center', justifyContent: 'center', zIndex: 90,
    },
    introOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 70 },
    introScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.66)' },
    introContent: { flex: 1, paddingHorizontal: 28, justifyContent: 'flex-end', alignItems: 'center' },
    introBadge: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
    introTitle: { color: '#fff', fontFamily: 'Newsreader_700Bold', fontSize: 42, lineHeight: 46, textAlign: 'center' },
    introBody: { color: 'rgba(255,255,255,0.82)', fontFamily: 'Manrope_500Medium', fontSize: 16, lineHeight: 23, textAlign: 'center', marginTop: 12, maxWidth: 340 },
    introButton: { marginTop: 28, width: '100%', height: 58, borderRadius: 29, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
    introButtonText: { color: '#111', fontFamily: 'Manrope_700Bold', fontSize: 16 },
    resultScreen: { ...StyleSheet.absoluteFillObject, paddingHorizontal: 18 },
    resultHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
    resultKicker: { fontFamily: 'Manrope_700Bold', fontSize: 11, letterSpacing: 2.5, marginBottom: 2 },
    resultPageTitle: { fontFamily: 'Newsreader_700Bold', fontSize: 36, lineHeight: 41 },
    resultProfile: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
    importSuccess: { minHeight: 82, borderRadius: 22, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.1)' },
    successIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
    successCopy: { flex: 1 },
    successTitle: { fontFamily: 'Manrope_700Bold', fontSize: 15, marginBottom: 3 },
    successBody: { fontFamily: 'Manrope_500Medium', fontSize: 13, lineHeight: 18 },
    savedList: { marginTop: 18 },
    savedRow: { minHeight: 82, flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
    savedThumb: { width: 62, height: 62, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.1)' },
    savedCopy: { flex: 1, paddingHorizontal: 12 },
    savedName: { fontFamily: 'Newsreader_700Bold', fontSize: 20, lineHeight: 23 },
    savedDetail: { fontFamily: 'Manrope_500Medium', fontSize: 13, marginTop: 2 },
    ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
    rating: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, fontVariant: ['tabular-nums'] },
    savedBookmark: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    completionError: {
        minHeight: 54, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 9,
    },
    completionErrorText: { flex: 1, fontFamily: 'Manrope_600SemiBold', fontSize: 13, lineHeight: 18 },
    resultSpacer: { flex: 1 },
    doneButton: { height: 58, borderRadius: 29, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
    doneText: { fontFamily: 'Manrope_700Bold', fontSize: 16 },
});
