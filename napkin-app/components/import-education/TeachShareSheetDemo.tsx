/**
 * A native interaction simulator for the real share workflow.
 *
 * The photographic Reel, platform share drawer and iOS share sheet are replicas:
 * they never open another app, but their required controls are real Pressables.
 * This gives onboarding the muscle-memory benefit of a live walkthrough while
 * keeping it deterministic, offline and replayable from Settings.
 */
import React, { useEffect, useState } from 'react';
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
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import Animated, {
    cancelAnimation,
    Easing,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withRepeat,
    withTiming,
} from 'react-native-reanimated';

import { Colors, Shadow } from '@/constants/theme';
import {
    BEAT_COUNT,
    LAST_BEAT,
    TEACH_COPY,
    type TeachTarget,
    advanceOnTarget,
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

const REEL_IMAGE = require('../../assets/onboarding/reel-kitchen.png');
const NAPKIN_ICON = require('../../assets/images/icon.png');

const RECIPIENTS = [
    { name: 'Your story', initials: '+', colors: ['#ffbd47', '#d62976'] as const },
    { name: 'Sam', initials: 'S', colors: ['#6b8cff', '#4158d0'] as const },
    { name: 'Maya', initials: 'M', colors: ['#f7a8b8', '#df5d7d'] as const },
    { name: 'Alex', initials: 'A', colors: ['#79d7c8', '#3d968b'] as const },
] as const;

const SAVED_PLACES = [
    { name: 'Mountain', detail: 'Soho · Spanish', score: '4.8' },
    { name: 'Kiln', detail: 'Soho · Thai', score: '4.7' },
    { name: 'Berenjak', detail: 'Borough · Persian', score: '4.6' },
] as const;

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
    const [beat, setBeat] = useState(0);
    const pulse = useSharedValue(0);
    const drawerProgress = useSharedValue(0);
    const systemProgress = useSharedValue(0);

    useEffect(() => {
        if (reduced || beat === LAST_BEAT) {
            cancelAnimation(pulse);
            pulse.value = 0;
            return;
        }
        pulse.value = withRepeat(
            withTiming(1, { duration: 1050, easing: Easing.out(Easing.cubic) }),
            -1,
            false,
        );
        return () => cancelAnimation(pulse);
    }, [beat, pulse, reduced]);

    useEffect(() => {
        const duration = reduced ? 0 : 330;
        drawerProgress.value = withTiming(beat >= 2 && beat < LAST_BEAT ? 1 : 0, {
            duration,
            easing: Easing.out(Easing.cubic),
        });
        systemProgress.value = withTiming(beat >= 3 && beat < LAST_BEAT ? 1 : 0, {
            duration,
            easing: Easing.out(Easing.cubic),
        });
    }, [beat, drawerProgress, reduced, systemProgress]);

    const pulseStyle = useAnimatedStyle(() => ({
        opacity: 0.75 * (1 - pulse.value),
        transform: [{ scale: 0.8 + pulse.value * 0.65 }],
    }));
    const drawerStyle = useAnimatedStyle(() => ({
        opacity: drawerProgress.value,
        transform: [{ translateY: (1 - drawerProgress.value) * 44 }],
    }));
    const systemStyle = useAnimatedStyle(() => ({
        opacity: systemProgress.value,
        transform: [{ translateY: (1 - systemProgress.value) * 56 }],
    }));

    const completeTarget = (target: TeachTarget) => {
        setBeat((current) => {
            const next = advanceOnTarget(current, target);
            if (next !== current) {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
            }
            return next;
        });
    };

    if (beat === LAST_BEAT) {
        return (
            <View style={styles.root}>
                <StatusBar style="auto" />
                <ResultScreen
                    palette={palette}
                    topInset={topInset}
                    bottomInset={bottomInset}
                    doneLabel={doneLabel}
                    isPending={isPending}
                    onDone={onDone}
                />
            </View>
        );
    }

    return (
        <View style={styles.root}>
            <StatusBar style={beat === LAST_BEAT ? 'auto' : 'light'} />

            <ReelScreen
                topInset={topInset}
                bottomInset={bottomInset}
                shareEnabled={beat === 1}
                pulseStyle={pulseStyle}
                onShare={() => completeTarget('share')}
            />

            {beat === 0 ? (
                <IntroOverlay
                    topInset={topInset}
                    bottomInset={bottomInset}
                    onStart={() => completeTarget('start')}
                />
            ) : null}

            <Animated.View
                pointerEvents={beat === 2 ? 'auto' : 'none'}
                style={[styles.overlay, drawerStyle]}
            >
                <PlatformShareDrawer
                    bottomInset={bottomInset}
                    pulseStyle={pulseStyle}
                    onShareTo={() => completeTarget('shareTo')}
                />
            </Animated.View>

            <Animated.View
                pointerEvents={beat === 3 ? 'auto' : 'none'}
                style={[styles.overlay, systemStyle]}
            >
                <SystemShareSheet
                    bottomInset={bottomInset}
                    pulseStyle={pulseStyle}
                    onNapkin={() => completeTarget('napkin')}
                />
            </Animated.View>

            {beat > 0 && beat < LAST_BEAT ? (
                <View
                    style={[styles.progressRail, { top: topInset + 8 }]}
                    accessibilityLabel={`Step ${beat + 1} of ${BEAT_COUNT}`}
                >
                    {Array.from({ length: BEAT_COUNT - 1 }).map((_, index) => (
                        <View
                            key={index}
                            style={[
                                styles.progressSegment,
                                { opacity: index < beat ? 0.95 : 0.28 },
                            ]}
                        />
                    ))}
                </View>
            ) : null}

            {onClose ? (
                <Pressable
                    onPress={onClose}
                    accessibilityRole="button"
                    accessibilityLabel="Close import tutorial"
                    style={({ pressed }) => [
                        styles.closeButton,
                        { top: topInset + 20, transform: [{ scale: pressed ? 0.96 : 1 }] },
                    ]}
                >
                    <Ionicons
                        name="close"
                        size={20}
                        color={beat === LAST_BEAT ? palette.text : '#fff'}
                    />
                </Pressable>
            ) : null}
        </View>
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
            <Image source={REEL_IMAGE} resizeMode="cover" blurRadius={24} style={StyleSheet.absoluteFill} />
            <View style={styles.introScrim} />
            <View
                style={[
                    styles.introContent,
                    { paddingTop: topInset + 28, paddingBottom: bottomInset + 24 },
                ]}
            >
                <View style={styles.introBadge}>
                    <Ionicons name="paper-plane" size={17} color="#fff" />
                </View>
                <Text style={styles.introTitle}>{TEACH_COPY.introTitle}</Text>
                <Text style={styles.introBody}>{TEACH_COPY.introBody}</Text>
                <Pressable
                    onPress={onStart}
                    accessibilityRole="button"
                    accessibilityLabel={TEACH_COPY.startCta}
                    style={({ pressed }) => [
                        styles.introButton,
                        pressed ? { transform: [{ scale: 0.96 }] } : null,
                    ]}
                >
                    <Text style={styles.introButtonText}>{TEACH_COPY.startCta}</Text>
                    <Ionicons name="arrow-forward" size={18} color="#111" />
                </Pressable>
            </View>
        </View>
    );
}

