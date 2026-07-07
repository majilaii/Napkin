/**
 * TeachShareSheetDemo — the onboarding teach body (TICKET-122, Surface A).
 *
 * A self-contained, auto-advancing 3-beat stage rendered entirely from theme
 * components (NO screenshots, NO real-OS overlay — iOS forbids drawing over other
 * apps, so Rodeo's "live" share-sheet demo is itself an in-app replica; this is
 * ours):
 *   Beat 0 — benefit: a video tile with a terracotta scanline sweeping top→bottom
 *            ("we watch the whole video").
 *   Beat 1 — an in-app iOS-share-sheet REPLICA sliding up: neutral app tiles + the
 *            terracotta napkin tile, with "tap share" then a bouncing "tap napkin".
 *   Beat 2 — pro-tip: a star fills on the napkin tile (add to share favourites).
 *
 * Timers live in a ref and are cleared on unmount. useReducedMotion() → skip all
 * timers/animation and render Beat 2 statically with copy visible. Tapping the
 * stage advances a beat early (clamped). Sole accent = terracotta.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
    Easing,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withDelay,
    withRepeat,
    withTiming,
} from 'react-native-reanimated';

import { Colors, Radius } from '@/constants/theme';
import {
    BEAT_COUNT,
    BEAT_TIMINGS_MS,
    LAST_BEAT,
    TEACH_COPY,
    advanceBeat,
} from './teachDemoUtils';

type Palette = typeof Colors.light;

const STAGE_H = 240;
const SCAN_TRAVEL = 104; // px the scanline sweeps down the video tile

export function TeachShareSheetDemo({ palette }: { palette: Palette }) {
    const reduced = useReducedMotion();
    const [beat, setBeat] = useState(reduced ? LAST_BEAT : 0);
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

    // Crossfade driver mirrored from React state (dots need state anyway).
    const beatSV = useSharedValue(reduced ? LAST_BEAT : 0);
    // Per-beat animation values.
    const intro = useSharedValue(reduced ? 1 : 0); // Beat 0 entrance
    const scan = useSharedValue(0); // Beat 0 scanline sweep (0→1 repeat)
    const sheetY = useSharedValue(reduced ? 0 : 40); // Beat 1 sheet slide
    const sheetOp = useSharedValue(reduced ? 1 : 0);
    const coach = useSharedValue(0); // Beat 1 "tap napkin" bounce
    const star = useSharedValue(reduced ? 1 : 0); // Beat 2 star fill pulse

    useEffect(() => {
        beatSV.value = beat;
    }, [beat, beatSV]);

    // Timeline — skipped entirely under reduced motion (Beat 2 is already shown).
    useEffect(() => {
        if (reduced) return;
        intro.value = withTiming(1, { duration: 350, easing: Easing.out(Easing.cubic) });
        scan.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, false);
        // Monotonic: a tap-ahead must never be yanked back by a stale timer.
        const t1 = setTimeout(() => setBeat((b) => Math.max(b, 1)), BEAT_TIMINGS_MS.beat1To2);
        const t2 = setTimeout(() => setBeat((b) => Math.max(b, 2)), BEAT_TIMINGS_MS.beat2To3);
        timers.current.push(t1, t2);
        return () => {
            timers.current.forEach(clearTimeout);
            timers.current = [];
        };
    }, [reduced, intro, scan]);

    // Per-beat entrance animations, fired when the beat becomes visible (tap or timer).
    useEffect(() => {
        if (reduced) return;
        if (beat >= 1) {
            sheetY.value = withTiming(0, { duration: 320, easing: Easing.out(Easing.cubic) });
            sheetOp.value = withTiming(1, { duration: 320 });
            coach.value = withDelay(800, withRepeat(withTiming(1, { duration: 620, easing: Easing.inOut(Easing.quad) }), -1, true));
        }
        if (beat >= 2) {
            star.value = withRepeat(withTiming(1, { duration: 720, easing: Easing.inOut(Easing.quad) }), -1, true);
        }
    }, [beat, reduced, sheetY, sheetOp, coach, star]);

    const onTap = () => {
        if (!reduced) setBeat((b) => advanceBeat(b));
    };

    // Crossfade layer opacities (target derived from beatSV → animated on the UI thread).
    const layer0 = useAnimatedStyle(() => ({ opacity: withTiming(beatSV.value === 0 ? 1 : 0, { duration: 280 }) }));
    const layer1 = useAnimatedStyle(() => ({ opacity: withTiming(beatSV.value === 1 ? 1 : 0, { duration: 280 }) }));
    const layer2 = useAnimatedStyle(() => ({ opacity: withTiming(beatSV.value === 2 ? 1 : 0, { duration: 280 }) }));

    const introStyle = useAnimatedStyle(() => ({
        opacity: intro.value,
        transform: [{ translateY: (1 - intro.value) * 12 }],
    }));
    const scanStyle = useAnimatedStyle(() => ({ transform: [{ translateY: scan.value * SCAN_TRAVEL }] }));
    const sheetStyle = useAnimatedStyle(() => ({ opacity: sheetOp.value, transform: [{ translateY: sheetY.value }] }));
    const coachStyle = useAnimatedStyle(() => ({
        opacity: 0.55 + 0.45 * coach.value,
        transform: [{ translateY: -coach.value * 6 }],
    }));
    const starStyle = useAnimatedStyle(() => ({ opacity: star.value, transform: [{ scale: 0.9 + 0.2 * star.value }] }));

    return (
        <Pressable onPress={onTap} accessibilityRole="button" accessibilityLabel="next">
            <View style={[styles.stage, { backgroundColor: palette.surfaceJournalLow }]}>
                {/* ── Beat 0 — benefit ─────────────────────────────────────── */}
                <Animated.View style={[styles.layer, layer0]} pointerEvents="none">
                    <Animated.View style={introStyle}>
                        <View style={[styles.videoTile, { backgroundColor: palette.surfaceJournal }]}>
                            <Ionicons name="play" size={26} color={palette.textSecondary} />
                            <Animated.View style={[styles.scanline, { backgroundColor: palette.primary }, scanStyle]} />
                        </View>
                        <Text style={[styles.benefit, { color: palette.text }]}>{TEACH_COPY.benefit}</Text>
                    </Animated.View>
                </Animated.View>

                {/* ── Beat 1 — animated in-app share-sheet replica ─────────── */}
                <Animated.View style={[styles.layer, layer1]} pointerEvents="none">
                    <View style={[styles.scrim, { backgroundColor: palette.overlay }]} />
                    <Animated.View style={[styles.sheet, { backgroundColor: palette.surfaceNote }, sheetStyle]}>
                        <View style={[styles.sheetGrip, { backgroundColor: palette.outlineVariant }]} />
                        <View style={styles.tileRow}>
                            {['', '', 'napkin'].map((label, i) => {
                                const isNapkin = label === 'napkin';
                                return (
                                    <View key={i} style={styles.tileCol}>
                                        <View
                                            style={[
                                                styles.appTile,
                                                {
                                                    backgroundColor: isNapkin
                                                        ? palette.primary
                                                        : palette.surfaceJournalHi,
                                                },
                                            ]}
                                        >
                                            {isNapkin ? (
                                                <Ionicons name="bookmark" size={20} color="#fff" />
                                            ) : null}
                                        </View>
                                        {isNapkin ? (
                                            <Text style={[styles.tileLabel, { color: palette.textSecondary }]}>napkin</Text>
                                        ) : (
                                            <View style={styles.tileLabelGap} />
                                        )}
                                    </View>
                                );
                            })}
                        </View>
                        <View style={styles.coachRow}>
                            <View style={styles.coachItem}>
                                <Ionicons name="share-outline" size={16} color={palette.textMuted} />
                                <Text style={[styles.coachLabel, { color: palette.textMuted }]}>{TEACH_COPY.tapShare}</Text>
                            </View>
                            <Animated.View style={[styles.coachItem, coachStyle]}>
                                <Ionicons name="arrow-forward" size={16} color={palette.primary} />
                                <Text style={[styles.coachLabel, { color: palette.primary }]}>{TEACH_COPY.tapNapkin}</Text>
                            </Animated.View>
                        </View>
                    </Animated.View>
                </Animated.View>

                {/* ── Beat 2 — pro-tip (terminal) ──────────────────────────── */}
                <Animated.View style={[styles.layer, layer2]} pointerEvents="none">
                    <View style={[styles.napkinFavTile, { backgroundColor: palette.primary }]}>
                        <Ionicons name="bookmark" size={26} color="#fff" />
                        {/* Sole accent stays terracotta (beat spec) — no amber here. */}
                        <Animated.View style={[styles.starBadge, { backgroundColor: palette.surfaceNote }, starStyle]}>
                            <Ionicons name="star" size={13} color={palette.primary} />
                        </Animated.View>
                    </View>
                    <Text style={[styles.benefit, { color: palette.text }]}>{TEACH_COPY.proTip}</Text>
                </Animated.View>
            </View>

            {/* Progress dots */}
            <View style={styles.dots}>
                {Array.from({ length: BEAT_COUNT }).map((_, i) => (
                    <View
                        key={i}
                        style={[
                            styles.dot,
                            {
                                backgroundColor: i === beat ? palette.primary : palette.outlineVariant,
                                width: i === beat ? 18 : 6,
                            },
                        ]}
                    />
                ))}
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    stage: {
        height: STAGE_H,
        borderRadius: Radius.xl,
        overflow: 'hidden',
    },
    layer: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 26,
    },
    // Beat 0
    videoTile: {
        width: 128,
        height: 128,
        borderRadius: Radius.lg,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        alignSelf: 'center',
    },
    scanline: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        opacity: 0.85,
    },
    benefit: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 15,
        lineHeight: 21,
        textAlign: 'center',
        marginTop: 18,
    },
    // Beat 1
    scrim: {
        ...StyleSheet.absoluteFillObject,
        opacity: 0.5,
    },
    sheet: {
        position: 'absolute',
        left: 14,
        right: 14,
        bottom: 14,
        borderRadius: Radius.lg,
        paddingTop: 10,
        paddingBottom: 16,
        paddingHorizontal: 16,
    },
    sheetGrip: {
        width: 34,
        height: 4,
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: 14,
    },
    tileRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 18,
    },
    tileCol: {
        alignItems: 'center',
        gap: 5,
    },
    appTile: {
        width: 46,
        height: 46,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    tileLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10.5,
    },
    tileLabelGap: {
        height: 13,
    },
    coachRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        marginTop: 16,
    },
    coachItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    coachLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
        letterSpacing: 0.2,
    },
    // Beat 2
    napkinFavTile: {
        width: 92,
        height: 92,
        borderRadius: Radius.lg,
        alignItems: 'center',
        justifyContent: 'center',
    },
    starBadge: {
        position: 'absolute',
        top: -8,
        right: -8,
        width: 26,
        height: 26,
        borderRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
    },
    // Dots
    dots: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        marginTop: 18,
    },
    dot: {
        height: 6,
        borderRadius: 3,
    },
});

export default TeachShareSheetDemo;
