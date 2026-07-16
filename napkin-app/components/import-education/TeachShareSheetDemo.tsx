/**
 * Full-screen, interaction-gated simulator for TikTok → iOS share → Napkin.
 *
 * The walkthrough never opens TikTok or the system share sheet. It recreates the
 * visible flow in-app so every required control can be a real Pressable and the
 * onboarding remains deterministic, offline, and replayable.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Image,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    useWindowDimensions,
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
} from './teachDemoUtils';

type Palette = typeof Colors.light;
type IconName = React.ComponentProps<typeof Ionicons>['name'];

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

const VIDEO_IMAGE = require('../../assets/onboarding/tiktok-crudo.png');
const NAPKIN_ICON = require('../../assets/images/icon.png');

const TIKTOK_RECIPIENTS = [
    { name: 'Leah', initials: 'L', colors: ['#fa9d72', '#d95b83'] as const },
    { name: 'Marco', initials: 'M', colors: ['#5374e8', '#252b63'] as const },
    { name: 'Dinner crew', initials: 'DC', colors: ['#60bda5', '#17695d'] as const },
    { name: 'Sophie', initials: 'S', colors: ['#d9a5f0', '#7153b5'] as const },
    { name: 'London eats', initials: 'LE', colors: ['#f4b447', '#b86b21'] as const },
] as const;

const NEARBY_RECIPIENTS = [
    { name: 'MacBook Pro', icon: 'laptop-outline' as IconName, badge: '#2b8cff' },
    { name: 'Dinner group', icon: 'people-outline' as IconName, badge: '#2dcc62' },
    { name: 'Sam', icon: 'person-outline' as IconName, badge: '#5865f2' },
    { name: 'Family', icon: 'people-outline' as IconName, badge: '#2dcc62' },
] as const;

const SAVED_PLACES = [
    { name: 'Lita', detail: 'Marylebone · Mediterranean', score: '4.8' },
    { name: 'Donia', detail: 'Soho · Filipino', score: '4.7' },
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
    completionError = null,
}: TeachShareSheetDemoProps) {
    const reduced = useReducedMotion();
    const { width, height } = useWindowDimensions();
    const [beat, setBeat] = useState(0);
    const [tiktokMoreReady, setTiktokMoreReady] = useState(false);
    const [iosMoreReady, setIosMoreReady] = useState(false);
    const [napkinReady, setNapkinReady] = useState(false);
    const tiktokAppsRef = useRef<ScrollView>(null);
    const iosAppsRef = useRef<ScrollView>(null);
    const appListRef = useRef<ScrollView>(null);
    const revealTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
    const lastHapticBeat = useRef(beat);

    const targetPulse = useSharedValue(0);
    const tiktokDrawerProgress = useSharedValue(0);
    const iosSheetProgress = useSharedValue(0);
    const appsSheetProgress = useSharedValue(0);
    const resultProgress = useSharedValue(0);

    useEffect(() => {
        const duration = reduced ? 0 : 320;
        tiktokDrawerProgress.value = withTiming(beat === 2 ? 1 : 0, {
            duration,
            easing: Easing.out(Easing.cubic),
        });
        iosSheetProgress.value = withTiming(beat === 3 ? 1 : 0, {
            duration,
            easing: Easing.out(Easing.cubic),
        });
        appsSheetProgress.value = withTiming(beat === 4 ? 1 : 0, {
            duration,
            easing: Easing.out(Easing.cubic),
        });
        resultProgress.value = withTiming(beat === LAST_BEAT ? 1 : 0, {
            duration: reduced ? 0 : 280,
            easing: Easing.out(Easing.cubic),
        });
    }, [appsSheetProgress, beat, iosSheetProgress, reduced, resultProgress, tiktokDrawerProgress]);

    useEffect(() => {
        revealTimers.current.forEach(clearTimeout);
        revealTimers.current = [];
        setTiktokMoreReady(false);
        setIosMoreReady(false);
        setNapkinReady(false);

        const schedule = (fn: () => void, delay: number) => {
            const timer = setTimeout(fn, delay);
            revealTimers.current.push(timer);
        };

        if (beat === 2) {
            schedule(() => {
                tiktokAppsRef.current?.scrollTo({
                    x: Math.max(430, width * 1.15),
                    animated: !reduced,
                });
            }, reduced ? 0 : 430);
            schedule(() => setTiktokMoreReady(true), reduced ? 20 : 1180);
        }

        if (beat === 3) {
            schedule(() => {
                iosAppsRef.current?.scrollTo({
                    x: Math.max(112, 520 - width),
                    animated: !reduced,
                });
            }, reduced ? 0 : 420);
            schedule(() => setIosMoreReady(true), reduced ? 20 : 1050);
        }

        if (beat === 4) {
            schedule(() => {
                appListRef.current?.scrollTo({ y: width < 390 ? 205 : 165, animated: !reduced });
            }, reduced ? 0 : 480);
            schedule(() => setNapkinReady(true), reduced ? 20 : 1320);
        }

        return () => {
            revealTimers.current.forEach(clearTimeout);
            revealTimers.current = [];
        };
    }, [beat, reduced, width]);

    const shouldPulse =
        beat === 1 ||
        (beat === 2 && tiktokMoreReady) ||
        (beat === 3 && iosMoreReady) ||
        (beat === 4 && napkinReady);

    useEffect(() => {
        cancelAnimation(targetPulse);
        targetPulse.value = 0;
        if (reduced || !shouldPulse) return;
        targetPulse.value = withRepeat(
            withSequence(
                withTiming(1, { duration: 620, easing: Easing.out(Easing.cubic) }),
                withTiming(0, { duration: 0 }),
            ),
            2,
            false,
        );
        return () => cancelAnimation(targetPulse);
    }, [reduced, shouldPulse, targetPulse]);

    useEffect(() => {
        if (lastHapticBeat.current === beat) return;
        lastHapticBeat.current = beat;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    }, [beat]);

    const pulseStyle = useAnimatedStyle(() => ({
        opacity: 0.7 * (1 - targetPulse.value),
        transform: [{ scale: 0.82 + targetPulse.value * 0.55 }],
    }));
    const tiktokDrawerStyle = useAnimatedStyle(() => ({
        opacity: tiktokDrawerProgress.value,
        transform: [{ translateY: (1 - tiktokDrawerProgress.value) * 72 }],
    }));
    const iosSheetStyle = useAnimatedStyle(() => ({
        opacity: iosSheetProgress.value,
        transform: [{ translateY: (1 - iosSheetProgress.value) * 84 }],
    }));
    const appsSheetStyle = useAnimatedStyle(() => ({
        opacity: appsSheetProgress.value,
        transform: [{ translateY: (1 - appsSheetProgress.value) * 96 }],
    }));
    const resultStyle = useAnimatedStyle(() => ({
        opacity: resultProgress.value,
        transform: [{ scale: 0.985 + resultProgress.value * 0.015 }],
    }));

    const completeTarget = (target: TeachTarget) => {
        setBeat((current) => advanceOnTarget(current, target));
    };

    return (
        <View style={styles.root} accessibilityViewIsModal>
            <StatusBar style={beat === LAST_BEAT ? 'auto' : 'light'} />
            <TikTokScreen
                topInset={topInset}
                bottomInset={bottomInset}
                shareEnabled={beat === 1}
                accessibilityHidden={beat !== 1}
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
                accessibilityElementsHidden={beat !== 2}
                importantForAccessibility={beat === 2 ? 'auto' : 'no-hide-descendants'}
                style={[styles.fullOverlay, tiktokDrawerStyle]}
            >
                <TikTokShareDrawer
                    bottomInset={bottomInset}
                    appsRef={tiktokAppsRef}
                    moreReady={tiktokMoreReady}
                    pulseStyle={pulseStyle}
                    onMore={() => completeTarget('tiktokMore')}
                />
            </Animated.View>

            <Animated.View
                pointerEvents={beat === 3 ? 'auto' : 'none'}
                accessibilityElementsHidden={beat !== 3}
                importantForAccessibility={beat === 3 ? 'auto' : 'no-hide-descendants'}
                style={[styles.fullOverlay, iosSheetStyle]}
            >
                <IOSShareSheet
                    bottomInset={bottomInset}
                    cardHeight={Math.min(602, height - topInset - bottomInset - 12)}
                    appsRef={iosAppsRef}
                    moreReady={iosMoreReady}
                    pulseStyle={pulseStyle}
                    onMore={() => completeTarget('iosMore')}
                />
            </Animated.View>

            <Animated.View
                pointerEvents={beat === 4 ? 'auto' : 'none'}
                accessibilityElementsHidden={beat !== 4}
                importantForAccessibility={beat === 4 ? 'auto' : 'no-hide-descendants'}
                style={[styles.fullOverlay, appsSheetStyle]}
            >
                <IOSAppsList
                    topInset={topInset}
                    bottomInset={bottomInset}
                    scrollRef={appListRef}
                    napkinReady={napkinReady}
                    pulseStyle={pulseStyle}
                    onNapkin={() => completeTarget('napkin')}
                />
            </Animated.View>

            <Animated.View
                pointerEvents={beat === LAST_BEAT ? 'auto' : 'none'}
                accessibilityElementsHidden={beat !== LAST_BEAT}
                importantForAccessibility={beat === LAST_BEAT ? 'auto' : 'no-hide-descendants'}
                style={[styles.fullOverlay, resultStyle]}
            >
                <ResultScreen
                    palette={palette}
                    topInset={topInset}
                    bottomInset={bottomInset}
                    doneLabel={doneLabel}
                    isPending={isPending}
                    completionError={completionError}
                    onDone={onDone}
                />
            </Animated.View>

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
            <Image source={VIDEO_IMAGE} resizeMode="cover" blurRadius={22} style={StyleSheet.absoluteFill} />
            <View style={styles.introScrim} />
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

function TikTokScreen({
    topInset,
    bottomInset,
    shareEnabled,
    accessibilityHidden,
    pulseStyle,
    onShare,
}: {
    topInset: number;
    bottomInset: number;
    shareEnabled: boolean;
    accessibilityHidden: boolean;
    pulseStyle: object;
    onShare: () => void;
}) {
    return (
        <View
            style={styles.tiktokScreen}
            accessibilityElementsHidden={accessibilityHidden}
            importantForAccessibility={accessibilityHidden ? 'no-hide-descendants' : 'auto'}
        >
            <Image source={VIDEO_IMAGE} resizeMode="cover" style={StyleSheet.absoluteFill} />
            <LinearGradient
                colors={['rgba(0,0,0,0.42)', 'transparent', 'rgba(0,0,0,0.9)']}
                locations={[0, 0.37, 1]}
                style={StyleSheet.absoluteFill}
            />
            <LinearGradient
                colors={['transparent', 'rgba(0,0,0,0.3)']}
                start={{ x: 0.62, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
            />

            <View style={[styles.tiktokTabs, { top: topInset + 21 }]}>
                <View style={styles.liveTab}>
                    <Ionicons name="tv-outline" size={15} color="#fff" />
                    <Text style={styles.tabTextMuted}>LIVE</Text>
                </View>
                <Text style={styles.tabTextMuted}>Nearby</Text>
                <Text style={styles.tabTextMuted}>Following</Text>
                <Text style={styles.tabTextMuted}>Friends</Text>
                <View style={styles.activeTabWrap}>
                    <Text style={styles.tabTextActive}>For You</Text>
                    <View style={styles.activeTabRule} />
                </View>
                <Ionicons name="search" size={25} color="#fff" />
            </View>

            <View style={[styles.videoWords, { top: topInset + 305 }]} pointerEvents="none">
                <Text style={styles.videoWordsTitle}>london crudo worth the hype</Text>
                <Ionicons name="play" size={48} color="rgba(255,255,255,0.48)" style={styles.playOptical} />
            </View>

            <View style={[styles.tiktokRail, { bottom: bottomInset + 99 }]}>
                <View style={styles.creatorAvatarWrap}>
                    <Image source={VIDEO_IMAGE} style={styles.creatorAvatar} />
                    <View style={styles.followPlus}>
                        <Ionicons name="add" size={15} color="#fff" />
                    </View>
                </View>
                <TikTokRailAction icon="heart" label="12.4K" />
                <TikTokRailAction icon="chatbubble-ellipses" label="126" />
                <TikTokRailAction icon="bookmark" label="1,842" />
                <Pressable
                    onPress={onShare}
                    disabled={!shareEnabled}
                    accessibilityRole="button"
                    accessibilityLabel="Share this TikTok"
                    accessibilityHint="Opens TikTok sharing options"
                    style={({ pressed }) => [
                        styles.railAction,
                        { transform: [{ scale: pressed && shareEnabled ? 0.96 : 1 }] },
                    ]}
                >
                    {shareEnabled ? <Animated.View style={[styles.targetPulse, pulseStyle]} /> : null}
                    <Ionicons name="arrow-redo" size={29} color="#fff" />
                    <Text style={styles.railCount}>Share</Text>
                </Pressable>
                <View style={styles.musicDisc}>
                    <Ionicons name="musical-note" size={16} color="#fff" />
                </View>
            </View>

            <View style={[styles.tiktokCaption, { bottom: bottomInset + 73 }]}>
                <View style={styles.locationPill}>
                    <Ionicons name="location" size={13} color="#fff" />
                    <Text style={styles.locationText}>London · 2.4 km</Text>
                </View>
                <Text style={styles.creatorHandle}>tableforlater</Text>
                <Text style={styles.captionText} numberOfLines={2}>
                    The crudo I would cross London for. Three more spots in this video...{' '}
                    <Text style={styles.captionMore}>more</Text>
                </Text>
                <View style={styles.audioRow}>
                    <Ionicons name="musical-notes" size={13} color="#fff" />
                    <Text style={styles.audioText}>original sound · tableforlater</Text>
                </View>
            </View>

            <View style={[styles.tiktokBottomNav, { height: bottomInset + 58 }]}>
                <BottomNavItem icon="home" label="Home" active />
                <BottomNavItem icon="bag-handle-outline" label="Shop" />
                <View style={styles.createButtonShell}>
                    <View style={styles.createButton}>
                        <Ionicons name="add" size={24} color="#111" />
                    </View>
                </View>
                <BottomNavItem icon="chatbox-ellipses-outline" label="Inbox" badge />
                <BottomNavItem icon="person-outline" label="Profile" />
            </View>

            {shareEnabled ? (
                <CoachMark text={TEACH_COPY.shareHint} style={[styles.shareCoach, { bottom: bottomInset + 132 }]} />
            ) : null}
        </View>
    );
}

function TikTokRailAction({ icon, label }: { icon: IconName; label: string }) {
    return (
        <View style={styles.railAction}>
            <Ionicons name={icon} size={29} color="#fff" />
            <Text style={styles.railCount}>{label}</Text>
        </View>
    );
}

function BottomNavItem({
    icon,
    label,
    active = false,
    badge = false,
}: {
    icon: IconName;
    label: string;
    active?: boolean;
    badge?: boolean;
}) {
    return (
        <View style={styles.bottomNavItem}>
            <View>
                <Ionicons name={icon} size={23} color={active ? '#fff' : '#b7b7ba'} />
                {badge ? <View style={styles.inboxBadge}><Text style={styles.inboxBadgeText}>1</Text></View> : null}
            </View>
            <Text style={[styles.bottomNavLabel, active ? styles.bottomNavLabelActive : null]}>{label}</Text>
        </View>
    );
}

function TikTokShareDrawer({
    bottomInset,
    appsRef,
    moreReady,
    pulseStyle,
    onMore,
}: {
    bottomInset: number;
    appsRef: React.RefObject<ScrollView | null>;
    moreReady: boolean;
    pulseStyle: object;
    onMore: () => void;
}) {
    return (
        <View style={styles.modalLayer}>
            <View style={styles.darkScrim} />
            <View style={[styles.tiktokDrawer, { paddingBottom: bottomInset + 12 }]}>
                <View style={styles.drawerHeader}>
                    <Ionicons name="search" size={24} color="#fff" />
                    <Text style={styles.drawerTitle}>Send to</Text>
                    <Ionicons name="close" size={27} color="#fff" />
                </View>

                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.recipientStrip}
                >
                    {TIKTOK_RECIPIENTS.map((person) => (
                        <View key={person.name} style={styles.recipientItem}>
                            <LinearGradient colors={person.colors} style={styles.recipientAvatar}>
                                <Text style={styles.recipientInitials}>{person.initials}</Text>
                            </LinearGradient>
                            <Text style={styles.recipientName} numberOfLines={2}>{person.name}</Text>
                        </View>
                    ))}
                </ScrollView>

                <View style={styles.drawerDivider} />
                <ScrollView
                    ref={appsRef}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    scrollEnabled
                    contentContainerStyle={styles.tiktokShareStrip}
                >
                    <RoundShareAction label="WhatsApp" color="#20cf66" icon="logo-whatsapp" />
                    <RoundShareAction label="Instagram Direct" color="#d73793" icon="paper-plane" />
                    <RoundShareAction label="Email" color="#1cb5e5" icon="mail" />
                    <RoundShareAction label="Stories" color="#d532b9" icon="add-circle-outline" />
                    <RoundShareAction label="Instagram" color="#b731ad" icon="logo-instagram" />
                    <RoundShareAction label="Messages" color="#32c95a" icon="chatbubble" />
                    <RoundShareAction label="Copy link" color="#3e3e41" icon="link" />
                    <View style={styles.roundShareAction}>
                        <Pressable
                            onPress={onMore}
                            disabled={!moreReady}
                            accessibilityRole="button"
                            accessibilityLabel="Open more sharing options"
                            accessibilityHint="Opens the iOS share sheet"
                            style={({ pressed }) => [
                                styles.roundShareIcon,
                                styles.moreBlue,
                                { transform: [{ scale: pressed && moreReady ? 0.96 : 1 }] },
                            ]}
                        >
                            {moreReady ? <Animated.View style={[styles.targetPulse, pulseStyle]} /> : null}
                            <Ionicons name="ellipsis-horizontal" size={27} color="#fff" />
                        </Pressable>
                        <Text style={styles.roundShareLabel}>More</Text>
                    </View>
                </ScrollView>

                <View style={styles.drawerDivider} />
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.tiktokActionStrip}
                >
                    <RoundShareAction label="Report" color="#424245" icon="flag" />
                    <RoundShareAction label="Not interested" color="#424245" icon="heart-dislike" />
                    <RoundShareAction label="Download" color="#424245" icon="download" />
                    <RoundShareAction label="Promote" color="#424245" icon="flame" />
                    <RoundShareAction label="Stitch" color="#424245" icon="scan" />
                    <RoundShareAction label="Add to Story" color="#424245" icon="add-circle-outline" />
                </ScrollView>

                {moreReady ? <CoachMark text={TEACH_COPY.tiktokMoreHint} style={styles.tiktokMoreCoach} /> : null}
            </View>
        </View>
    );
}

function RoundShareAction({
    label,
    color,
    icon,
}: {
    label: string;
    color: string;
    icon: IconName;
}) {
    return (
        <View style={styles.roundShareAction}>
            <View style={[styles.roundShareIcon, { backgroundColor: color }]}>
                <Ionicons name={icon} size={26} color="#fff" />
            </View>
            <Text style={styles.roundShareLabel} numberOfLines={2}>{label}</Text>
        </View>
    );
}

function IOSShareSheet({
    bottomInset,
    cardHeight,
    appsRef,
    moreReady,
    pulseStyle,
    onMore,
}: {
    bottomInset: number;
    cardHeight: number;
    appsRef: React.RefObject<ScrollView | null>;
    moreReady: boolean;
    pulseStyle: object;
    onMore: () => void;
}) {
    return (
        <View style={styles.modalLayer}>
            <View style={styles.iosScrim} />
            <View style={[styles.iosShareCard, { bottom: bottomInset + 4, height: cardHeight }]}>
                <View style={styles.linkMetaRow}>
                    <View style={styles.tiktokIconTile}>
                        <Ionicons name="logo-tiktok" size={38} color="#fff" />
                    </View>
                    <View style={styles.linkMetaCopy}>
                        <Text style={styles.linkMetaTitle}>TikTok · tableforlater</Text>
                        <Text style={styles.linkMetaUrl}>vm.tiktok.com</Text>
                    </View>
                    <View style={styles.airdropButton}>
                        <Ionicons name="radio-outline" size={25} color="#fff" />
                    </View>
                </View>
                <View style={styles.iosDivider} />

                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.nearbyStrip}
                >
                    {NEARBY_RECIPIENTS.map((person) => (
                        <View key={person.name} style={styles.nearbyItem}>
                            <View style={styles.nearbyAvatar}>
                                <Ionicons name={person.icon} size={31} color="#434348" />
                                <View style={[styles.nearbyBadge, { backgroundColor: person.badge }]} />
                            </View>
                            <Text style={styles.nearbyName} numberOfLines={2}>{person.name}</Text>
                        </View>
                    ))}
                </ScrollView>
                <View style={styles.iosDivider} />

                <ScrollView
                    ref={appsRef}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.iosAppStrip}
                >
                    <SquareShareApp label="Reminders" color="#fff" icon="list" iconColor="#3c74ee" />
                    <SquareShareApp label="Journal" color="#262a49" icon="book" iconColor="#bd77f4" />
                    <SquareShareApp label="Claude" color="#df7954" icon="sparkles" />
                    <SquareShareApp label="Teams" color="#fff" icon="people" iconColor="#6d64e8" />
                    <View style={styles.squareShareApp}>
                        <Pressable
                            onPress={onMore}
                            disabled={!moreReady}
                            accessibilityRole="button"
                            accessibilityLabel="Show all apps"
                            accessibilityHint="Opens the full iOS Apps list"
                            style={({ pressed }) => [
                                styles.squareAppIcon,
                                styles.squareMore,
                                { transform: [{ scale: pressed && moreReady ? 0.96 : 1 }] },
                            ]}
                        >
                            {moreReady ? <Animated.View style={[styles.targetPulseDark, pulseStyle]} /> : null}
                            <Ionicons name="ellipsis-horizontal" size={27} color="#66666c" />
                        </Pressable>
                        <Text style={styles.squareAppLabel}>More</Text>
                    </View>
                </ScrollView>
                <View style={styles.iosDivider} />

                <View style={styles.iosActionsRow}>
                    <IOSAction label="Copy" icon="copy-outline" />
                    <IOSAction label={'Add to New\nQuick Note'} icon="document-text-outline" />
                    <IOSAction label={'Translate\nwith DeepL'} icon="git-network-outline" />
                    <IOSAction label="View More" icon="chevron-down" />
                </View>
                {moreReady ? <CoachMark text={TEACH_COPY.iosMoreHint} style={styles.iosMoreCoach} /> : null}
            </View>
        </View>
    );
}

function SquareShareApp({
    label,
    color,
    icon,
    iconColor = '#fff',
}: {
    label: string;
    color: string;
    icon: IconName;
    iconColor?: string;
}) {
    return (
        <View style={styles.squareShareApp}>
            <View style={[styles.squareAppIcon, { backgroundColor: color }]}>
                <Ionicons name={icon} size={29} color={iconColor} />
            </View>
            <Text style={styles.squareAppLabel}>{label}</Text>
        </View>
    );
}

function IOSAction({ label, icon }: { label: string; icon: IconName }) {
    return (
        <View style={styles.iosAction}>
            <View style={styles.iosActionIcon}>
                <Ionicons name={icon} size={25} color="#fff" />
            </View>
            <Text style={styles.iosActionLabel}>{label}</Text>
        </View>
    );
}

function IOSAppsList({
    topInset,
    bottomInset,
    scrollRef,
    napkinReady,
    pulseStyle,
    onNapkin,
}: {
    topInset: number;
    bottomInset: number;
    scrollRef: React.RefObject<ScrollView | null>;
    napkinReady: boolean;
    pulseStyle: object;
    onNapkin: () => void;
}) {
    return (
        <View style={styles.modalLayer}>
            <View style={styles.iosScrim} />
            <View style={[styles.appsSheet, { top: topInset + 26 }]}>
                <View style={styles.appsHeader}>
                    <View style={styles.appsDone}>
                        <Ionicons name="checkmark" size={30} color="#fff" />
                    </View>
                    <Text style={styles.appsTitle}>Apps</Text>
                    <View style={styles.editPill}>
                        <Text style={styles.editText}>Edit</Text>
                    </View>
                </View>
                <ScrollView
                    ref={scrollRef}
                    showsVerticalScrollIndicator
                    indicatorStyle="white"
                    contentContainerStyle={{ paddingBottom: bottomInset + 80 }}
                >
                    <Text style={styles.sectionTitle}>Favourites</Text>
                    <View style={styles.appsGroup}>
                        <AppListRow label="AirDrop" icon="radio-outline" color="#2d8eff" />
                        <AppListRow label="Messages" icon="chatbubble" color="#32c95a" />
                        <AppListRow label="Mail" icon="mail" color="#2b86ef" last />
                    </View>

                    <Text style={styles.sectionTitle}>Suggestions</Text>
                    <View style={styles.appsGroup}>
                        <View style={styles.appRow}>
                            <Pressable
                                onPress={onNapkin}
                                disabled={!napkinReady}
                                accessibilityRole="button"
                                accessibilityLabel="Share to Napkin"
                                accessibilityHint="Imports this TikTok into Napkin"
                                style={({ pressed }) => [
                                    styles.napkinRowTarget,
                                    {
                                        backgroundColor: pressed && napkinReady ? 'rgba(255,255,255,0.08)' : 'transparent',
                                        transform: [{ scale: pressed && napkinReady ? 0.96 : 1 }],
                                    },
                                ]}
                            >
                                {napkinReady ? <Animated.View style={[styles.napkinRowPulse, pulseStyle]} /> : null}
                                <Image source={NAPKIN_ICON} style={styles.appListIcon} />
                                <Text style={styles.appRowLabel}>Napkin</Text>
                                {napkinReady ? <CoachMark text={TEACH_COPY.napkinHint} style={styles.napkinRowCoach} /> : null}
                            </Pressable>
                            <View style={styles.rowDivider} />
                        </View>
                        <AppListRow label="Rodeo" icon="compass" color="#6d5748" />
                        <AppListRow label="ReciMe" icon="restaurant" color="#397de6" iconColor="#ffd33d" />
                        <AppListRow label="WhatsApp" icon="logo-whatsapp" color="#22cb5c" />
                        <AppListRow label="Notes" icon="document-text" color="#f6c52b" />
                        <AppListRow label="Reminders" icon="list" color="#fff" iconColor="#4b7ae8" />
                        <AppListRow label="Journal" icon="book" color="#242746" iconColor="#b675ef" />
                        <AppListRow label="Claude" icon="sparkles" color="#dc7956" />
                        <AppListRow label="Teams" icon="people" color="#fff" iconColor="#6d64e8" />
                        <AppListRow label="Safari" icon="navigate" color="#2f91f3" last />
                    </View>
                </ScrollView>
            </View>
        </View>
    );
}

function AppListRow({
    label,
    icon,
    color,
    iconColor = '#fff',
    last = false,
}: {
    label: string;
    icon: IconName;
    color: string;
    iconColor?: string;
    last?: boolean;
}) {
    return (
        <View style={styles.appRow}>
            <View style={styles.appRowInner}>
                <View style={[styles.appListIcon, styles.appListIconCenter, { backgroundColor: color }]}>
                    <Ionicons name={icon} size={24} color={iconColor} />
                </View>
                <Text style={styles.appRowLabel}>{label}</Text>
            </View>
            {!last ? <View style={styles.rowDivider} /> : null}
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
                        <Image source={VIDEO_IMAGE} style={styles.savedThumb} />
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

function CoachMark({ text, style }: { text: string; style: object | object[] }) {
    return (
        <View style={[styles.coachMark, style]} pointerEvents="none">
            <Text style={styles.coachText}>{text}</Text>
            <Ionicons name="arrow-forward" size={17} color="#111" />
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
    fullOverlay: { ...StyleSheet.absoluteFillObject },
    tiktokScreen: { flex: 1, backgroundColor: '#18130f' },
    tiktokTabs: {
        position: 'absolute', left: 9, right: 13, height: 45, flexDirection: 'row',
        alignItems: 'center', justifyContent: 'space-between', gap: 9,
    },
    liveTab: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    tabTextMuted: {
        color: 'rgba(255,255,255,0.72)', fontFamily: 'Manrope_600SemiBold', fontSize: 13,
        textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
    },
    activeTabWrap: { alignItems: 'center' },
    tabTextActive: { color: '#fff', fontFamily: 'Manrope_700Bold', fontSize: 15 },
    activeTabRule: { width: 28, height: 2, borderRadius: 1, backgroundColor: '#fff', marginTop: 6 },
    videoWords: { position: 'absolute', left: 36, right: 74, alignItems: 'center', gap: 48 },
    videoWordsTitle: {
        color: '#fff', fontFamily: 'Newsreader_500Medium', fontSize: 25, lineHeight: 30,
        textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 5,
    },
    playOptical: { marginLeft: 3 },
    tiktokRail: { position: 'absolute', right: 7, alignItems: 'center', gap: 10, zIndex: 5 },
    creatorAvatarWrap: { width: 50, height: 54, alignItems: 'center' },
    creatorAvatar: { width: 45, height: 45, borderRadius: 23, borderWidth: 1, borderColor: 'rgba(255,255,255,0.72)' },
    followPlus: {
        position: 'absolute', bottom: 0, width: 20, height: 20, borderRadius: 10,
        backgroundColor: '#fe2c55', alignItems: 'center', justifyContent: 'center',
    },
    railAction: { width: 54, minHeight: 49, alignItems: 'center', justifyContent: 'center', gap: 2 },
    railCount: {
        color: '#fff', fontFamily: 'Manrope_700Bold', fontSize: 11, fontVariant: ['tabular-nums'],
        textShadowColor: 'rgba(0,0,0,0.62)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
    },
    musicDisc: {
        width: 42, height: 42, borderRadius: 21, backgroundColor: '#18181a', borderWidth: 6,
        borderColor: '#363639', alignItems: 'center', justifyContent: 'center',
    },
    targetPulse: {
        position: 'absolute', width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(255,255,255,0.78)',
    },
    targetPulseDark: {
        position: 'absolute', width: 62, height: 62, borderRadius: 18, backgroundColor: 'rgba(30,136,255,0.34)',
    },
    tiktokCaption: { position: 'absolute', left: 13, right: 70, zIndex: 3 },
    locationPill: {
        alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5,
        paddingHorizontal: 9, height: 28, borderRadius: 6, backgroundColor: 'rgba(25,25,27,0.62)', marginBottom: 10,
    },
    locationText: { color: '#fff', fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
    creatorHandle: { color: '#fff', fontFamily: 'Manrope_700Bold', fontSize: 16, marginBottom: 6 },
    captionText: {
        color: '#fff', fontFamily: 'Manrope_500Medium', fontSize: 14, lineHeight: 19,
        textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
    },
    captionMore: { fontFamily: 'Manrope_700Bold' },
    audioRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
    audioText: { color: '#fff', fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
    tiktokBottomNav: {
        position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#050505',
        flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-start', paddingTop: 8,
    },
    bottomNavItem: { width: 59, alignItems: 'center', gap: 2 },
    bottomNavLabel: { color: '#b7b7ba', fontFamily: 'Manrope_600SemiBold', fontSize: 10 },
    bottomNavLabelActive: { color: '#fff' },
    inboxBadge: {
        position: 'absolute', top: -6, right: -8, minWidth: 18, height: 18, borderRadius: 9,
        paddingHorizontal: 4, backgroundColor: '#fe2c55', alignItems: 'center', justifyContent: 'center',
    },
    inboxBadgeText: { color: '#fff', fontFamily: 'Manrope_700Bold', fontSize: 10 },
    createButtonShell: {
        width: 48, height: 31, borderRadius: 9, marginTop: 1, backgroundColor: '#20d6dd', paddingLeft: 5,
    },
    createButton: {
        width: 43, height: 31, borderRadius: 9, backgroundColor: '#fff', borderRightWidth: 5,
        borderRightColor: '#fe2c55', alignItems: 'center', justifyContent: 'center',
    },
    shareCoach: { position: 'absolute', right: 68 },
    coachMark: {
        height: 46, borderRadius: 23, paddingLeft: 17, paddingRight: 14, backgroundColor: '#fff',
        flexDirection: 'row', alignItems: 'center', gap: 9, shadowColor: '#000', shadowOpacity: 0.2,
        shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 7, zIndex: 30,
    },
    coachText: { color: '#111', fontFamily: 'Manrope_700Bold', fontSize: 14 },
    modalLayer: { flex: 1, justifyContent: 'flex-end' },
    darkScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.24)' },
    iosScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.38)' },
    tiktokDrawer: {
        height: 455, borderTopLeftRadius: 25, borderTopRightRadius: 25, backgroundColor: '#1d1d1f', overflow: 'hidden',
    },
    drawerHeader: {
        height: 58, paddingHorizontal: 19, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    },
    drawerTitle: { color: '#fff', fontFamily: 'Manrope_700Bold', fontSize: 19 },
    recipientStrip: { paddingHorizontal: 12, paddingBottom: 12, gap: 4 },
    recipientItem: { width: 82, alignItems: 'center', gap: 7 },
    recipientAvatar: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
    recipientInitials: { color: '#fff', fontFamily: 'Manrope_700Bold', fontSize: 16 },
    recipientName: { height: 34, color: '#ededee', fontFamily: 'Manrope_500Medium', fontSize: 11, lineHeight: 15, textAlign: 'center' },
    drawerDivider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.14)' },
    tiktokShareStrip: { paddingHorizontal: 12, paddingVertical: 14, gap: 1 },
    tiktokActionStrip: { paddingHorizontal: 12, paddingTop: 14, gap: 1 },
    roundShareAction: { width: 84, alignItems: 'center', gap: 7, flexShrink: 0 },
    roundShareIcon: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    roundShareLabel: { height: 34, color: '#ededee', fontFamily: 'Manrope_500Medium', fontSize: 11, lineHeight: 15, textAlign: 'center' },
    moreBlue: { backgroundColor: '#2b91ec' },
    tiktokMoreCoach: { position: 'absolute', right: 94, top: 212 },
    iosShareCard: {
        position: 'absolute', left: 9, right: 9, borderRadius: 34,
        backgroundColor: 'rgba(67,59,54,0.96)', paddingTop: 18, overflow: 'hidden',
        borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)',
    },
    linkMetaRow: { height: 78, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 13 },
    tiktokIconTile: { width: 58, height: 58, borderRadius: 14, backgroundColor: '#050505', alignItems: 'center', justifyContent: 'center' },
    linkMetaCopy: { flex: 1 },
    linkMetaTitle: { color: '#fff', fontFamily: 'Manrope_700Bold', fontSize: 15 },
    linkMetaUrl: { color: 'rgba(255,255,255,0.58)', fontFamily: 'Manrope_500Medium', fontSize: 14, marginTop: 3 },
    airdropButton: { width: 47, height: 47, borderRadius: 24, backgroundColor: '#53c763', alignItems: 'center', justifyContent: 'center' },
    iosDivider: { marginHorizontal: 18, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.14)' },
    nearbyStrip: { paddingHorizontal: 16, paddingVertical: 14, gap: 4 },
    nearbyItem: { width: 86, alignItems: 'center', gap: 7 },
    nearbyAvatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#f2f2f3', alignItems: 'center', justifyContent: 'center' },
    nearbyBadge: { position: 'absolute', right: -1, bottom: -1, width: 17, height: 17, borderRadius: 5, borderWidth: 2, borderColor: '#f2f2f3' },
    nearbyName: { height: 36, color: '#fff', fontFamily: 'Manrope_500Medium', fontSize: 11, lineHeight: 15, textAlign: 'center' },
    iosAppStrip: { paddingHorizontal: 16, paddingVertical: 14, gap: 2 },
    squareShareApp: { width: 88, alignItems: 'center', gap: 7, flexShrink: 0 },
    squareAppIcon: { width: 66, height: 66, borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    squareMore: { backgroundColor: '#f7f7f8' },
    squareAppLabel: { color: '#fff', fontFamily: 'Manrope_500Medium', fontSize: 12, textAlign: 'center' },
    iosActionsRow: { flexDirection: 'row', paddingHorizontal: 14, paddingTop: 15, justifyContent: 'space-between' },
    iosAction: { width: 84, alignItems: 'center', gap: 8 },
    iosActionIcon: { width: 62, height: 62, borderRadius: 31, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
    iosActionLabel: { color: '#fff', fontFamily: 'Manrope_500Medium', fontSize: 11, lineHeight: 15, textAlign: 'center' },
    iosMoreCoach: { position: 'absolute', right: 94, top: 330 },
    appsSheet: {
        position: 'absolute', left: 0, right: 0, bottom: 0, borderTopLeftRadius: 38, borderTopRightRadius: 38,
        backgroundColor: '#1c1c1e', overflow: 'hidden',
    },
    appsHeader: { height: 112, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    appsDone: { width: 51, height: 51, borderRadius: 26, backgroundColor: '#2493f5', alignItems: 'center', justifyContent: 'center' },
    appsTitle: { color: '#fff', fontFamily: 'Manrope_700Bold', fontSize: 20 },
    editPill: {
        minWidth: 72, height: 46, borderRadius: 23, paddingHorizontal: 17, backgroundColor: '#2d2d30',
        borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.17)', alignItems: 'center', justifyContent: 'center',
    },
    editText: { color: '#fff', fontFamily: 'Manrope_500Medium', fontSize: 18 },
    sectionTitle: { color: '#8d8d94', fontFamily: 'Manrope_700Bold', fontSize: 19, marginLeft: 32, marginTop: 22, marginBottom: 12 },
    appsGroup: { marginHorizontal: 18, borderRadius: 26, backgroundColor: '#2c2c2e', overflow: 'hidden' },
    appRow: { minHeight: 64 },
    appRowInner: { height: 64, flexDirection: 'row', alignItems: 'center', gap: 15, paddingHorizontal: 20 },
    napkinRowTarget: { height: 64, flexDirection: 'row', alignItems: 'center', gap: 15, paddingHorizontal: 20 },
    appListIcon: { width: 40, height: 40, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.1)' },
    appListIconCenter: { alignItems: 'center', justifyContent: 'center' },
    appRowLabel: { color: '#fff', fontFamily: 'Manrope_500Medium', fontSize: 18 },
    rowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.13)', marginLeft: 75, marginRight: 20 },
    napkinRowPulse: { position: 'absolute', left: 17, width: 46, height: 46, borderRadius: 12, backgroundColor: 'rgba(36,147,245,0.4)' },
    napkinRowCoach: { position: 'absolute', right: 10, height: 40, borderRadius: 20 },
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
    resultScreen: { flex: 1, paddingHorizontal: 18 },
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