function ReelScreen({
    topInset,
    bottomInset,
    shareEnabled,
    pulseStyle,
    onShare,
}: {
    topInset: number;
    bottomInset: number;
    shareEnabled: boolean;
    pulseStyle: object;
    onShare: () => void;
}) {
    return (
        <View style={styles.reelScreen}>
            <Image source={REEL_IMAGE} resizeMode="cover" style={StyleSheet.absoluteFill} />
            <LinearGradient
                colors={['rgba(0,0,0,0.56)', 'transparent', 'rgba(0,0,0,0.82)']}
                locations={[0, 0.38, 1]}
                style={StyleSheet.absoluteFill}
            />

            <View style={[styles.reelHeader, { top: topInset + 30 }]}>
                <Ionicons name="chevron-down" size={23} color="#fff" />
                <View style={styles.reelTabs}>
                    <Text style={styles.reelTabMuted}>Following</Text>
                    <View>
                        <Text style={styles.reelTabActive}>Reels</Text>
                        <View style={styles.reelTabUnderline} />
                    </View>
                </View>
                <Ionicons name="camera-outline" size={25} color="#fff" />
            </View>

            <View style={[styles.reelActions, { bottom: bottomInset + 104 }]}>
                <ReelAction icon="heart-outline" label="24.8K" />
                <ReelAction icon="chatbubble-outline" label="326" />
                <Pressable
                    onPress={onShare}
                    disabled={!shareEnabled}
                    accessibilityRole="button"
                    accessibilityLabel="Share video"
                    style={({ pressed }) => [
                        styles.reelActionButton,
                        pressed && shareEnabled ? { transform: [{ scale: 0.96 }] } : null,
                    ]}
                >
                    {shareEnabled ? <Animated.View style={[styles.reelPulse, pulseStyle]} /> : null}
                    <Ionicons name="paper-plane-outline" size={29} color="#fff" />
                    <Text style={styles.reelActionCount}>Share</Text>
                </Pressable>
                <ReelAction icon="bookmark-outline" label="8,214" />
                <View style={styles.reelMore}>
                    <Ionicons name="ellipsis-horizontal" size={23} color="#fff" />
                </View>
            </View>

            <View style={[styles.reelCaption, { bottom: bottomInset + 68 }]}>
                <View style={styles.handleRow}>
                    <Image source={REEL_IMAGE} style={styles.handleAvatar} />
                    <Text style={styles.handle}>platesoflondon</Text>
                    <Text style={styles.followButton}>Follow</Text>
                </View>
                <Text style={styles.captionText} numberOfLines={2}>
                    The small plates worth crossing London for. Save these for your next dinner.
                </Text>
                <View style={styles.audioRow}>
                    <Ionicons name="musical-notes" size={12} color="#fff" />
                    <Text style={styles.audioText}>Original audio · platesoflondon</Text>
                </View>
            </View>

            <View style={[styles.reelBottomNav, { height: bottomInset + 58 }]}>
                <Ionicons name="home" size={24} color="#fff" />
                <Ionicons name="search" size={24} color="#fff" />
                <View style={styles.createIcon}>
                    <Ionicons name="add" size={19} color="#111" />
                </View>
                <Ionicons name="play-circle" size={25} color="#fff" />
                <Image source={REEL_IMAGE} style={styles.navAvatar} />
            </View>

            {shareEnabled ? (
                <CoachMark text={TEACH_COPY.shareHint} style={styles.shareCoach} arrow="forward" />
            ) : null}
        </View>
    );
}

