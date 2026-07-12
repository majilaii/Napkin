/**
 * TeachShareSheetDemo — a code-native, Rodeo-style onboarding film.
 *
 * Nothing here invokes Instagram or the system share sheet. It deliberately
 * recreates the useful parts in native views so the sequence is deterministic,
 * offline-friendly, accessible, theme-aware, and easy to update when Napkin's
 * import flow changes.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Image,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
    Easing,
    SharedValue,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withDelay,
    withRepeat,
    withTiming,
} from 'react-native-reanimated';

import { Colors, Shadow } from '@/constants/theme';
import {
    BEAT_COUNT,
    BEAT_TIMINGS_MS,
    LAST_BEAT,
    TEACH_COPY,
    advanceBeat,
} from './teachDemoUtils';

type Palette = typeof Colors.light;

export interface TeachShareSheetDemoProps {
    palette: Palette;
    topInset?: number;
    bottomInset?: number;
    onDone?: () => void;
    onClose?: () => void;
    doneLabel?: string;
    isPending?: boolean;
}

const RESULT_ROWS = [
    { name: 'Mountain', area: 'Soho', tint: '#c96f4d' },
    { name: 'Kiln', area: 'Soho', tint: '#7d8a62' },
    { name: 'Berenjak', area: 'Borough', tint: '#d1a155' },
] as const;

const SHARE_APPS = [
    { label: 'AirDrop', icon: 'wifi' as const, color: '#1684f8' },
    { label: 'Messages', icon: 'chatbubble' as const, color: '#35c759' },
    { label: 'Mail', icon: 'mail' as const, color: '#1487f8' },
    { label: 'Notes', icon: 'document-text' as const, color: '#f5c542' },
] as const;

function useSceneStyle(index: number, beatValue: SharedValue<number>) {
    return useAnimatedStyle(() => {
        const distance = Math.min(Math.abs(beatValue.value - index), 1);
        const direction = beatValue.value > index ? -1 : 1;
        return {
            opacity: 1 - distance,
            transform: [{ translateY: distance * direction * 12 }],
        };
    });
}

function useRevealStyle(value: SharedValue<number>) {
    return useAnimatedStyle(() => ({
        opacity: value.value,
        transform: [{ translateY: (1 - value.value) * 12 }],
    }));
}

export function TeachShareSheetDemo({
    palette,
    topInset = 0,
    bottomInset = 0,
    onDone,
    onClose,
    doneLabel = TEACH_COPY.doneCta,
    isPending = false,
}: TeachShareSheetDemoProps) {
    const reduced = useReducedMotion();
    const [beat, setBeat] = useState(reduced ? LAST_BEAT : 0);
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

    const beatValue = useSharedValue(reduced ? LAST_BEAT : 0);
    const reelFloat = useSharedValue(0);
    const tapPulse = useSharedValue(0);
    const sheetY = useSharedValue(reduced ? 0 : 52);
    const resultOne = useSharedValue(reduced ? 1 : 0);
    const resultTwo = useSharedValue(reduced ? 1 : 0);
    const resultThree = useSharedValue(reduced ? 1 : 0);

    const scene0 = useSceneStyle(0, beatValue);
    const scene1 = useSceneStyle(1, beatValue);
    const scene2 = useSceneStyle(2, beatValue);
    const scene3 = useSceneStyle(3, beatValue);

    useEffect(() => {
        beatValue.value = withTiming(beat, {
            duration: reduced ? 0 : 320,
            easing: Easing.out(Easing.cubic),
        });
    }, [beat, beatValue, reduced]);

    useEffect(() => {
        if (reduced) return;

        reelFloat.value = withRepeat(
            withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.quad) }),
            -1,
            true,
        );
        tapPulse.value = withRepeat(
            withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }),
            -1,
            false,
        );

        timers.current = [
            setTimeout(() => setBeat((value) => Math.max(value, 1)), BEAT_TIMINGS_MS.promiseToShare),
            setTimeout(() => setBeat((value) => Math.max(value, 2)), BEAT_TIMINGS_MS.shareToSheet),
            setTimeout(() => setBeat((value) => Math.max(value, 3)), BEAT_TIMINGS_MS.sheetToResult),
        ];

        return () => {
            timers.current.forEach(clearTimeout);
            timers.current = [];
        };
    }, [reduced, reelFloat, tapPulse]);

    useEffect(() => {
        if (reduced) return;
        if (beat >= 2) {
            sheetY.value = withTiming(0, { duration: 360, easing: Easing.out(Easing.cubic) });
        }
        if (beat >= LAST_BEAT) {
            resultOne.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) });
            resultTwo.value = withDelay(110, withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) }));
            resultThree.value = withDelay(220, withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) }));
        }
    }, [beat, reduced, resultOne, resultThree, resultTwo, sheetY]);

    const reelFloatStyle = useAnimatedStyle(() => ({
        transform: [
            { translateY: reelFloat.value * -5 },
            { rotate: `${-1.2 + reelFloat.value * 1.2}deg` },
        ],
    }));
    const pulseStyle = useAnimatedStyle(() => ({
        opacity: 0.72 * (1 - tapPulse.value),
        transform: [{ scale: 0.78 + tapPulse.value * 0.72 }],
    }));
    const sheetStyle = useAnimatedStyle(() => ({
        opacity: 1 - sheetY.value / 80,
        transform: [{ translateY: sheetY.value }],
    }));
    const resultStyles = [
        useRevealStyle(resultOne),
        useRevealStyle(resultTwo),
        useRevealStyle(resultThree),
    ];
    const terminalFooter = useAnimatedStyle(() => ({
        opacity: Math.max(0, beatValue.value - 2),
        transform: [{ translateY: Math.max(0, 3 - beatValue.value) * 8 }],
    }));
    const continueFooter = useAnimatedStyle(() => ({
        opacity: Math.min(1, Math.max(0, 3 - beatValue.value)),
    }));

    const onStagePress = () => {
        if (!reduced) setBeat((value) => advanceBeat(value));
    };

    return (
        <View
            style={[
                styles.root,
                {
                    paddingTop: topInset + 12,
                    paddingBottom: Math.max(bottomInset, 12),
                },
            ]}
        >
            <View style={[styles.topRail, onClose ? styles.topRailWithClose : null]}>
                <View style={styles.progressRow} accessibilityLabel={`Step ${beat + 1} of ${BEAT_COUNT}`}>
                    {Array.from({ length: BEAT_COUNT }).map((_, index) => (
                        <View
                            key={index}
                            style={[
                                styles.progressTrack,
                                {
                                    backgroundColor:
                                        index <= beat ? palette.primary : palette.outlineVariant,
                                    opacity: index <= beat ? 1 : 0.42,
                                },
                            ]}
                        />
                    ))}
                </View>
                {onClose ? (
                    <Pressable
                        onPress={onClose}
                        accessibilityRole="button"
                        accessibilityLabel="Close import tutorial"
                        style={({ pressed }) => [
                            styles.closeButton,
                            { backgroundColor: palette.surfaceJournalLow },
                            pressed ? { transform: [{ scale: 0.96 }] } : null,
                        ]}
                    >
                        <Ionicons name="close" size={19} color={palette.textMuted} />
                    </Pressable>
                ) : null}
            </View>

            <Pressable
                onPress={onStagePress}
                disabled={beat === LAST_BEAT || reduced}
                style={styles.stage}
                accessibilityRole="button"
                accessibilityLabel={beat === LAST_BEAT ? 'Import tutorial complete' : 'Continue tutorial'}
            >
                <Animated.View style={[styles.scene, scene0]} pointerEvents="none">
                    <CopyBlock
                        eyebrow={TEACH_COPY.promiseEyebrow}
                        title={TEACH_COPY.promiseTitle}
                        body={TEACH_COPY.promiseBody}
                        palette={palette}
                    />
                    <Animated.View style={[styles.reelWrap, reelFloatStyle]}>
                        <View style={[styles.backCard, styles.backCardLeft, { backgroundColor: palette.secondaryContainer }]} />
                        <View style={[styles.backCard, styles.backCardRight, { backgroundColor: palette.surfaceJournalHi }]} />
                        <ReelPhone compact palette={palette} />
                    </Animated.View>
                </Animated.View>

                <Animated.View style={[styles.scene, scene1]} pointerEvents="none">
                    <CopyBlock
                        title={TEACH_COPY.shareTitle}
                        body={TEACH_COPY.shareBody}
                        palette={palette}
                    />
                    <View style={styles.reelWrap}>
                        <ReelPhone palette={palette} highlightShare pulseStyle={pulseStyle} />
                    </View>
                </Animated.View>

                <Animated.View style={[styles.scene, scene2]} pointerEvents="none">
                    <CopyBlock
                        title={TEACH_COPY.sheetTitle}
                        body={TEACH_COPY.sheetBody}
                        palette={palette}
                    />
                    <View style={styles.shareDemo}>
                        <View style={styles.shareReelBackdrop}>
                            <ReelPhone palette={palette} compact />
                            <View style={styles.shareScrim} />
                        </View>
                        <Animated.View
                            style={[
                                styles.shareSheet,
                                { backgroundColor: palette.surfaceNote },
                                sheetStyle,
                            ]}
                        >
                            <View style={[styles.sheetGrip, { backgroundColor: palette.outlineVariant }]} />
                            <View style={styles.shareMeta}>
                                <View style={[styles.shareThumb, { backgroundColor: palette.surfaceJournalHi }]}>
                                    <Ionicons name="restaurant" size={15} color={palette.primary} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={[styles.shareMetaTitle, { color: palette.text }]}>3 London restaurants</Text>
                                    <Text style={[styles.shareMetaUrl, { color: palette.textMuted }]}>instagram.com</Text>
                                </View>
                            </View>
                            <View style={styles.appRow}>
                                {SHARE_APPS.map((app) => (
                                    <ShareApp key={app.label} {...app} palette={palette} />
                                ))}
                                <View style={styles.shareAppCol}>
                                    <View style={styles.napkinTarget}>
                                        <Animated.View
                                            style={[
                                                styles.napkinPulse,
                                                { borderColor: palette.primary },
                                                pulseStyle,
                                            ]}
                                        />
                                        <Image
                                            source={require('../../assets/images/icon.png')}
                                            style={styles.napkinIcon}
                                        />
                                    </View>
                                    <Text style={[styles.appLabel, { color: palette.text }]}>Napkin</Text>
                                </View>
                            </View>
                            <View style={[styles.coachPill, { backgroundColor: palette.text }]}>
                                <Text style={[styles.coachText, { color: palette.background }]}>Tap Napkin</Text>
                                <Ionicons name="arrow-forward" size={13} color={palette.background} />
                            </View>
                        </Animated.View>
                    </View>
                </Animated.View>

                <Animated.View style={[styles.scene, scene3]} pointerEvents="none">
                    <CopyBlock
                        eyebrow={TEACH_COPY.resultEyebrow}
                        title={TEACH_COPY.resultTitle}
                        body={TEACH_COPY.resultBody}
                        palette={palette}
                    />
                    <View
                        style={[
                            styles.resultCard,
                            { backgroundColor: palette.surfaceNote },
                        ]}
                    >
                        <View style={styles.resultHeader}>
                            <View style={[styles.resultCheck, { backgroundColor: palette.secondaryContainer }]}>
                                <Ionicons name="checkmark" size={17} color={palette.secondary} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={[styles.resultHeaderTitle, { color: palette.text }]}>Saved to your wishlist</Text>
                                <Text style={[styles.resultHeaderMeta, { color: palette.textMuted }]}>From one shared video</Text>
                            </View>
                        </View>
                        <View style={[styles.resultRule, { backgroundColor: palette.dividerSoft }]} />
                        {RESULT_ROWS.map((row, index) => (
                            <Animated.View key={row.name} style={[styles.resultRow, resultStyles[index]]}>
                                <View style={[styles.resultThumb, { backgroundColor: row.tint }]}>
                                    <Ionicons name="restaurant" size={15} color="#fffdf8" />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={[styles.resultName, { color: palette.text }]}>{row.name}</Text>
                                    <Text style={[styles.resultArea, { color: palette.textMuted }]}>{row.area}</Text>
                                </View>
                                <View style={[styles.savedBadge, { backgroundColor: palette.primaryMuted }]}>
                                    <Ionicons name="bookmark" size={13} color={palette.primary} />
                                    <Text style={[styles.savedText, { color: palette.primary }]}>Saved</Text>
                                </View>
                            </Animated.View>
                        ))}
                    </View>
                </Animated.View>
            </Pressable>

            <View style={styles.footer}>
                <Animated.View style={[styles.footerLayer, continueFooter]} pointerEvents="none">
                    <Text style={[styles.continueHint, { color: palette.textMuted }]}>{TEACH_COPY.continueHint}</Text>
                </Animated.View>
                <Animated.View
                    style={[styles.footerLayer, terminalFooter]}
                    pointerEvents={beat === LAST_BEAT ? 'auto' : 'none'}
                >
                    <Pressable
                        onPress={onDone}
                        disabled={isPending}
                        accessibilityRole="button"
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
                                <Text style={styles.doneText}>{doneLabel}</Text>
                                <Ionicons name="arrow-forward" size={18} color={palette.textInverse} />
                            </>
                        )}
                    </Pressable>
                </Animated.View>
            </View>
        </View>
    );
}

function CopyBlock({
    eyebrow,
    title,
    body,
    palette,
}: {
    eyebrow?: string;
    title: string;
    body: string;
    palette: Palette;
}) {
    return (
        <View style={styles.copyBlock}>
            {eyebrow ? <Text style={[styles.eyebrow, { color: palette.primary }]}>{eyebrow}</Text> : null}
            <Text style={[styles.title, { color: palette.text }]}>{title}</Text>
            <Text style={[styles.body, { color: palette.textSecondary }]}>{body}</Text>
        </View>
    );
}

function ReelPhone({
    palette,
    compact = false,
    highlightShare = false,
    pulseStyle,
}: {
    palette: Palette;
    compact?: boolean;
    highlightShare?: boolean;
    pulseStyle?: object;
}) {
    return (
        <View style={[styles.reelPhone, compact && styles.reelPhoneCompact]}>
            <LinearGradient
                colors={['#33231f', '#86513d', '#221c1a']}
                locations={[0, 0.54, 1]}
                style={StyleSheet.absoluteFill}
            />
            <View style={styles.reelGlowOne} />
            <View style={styles.reelGlowTwo} />
            <View style={styles.plate}>
                <View style={styles.plateInner}>
                    <View style={[styles.foodDot, { top: 22, left: 29, backgroundColor: '#e7a342' }]} />
                    <View style={[styles.foodDot, { top: 37, left: 51, backgroundColor: '#7c9b55' }]} />
                    <View style={[styles.foodDot, { top: 48, left: 27, backgroundColor: '#c75c47' }]} />
                    <View style={[styles.foodDot, { top: 24, left: 52, backgroundColor: '#f3d39a' }]} />
                </View>
            </View>
            <View style={styles.reelTopBar}>
                <Text style={styles.reelTopTitle}>Reels</Text>
                <Ionicons name="camera-outline" size={18} color="#fff" />
            </View>
            <View style={styles.reelCaptionCard}>
                <Text style={styles.reelHook}>3 London spots worth saving</Text>
                <Text style={styles.reelHandle}>@smallplates.london</Text>
            </View>
            <View style={styles.reelActions}>
                <ReelAction icon="heart" label="12.4K" />
                <ReelAction icon="chatbubble" label="184" />
                <View style={styles.shareActionWrap}>
                    {highlightShare && pulseStyle ? (
                        <Animated.View style={[styles.shareActionPulse, pulseStyle]} />
                    ) : null}
                    <View style={[styles.shareAction, highlightShare && { backgroundColor: palette.primary }]}>
                        <Ionicons name="paper-plane" size={compact ? 16 : 20} color="#fff" />
                    </View>
                    {highlightShare ? <Text style={styles.tapLabel}>TAP</Text> : null}
                </View>
            </View>
            <View style={styles.reelNav}>
                <Ionicons name="home" size={compact ? 13 : 16} color="#fff" />
                <Ionicons name="search" size={compact ? 13 : 16} color="#fff" />
                <Ionicons name="add-circle-outline" size={compact ? 13 : 16} color="#fff" />
                <Ionicons name="play-circle" size={compact ? 13 : 16} color="#fff" />
                <View style={styles.avatarDot} />
            </View>
        </View>
    );
}

function ReelAction({ icon, label }: { icon: 'heart' | 'chatbubble'; label: string }) {
    return (
        <View style={styles.reelActionItem}>
            <Ionicons name={icon} size={18} color="#fff" />
            <Text style={styles.reelActionLabel}>{label}</Text>
        </View>
    );
}

function ShareApp({
    label,
    icon,
    color,
    palette,
}: {
    label: string;
    icon: 'wifi' | 'chatbubble' | 'mail' | 'document-text';
    color: string;
    palette: Palette;
}) {
    return (
        <View style={styles.shareAppCol}>
            <View style={[styles.shareAppIcon, { backgroundColor: color }]}>
                <Ionicons name={icon} size={20} color="#fff" />
            </View>
            <Text style={[styles.appLabel, { color: palette.text }]}>{label}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        paddingHorizontal: 20,
    },
    progressRow: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    topRail: {
        height: 14,
        flexDirection: 'row',
        alignItems: 'center',
    },
    topRailWithClose: {
        height: 40,
        gap: 12,
    },
    closeButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    progressTrack: {
        flex: 1,
        height: 3,
        borderRadius: 2,
    },
    stage: {
        flex: 1,
        minHeight: 0,
    },
    scene: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        paddingTop: 16,
    },
    copyBlock: {
        alignItems: 'center',
        maxWidth: 340,
        paddingHorizontal: 8,
        zIndex: 4,
    },
    eyebrow: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10.5,
        lineHeight: 14,
        letterSpacing: 1.65,
        marginBottom: 9,
    },
    title: {
        fontFamily: 'Newsreader_700Bold',
        fontSize: 31,
        lineHeight: 34,
        letterSpacing: -0.7,
        textAlign: 'center',
    },
    body: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13.5,
        lineHeight: 19,
        textAlign: 'center',
        marginTop: 9,
        maxWidth: 300,
    },
    reelWrap: {
        flex: 1,
        minHeight: 0,
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 12,
        paddingBottom: 4,
    },
    backCard: {
        position: 'absolute',
        width: 190,
        height: 288,
        borderRadius: 27,
        opacity: 0.9,
    },
    backCardLeft: {
        transform: [{ rotate: '-8deg' }, { translateX: -20 }],
    },
    backCardRight: {
        transform: [{ rotate: '7deg' }, { translateX: 22 }],
    },
    reelPhone: {
        width: 226,
        height: 356,
        maxHeight: '100%',
        borderRadius: 29,
        overflow: 'hidden',
        backgroundColor: '#231d1b',
        outlineColor: 'rgba(0, 0, 0, 0.1)',
        outlineWidth: 1,
        ...Shadow.ambient,
    },
    reelPhoneCompact: {
        width: 196,
        height: 306,
        borderRadius: 25,
    },
    reelGlowOne: {
        position: 'absolute',
        width: 170,
        height: 170,
        borderRadius: 85,
        top: 72,
        left: -44,
        backgroundColor: 'rgba(231, 163, 66, 0.28)',
    },
    reelGlowTwo: {
        position: 'absolute',
        width: 130,
        height: 180,
        borderRadius: 65,
        right: -34,
        bottom: 36,
        backgroundColor: 'rgba(124, 155, 85, 0.25)',
    },
    plate: {
        position: 'absolute',
        width: 124,
        height: 124,
        borderRadius: 62,
        left: 36,
        top: 100,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f5ead8',
        transform: [{ rotate: '-9deg' }],
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.22,
        shadowRadius: 18,
    },
    plateInner: {
        width: 86,
        height: 86,
        borderRadius: 43,
        backgroundColor: '#e9d6b9',
    },
    foodDot: {
        position: 'absolute',
        width: 19,
        height: 19,
        borderRadius: 10,
    },
    reelTopBar: {
        position: 'absolute',
        top: 17,
        left: 16,
        right: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    reelTopTitle: {
        color: '#fff',
        fontFamily: 'Manrope_700Bold',
        fontSize: 15,
    },
    reelCaptionCard: {
        position: 'absolute',
        left: 14,
        right: 48,
        bottom: 44,
    },
    reelHook: {
        color: '#fff',
        fontFamily: 'Manrope_700Bold',
        fontSize: 13.5,
        lineHeight: 17,
        textShadowColor: 'rgba(0,0,0,0.45)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 5,
    },
    reelHandle: {
        color: 'rgba(255,255,255,0.84)',
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9.5,
        marginTop: 5,
    },
    reelActions: {
        position: 'absolute',
        right: 9,
        bottom: 51,
        alignItems: 'center',
        gap: 12,
    },
    reelActionItem: {
        alignItems: 'center',
        gap: 2,
    },
    reelActionLabel: {
        color: '#fff',
        fontFamily: 'Manrope_700Bold',
        fontSize: 7.5,
        fontVariant: ['tabular-nums'],
    },
    shareActionWrap: {
        width: 42,
        height: 53,
        alignItems: 'center',
        justifyContent: 'flex-start',
    },
    shareAction: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
    },
    shareActionPulse: {
        position: 'absolute',
        top: -4,
        width: 42,
        height: 42,
        borderRadius: 21,
        backgroundColor: 'rgba(255,255,255,0.42)',
    },
    tapLabel: {
        color: '#fff',
        fontFamily: 'Manrope_700Bold',
        fontSize: 8,
        letterSpacing: 1.2,
        marginTop: 3,
    },
    reelNav: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: 36,
        paddingHorizontal: 18,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: 'rgba(10,8,8,0.72)',
    },
    avatarDot: {
        width: 15,
        height: 15,
        borderRadius: 5,
        backgroundColor: '#c96f4d',
        borderWidth: 1,
        borderColor: '#fff',
    },
    shareDemo: {
        flex: 1,
        minHeight: 0,
        width: '100%',
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingTop: 12,
    },
    shareReelBackdrop: {
        position: 'absolute',
        top: 12,
        alignItems: 'center',
        opacity: 0.68,
    },
    shareScrim: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(22, 18, 16, 0.48)',
        borderRadius: 25,
    },
    shareSheet: {
        width: '100%',
        maxWidth: 390,
        borderRadius: 30,
        paddingTop: 10,
        paddingHorizontal: 16,
        paddingBottom: 19,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.16,
        shadowRadius: 30,
        elevation: 6,
    },
    sheetGrip: {
        width: 38,
        height: 4,
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: 12,
    },
    shareMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 2,
        marginBottom: 15,
    },
    shareThumb: {
        width: 42,
        height: 42,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    shareMetaTitle: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
    },
    shareMetaUrl: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 10,
        marginTop: 2,
    },
    appRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    shareAppCol: {
        width: 54,
        alignItems: 'center',
        gap: 5,
    },
    shareAppIcon: {
        width: 44,
        height: 44,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        outlineColor: 'rgba(0, 0, 0, 0.1)',
        outlineWidth: 1,
    },
    napkinTarget: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    napkinPulse: {
        position: 'absolute',
        width: 54,
        height: 54,
        borderRadius: 16,
        borderWidth: 2,
    },
    napkinIcon: {
        width: 44,
        height: 44,
        borderRadius: 12,
        outlineColor: 'rgba(0, 0, 0, 0.1)',
        outlineWidth: 1,
    },
    appLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 8.5,
    },
    coachPill: {
        height: 30,
        borderRadius: 15,
        paddingLeft: 13,
        paddingRight: 11,
        marginTop: 14,
        alignSelf: 'flex-end',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    coachText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10.5,
    },
    resultCard: {
        width: '100%',
        maxWidth: 360,
        borderRadius: 26,
        marginTop: 27,
        padding: 14,
        outlineColor: 'rgba(0, 0, 0, 0.06)',
        outlineWidth: 1,
        ...Shadow.ambient,
    },
    resultHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        padding: 4,
    },
    resultCheck: {
        width: 38,
        height: 38,
        borderRadius: 19,
        alignItems: 'center',
        justifyContent: 'center',
    },
    resultHeaderTitle: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
    },
    resultHeaderMeta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 10.5,
        marginTop: 2,
    },
    resultRule: {
        height: StyleSheet.hairlineWidth,
        marginVertical: 10,
        marginHorizontal: 4,
    },
    resultRow: {
        minHeight: 57,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        paddingHorizontal: 4,
    },
    resultThumb: {
        width: 42,
        height: 42,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        outlineColor: 'rgba(0, 0, 0, 0.1)',
        outlineWidth: 1,
    },
    resultName: {
        fontFamily: 'Newsreader_600SemiBold',
        fontSize: 16,
        lineHeight: 18,
    },
    resultArea: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 9.5,
        marginTop: 2,
    },
    savedBadge: {
        height: 27,
        borderRadius: 14,
        paddingHorizontal: 9,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    savedText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
    },
    footer: {
        height: 66,
        position: 'relative',
        justifyContent: 'center',
    },
    footerLayer: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
    },
    continueHint: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11,
        letterSpacing: 0.2,
        textAlign: 'center',
    },
    doneButton: {
        height: 52,
        borderRadius: 26,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    doneText: {
        color: '#fff',
        fontFamily: 'Manrope_700Bold',
        fontSize: 14.5,
        letterSpacing: 0.15,
    },
});

export default TeachShareSheetDemo;