function ReelAction({
    icon,
    label,
}: {
    icon: 'heart-outline' | 'chatbubble-outline' | 'bookmark-outline';
    label: string;
}) {
    return (
        <View style={styles.reelActionButton}>
            <Ionicons name={icon} size={29} color="#fff" />
            <Text style={styles.reelActionCount}>{label}</Text>
        </View>
    );
}

function PlatformShareDrawer({
    bottomInset,
    pulseStyle,
    onShareTo,
}: {
    bottomInset: number;
    pulseStyle: object;
    onShareTo: () => void;
}) {
    return (
        <View style={styles.platformLayer}>
            <View style={styles.platformScrim} />
            <View style={[styles.platformDrawer, { paddingBottom: bottomInset + 16 }]}>
                <View style={styles.drawerGrip} />
                <View style={styles.searchField}>
                    <Ionicons name="search" size={16} color="#a7a7ab" />
                    <Text style={styles.searchText}>Search</Text>
                </View>

                <View style={styles.recipientRow}>
                    {RECIPIENTS.map((person) => (
                        <View key={person.name} style={styles.recipient}>
                            <LinearGradient colors={person.colors} style={styles.recipientAvatar}>
                                <Text style={styles.recipientInitials}>{person.initials}</Text>
                            </LinearGradient>
                            <Text style={styles.recipientName}>{person.name}</Text>
                        </View>
                    ))}
                </View>

                <View style={styles.platformRule} />
                <View style={styles.platformActionRow}>
                    <PlatformAction icon="images-outline" label="Add to story" />
                    <PlatformAction icon="link-outline" label="Copy link" />
                    <PlatformAction icon="logo-whatsapp" label="WhatsApp" />
                    <Pressable
                        onPress={onShareTo}
                        accessibilityRole="button"
                        accessibilityLabel="Share to another app"
                        style={({ pressed }) => [
                            styles.platformAction,
                            pressed ? { transform: [{ scale: 0.97 }] } : null,
                        ]}
                    >
                        <View style={styles.platformActionIcon}>
                            <Animated.View style={[styles.platformPulse, pulseStyle]} />
                            <Ionicons name="share-outline" size={25} color="#fff" />
                        </View>
                        <Text style={styles.platformActionLabel}>Share to...</Text>
                    </Pressable>
                </View>
                <CoachMark text={TEACH_COPY.shareToHint} style={styles.shareToCoach} arrow="down" />
            </View>
        </View>
    );
}

function PlatformAction({
    icon,
    label,
}: {
    icon: 'images-outline' | 'link-outline' | 'logo-whatsapp';
    label: string;
}) {
    return (
        <View style={styles.platformAction}>
            <View style={styles.platformActionIcon}>
                <Ionicons name={icon} size={24} color="#fff" />
            </View>
            <Text style={styles.platformActionLabel}>{label}</Text>
        </View>
    );
}

function SystemShareSheet({
    bottomInset,
    pulseStyle,
    onNapkin,
}: {
    bottomInset: number;
    pulseStyle: object;
    onNapkin: () => void;
}) {
    return (
        <View style={styles.systemLayer}>
            <View style={styles.systemScrim} />
            <View style={[styles.systemSheet, { bottom: bottomInset + 72 }]}>
                <View style={styles.systemGrip} />
                <View style={styles.systemMeta}>
                    <Image source={REEL_IMAGE} style={styles.systemThumb} />
                    <View style={styles.systemMetaCopy}>
                        <Text style={styles.systemMetaTitle}>platesoflondon</Text>
                        <Text style={styles.systemMetaUrl}>instagram.com</Text>
                    </View>
                    <View style={styles.systemClose}>
                        <Ionicons name="close" size={16} color="#55565a" />
                    </View>
                </View>
                <View style={styles.systemRule} />

                <View style={styles.systemApps}>
                    <SystemApp label="AirDrop" color="#1677ff" icon="wifi" />
                    <SystemApp label="Messages" color="#31c958" icon="chatbubble-ellipses" />
                    <SystemApp label="Mail" color="#1b83f6" icon="mail" />
                    <SystemApp label="Notes" color="#fff" icon="document-text" darkIcon />
                    <View style={styles.systemApp}>
                        <Pressable
                            onPress={onNapkin}
                            accessibilityRole="button"
                            accessibilityLabel="Share to Napkin"
                            style={({ pressed }) => [
                                styles.napkinHitTarget,
                                pressed ? { transform: [{ scale: 0.96 }] } : null,
                            ]}
                        >
                            <Animated.View style={[styles.napkinPulse, pulseStyle]} />
                            <Image source={NAPKIN_ICON} style={styles.systemAppIcon} />
                        </Pressable>
                        <Text style={styles.systemAppLabel}>Napkin</Text>
                    </View>
                </View>

                <View style={styles.systemRule} />
                <View style={styles.systemActions}>
                    <SystemAction label="Copy" icon="copy-outline" />
                    <SystemAction label="Add to Reading List" icon="book-outline" />
                    <SystemAction label="Add Bookmark" icon="bookmark-outline" />
                </View>
                <CoachMark text={TEACH_COPY.napkinHint} style={styles.napkinCoach} arrow="down" />
            </View>
            <View style={[styles.cancelSheet, { bottom: bottomInset + 8 }]}>
                <Text style={styles.cancelText}>Cancel</Text>
            </View>
        </View>
    );
}

function SystemApp({
    label,
    color,
    icon,
    darkIcon = false,
}: {
    label: string;
    color: string;
    icon: 'wifi' | 'chatbubble-ellipses' | 'mail' | 'document-text';
    darkIcon?: boolean;
}) {
    return (
        <View style={styles.systemApp}>
            <View style={[styles.systemAppIcon, styles.systemAppIconCenter, { backgroundColor: color }]}>
                <Ionicons name={icon} size={27} color={darkIcon ? '#f0bd29' : '#fff'} />
            </View>
            <Text style={styles.systemAppLabel}>{label}</Text>
        </View>
    );
}

function SystemAction({
    label,
    icon,
}: {
    label: string;
    icon: 'copy-outline' | 'book-outline' | 'bookmark-outline';
}) {
    return (
        <View style={styles.systemAction}>
            <Ionicons name={icon} size={20} color="#18181a" />
            <Text style={styles.systemActionLabel}>{label}</Text>
            <Ionicons name="chevron-forward" size={17} color="#9a9a9e" />
        </View>
    );
}

function ResultScreen({
    palette,
    topInset,
    bottomInset,
    doneLabel,
    isPending,
    onDone,
}: {
    palette: Palette;
    topInset: number;
    bottomInset: number;
    doneLabel: string;
    isPending: boolean;
    onDone?: () => void;
}) {
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
                        <Image source={REEL_IMAGE} style={styles.savedThumb} />
                        <View style={styles.savedCopy}>
                            <Text style={[styles.savedName, { color: palette.text }]}>{place.name}</Text>
                            <Text style={[styles.savedDetail, { color: palette.textMuted }]}>{place.detail}</Text>
                            <View style={styles.ratingRow}>
                                <Ionicons name="star" size={11} color="#d99522" />
                                <Text style={[styles.rating, { color: palette.textSecondary }]}>{place.score}</Text>
                            </View>
                        </View>
                        <View style={[styles.savedBookmark, { backgroundColor: palette.primaryMuted }]}>
                            <Ionicons name="bookmark" size={17} color={palette.primary} />
                        </View>
                    </View>
                ))}
            </View>

            <View style={styles.resultSpacer} />
            <Pressable
                onPress={onDone}
                disabled={isPending}
                accessibilityRole="button"
                accessibilityLabel={doneLabel}
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
                        <Text style={[styles.doneText, { color: palette.textInverse }]}>{doneLabel}</Text>
                        <Ionicons name="arrow-forward" size={18} color={palette.textInverse} />
                    </>
                )}
            </Pressable>
        </View>
    );
}

function CoachMark({
    text,
    style,
    arrow,
}: {
    text: string;
    style: object;
    arrow: 'forward' | 'down';
}) {
    return (
        <View style={[styles.coachMark, style]} pointerEvents="none">
            <Text style={styles.coachText}>{text}</Text>
            <Ionicons name={arrow === 'forward' ? 'arrow-forward' : 'arrow-down'} size={16} color="#111" />
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: '#000',
        overflow: 'hidden',
    },
    overlay: {
        ...StyleSheet.absoluteFillObject,
    },
    reelScreen: {
        flex: 1,
        backgroundColor: '#17120f',
    },
    reelHeader: {
        position: 'absolute',
        left: 16,
        right: 16,
        height: 34,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    reelTabs: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 18,
    },
    reelTabMuted: {
        color: 'rgba(255,255,255,0.68)',
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 14,
    },
    reelTabActive: {
        color: '#fff',
        fontFamily: 'Manrope_700Bold',
        fontSize: 14,
    },
    reelTabUnderline: {
        height: 2,
        borderRadius: 1,
        backgroundColor: '#fff',
        marginTop: 5,
    },
    reelActions: {
        position: 'absolute',
        right: 8,
        alignItems: 'center',
        gap: 17,
        zIndex: 5,
    },
    reelActionButton: {
        width: 52,
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
    },
    reelActionCount: {
        color: '#fff',
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        fontVariant: ['tabular-nums'],
        textShadowColor: 'rgba(0,0,0,0.65)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 4,
    },
    reelPulse: {
        position: 'absolute',
        top: 2,
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(255,255,255,0.72)',
    },
    reelMore: {
        width: 40,
        height: 26,
        borderRadius: 14,
        backgroundColor: 'rgba(0,0,0,0.35)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    reelCaption: {
        position: 'absolute',
        left: 14,
        right: 67,
        zIndex: 3,
    },
    handleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        marginBottom: 8,
    },
    handleAvatar: {
        width: 30,
        height: 30,
        borderRadius: 15,
        borderWidth: 1.5,
        borderColor: '#fff',
    },
    handle: {
        color: '#fff',
        fontFamily: 'Manrope_700Bold',
        fontSize: 12.5,
    },
    followButton: {
        color: '#fff',
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.8)',
        borderRadius: 5,
        paddingHorizontal: 9,
        paddingVertical: 4,
        overflow: 'hidden',
    },
    captionText: {
        color: '#fff',
        fontFamily: 'Manrope_500Medium',
        fontSize: 11.5,
        lineHeight: 16,
        textShadowColor: 'rgba(0,0,0,0.75)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 5,
    },
    audioRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        marginTop: 7,
    },
    audioText: {
        color: '#fff',
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11,
    },
    reelBottomNav: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingTop: 13,
        paddingHorizontal: 25,
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        backgroundColor: 'rgba(0,0,0,0.82)',
    },
    createIcon: {
        width: 28,
        height: 21,
        borderRadius: 7,
        backgroundColor: '#fff',
        alignItems: 'center',
        justifyContent: 'center',
    },
    navAvatar: {
        width: 24,
        height: 24,
        borderRadius: 7,
        borderWidth: 1,
        borderColor: '#fff',
    },
    shareCoach: {
        position: 'absolute',
        right: 68,
        bottom: 188,
    },
    introOverlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 12,
        backgroundColor: '#211d1b',
    },
    introScrim: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(10,8,8,0.62)',
    },
    introContent: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 30,
    },
    introBadge: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: 'rgba(255,255,255,0.16)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.24)',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 20,
    },
    introTitle: {
        color: '#fff',
        fontFamily: 'Manrope_800ExtraBold',
        fontSize: 31,
        lineHeight: 35,
        letterSpacing: -0.8,
        textAlign: 'center',
    },
    introBody: {
        color: 'rgba(255,255,255,0.76)',
        fontFamily: 'Manrope_500Medium',
        fontSize: 14,
        lineHeight: 20,
        textAlign: 'center',
        maxWidth: 310,
        marginTop: 11,
    },
    introButton: {
        height: 52,
        minWidth: 178,
        borderRadius: 26,
        marginTop: 30,
        paddingLeft: 22,
        paddingRight: 20,
        backgroundColor: '#fff',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        ...Shadow.ambient,
    },
    introButtonText: {
        color: '#111',
        fontFamily: 'Manrope_700Bold',
        fontSize: 14,
    },
    platformLayer: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    platformScrim: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.38)',
    },
    platformDrawer: {
        minHeight: 376,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        backgroundColor: '#202124',
        paddingTop: 9,
        paddingHorizontal: 14,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.28,
        shadowRadius: 24,
    },
    drawerGrip: {
        width: 38,
        height: 4,
        borderRadius: 2,
        backgroundColor: '#64666a',
        alignSelf: 'center',
        marginBottom: 13,
    },
    searchField: {
        height: 36,
        borderRadius: 18,
        backgroundColor: '#303136',
        paddingHorizontal: 13,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    searchText: {
        color: '#a7a7ab',
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
    recipientRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginTop: 18,
        paddingHorizontal: 7,
    },
    recipient: {
        width: 70,
        alignItems: 'center',
    },
    recipientAvatar: {
        width: 55,
        height: 55,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 2,
        borderColor: '#202124',
        outlineColor: 'rgba(255,255,255,0.16)',
        outlineWidth: 1,
    },
    recipientInitials: {
        color: '#fff',
        fontFamily: 'Manrope_700Bold',
        fontSize: 16,
    },
    recipientName: {
        color: '#ececef',
        fontFamily: 'Manrope_500Medium',
        fontSize: 9.5,
        marginTop: 6,
    },
    platformRule: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: '#3b3c40',
        marginVertical: 17,
    },
    platformActionRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 3,
    },
    platformAction: {
        width: 76,
        alignItems: 'center',
    },
    platformActionIcon: {
        width: 54,
        height: 54,
        borderRadius: 27,
        backgroundColor: '#34353a',
        alignItems: 'center',
        justifyContent: 'center',
    },
    platformActionLabel: {
        color: '#f1f1f3',
        fontFamily: 'Manrope_500Medium',
        fontSize: 9,
        marginTop: 7,
        textAlign: 'center',
    },
    platformPulse: {
        position: 'absolute',
        width: 62,
        height: 62,
        borderRadius: 31,
        borderWidth: 2,
        borderColor: '#fff',
    },
    shareToCoach: {
        alignSelf: 'flex-end',
        marginTop: 14,
        marginRight: 6,
    },
    systemLayer: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    systemScrim: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.56)',
    },
    systemSheet: {
        position: 'absolute',
        left: 8,
        right: 8,
        minHeight: 465,
        maxHeight: '68%',
        borderRadius: 20,
        backgroundColor: 'rgba(247,247,249,0.98)',
        paddingTop: 8,
        paddingHorizontal: 14,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.3,
        shadowRadius: 32,
    },
    systemGrip: {
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: '#b7b7ba',
        alignSelf: 'center',
        marginBottom: 10,
    },
    systemMeta: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingBottom: 12,
    },
    systemThumb: {
        width: 45,
        height: 45,
        borderRadius: 8,
        outlineColor: 'rgba(0,0,0,0.1)',
        outlineWidth: 1,
    },
    systemMetaCopy: {
        flex: 1,
    },
    systemMetaTitle: {
        color: '#171719',
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12.5,
    },
    systemMetaUrl: {
        color: '#77777b',
        fontFamily: 'Manrope_500Medium',
        fontSize: 10,
        marginTop: 2,
    },
    systemClose: {
        width: 29,
        height: 29,
        borderRadius: 15,
        backgroundColor: '#e2e2e5',
        alignItems: 'center',
        justifyContent: 'center',
    },
    systemRule: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: 'rgba(60,60,67,0.22)',
    },
    systemApps: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingVertical: 17,
    },
    systemApp: {
        width: 61,
        alignItems: 'center',
    },
    systemAppIcon: {
        width: 51,
        height: 51,
        borderRadius: 12,
        outlineColor: 'rgba(0,0,0,0.1)',
        outlineWidth: 1,
    },
    systemAppIconCenter: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    systemAppLabel: {
        color: '#242426',
        fontFamily: 'Manrope_500Medium',
        fontSize: 8.5,
        marginTop: 6,
        textAlign: 'center',
    },
    napkinHitTarget: {
        width: 51,
        height: 51,
        alignItems: 'center',
        justifyContent: 'center',
    },
    napkinPulse: {
        position: 'absolute',
        width: 61,
        height: 61,
        borderRadius: 17,
        borderWidth: 2,
        borderColor: '#111',
    },
    systemActions: {
        marginTop: 12,
        borderRadius: 13,
        backgroundColor: '#fff',
        overflow: 'hidden',
    },
    systemAction: {
        height: 49,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        paddingHorizontal: 14,
        borderBottomColor: 'rgba(60,60,67,0.16)',
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    systemActionLabel: {
        flex: 1,
        color: '#18181a',
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
    napkinCoach: {
        position: 'absolute',
        top: 131,
        right: 10,
    },
    cancelSheet: {
        position: 'absolute',
        left: 8,
        right: 8,
        height: 55,
        borderRadius: 16,
        backgroundColor: 'rgba(247,247,249,0.98)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    cancelText: {
        color: '#1677ff',
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 16,
    },
    coachMark: {
        minHeight: 38,
        borderRadius: 20,
        paddingLeft: 15,
        paddingRight: 12,
        backgroundColor: '#fff',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 5 },
        shadowOpacity: 0.24,
        shadowRadius: 12,
        elevation: 5,
    },
    coachText: {
        color: '#111',
        fontFamily: 'Manrope_700Bold',
        fontSize: 11.5,
    },
    progressRail: {
        position: 'absolute',
        left: 14,
        right: 14,
        height: 3,
        flexDirection: 'row',
        gap: 4,
        zIndex: 30,
    },
    progressSegment: {
        flex: 1,
        height: 3,
        borderRadius: 2,
        backgroundColor: '#fff',
    },
    closeButton: {
        position: 'absolute',
        right: 14,
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(20,20,20,0.5)',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 40,
    },
    resultScreen: {
        flex: 1,
        paddingHorizontal: 20,
    },
    resultHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 20,
    },
    resultKicker: {
        fontFamily: 'Manrope_800ExtraBold',
        fontSize: 9,
        letterSpacing: 1.8,
        marginBottom: 2,
    },
    resultPageTitle: {
        fontFamily: 'Newsreader_700Bold',
        fontSize: 34,
        lineHeight: 38,
        letterSpacing: -0.8,
    },
    resultProfile: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    importSuccess: {
        borderRadius: 22,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 13,
        outlineColor: 'rgba(0,0,0,0.06)',
        outlineWidth: 1,
        ...Shadow.ambient,
    },
    successIcon: {
        width: 42,
        height: 42,
        borderRadius: 21,
        alignItems: 'center',
        justifyContent: 'center',
    },
    successCopy: {
        flex: 1,
    },
    successTitle: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
    },
    successBody: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 10.5,
        lineHeight: 15,
        marginTop: 3,
    },
    savedList: {
        marginTop: 20,
    },
    savedRow: {
        minHeight: 82,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    savedThumb: {
        width: 58,
        height: 58,
        borderRadius: 14,
        outlineColor: 'rgba(0,0,0,0.1)',
        outlineWidth: 1,
    },
    savedCopy: {
        flex: 1,
    },
    savedName: {
        fontFamily: 'Newsreader_600SemiBold',
        fontSize: 18,
        lineHeight: 20,
    },
    savedDetail: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 10,
        marginTop: 3,
    },
    ratingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        marginTop: 5,
    },
    rating: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9.5,
        fontVariant: ['tabular-nums'],
    },
    savedBookmark: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
    },
    resultSpacer: {
        flex: 1,
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
        fontFamily: 'Manrope_700Bold',
        fontSize: 14,
    },
});
