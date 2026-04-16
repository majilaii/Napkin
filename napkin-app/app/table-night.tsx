/**
 * Table Night voting screen — live group rating session.
 * Independent star rating + separate category sliders (vibe/flavor/service/value).
 * Wired to real Supabase data via hooks.
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Pressable,
    Dimensions,
    ActivityIndicator,
    Alert,
    Animated,
    Easing,
    ActionSheetIOS,
    Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import Slider from '@react-native-community/slider';
import * as ImagePicker from 'expo-image-picker';

import { Colors, Spacing, Radius, Shadow, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { compressAndUpload, removeUploadedPhoto } from '@/lib/imageUpload';
import {
    useTableNightStatus,
    useRateTableNight,
    useReadyTableNight,
    useRevealTableNight,
    useJoinTableNight,
    type TableNightParticipant,
} from '@/hooks/tables/useTableNight';
import { useTableNightRealtime } from '@/hooks/tables/useTableNightRealtime';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HERO_HEIGHT = 420;

// ── Slider categories ──────────────────────────────────────────────────────

const CATEGORIES = [
    { key: 'vibe', label: 'Vibe' },
    { key: 'flavor', label: 'Flavor' },
    { key: 'service', label: 'Service' },
    { key: 'value', label: 'Value for Money' },
] as const;

const DESCRIPTOR: Record<string, string[]> = {
    vibe: ['Quiet', 'Mellow', 'Warm', 'Lively', 'High Energy'],
    flavor: ['Missed', 'Decent', 'Solid', 'Impressive', 'Masterful'],
    service: ['Absent', 'Slow', 'Fair', 'Attentive', 'Impeccable'],
    value: ['Overpriced', 'Steep', 'Fair', 'Good Deal', 'A Steal'],
};

function getDescriptor(key: string, value: number): string {
    const list = DESCRIPTOR[key] ?? [];
    const idx = Math.min(Math.floor((value / 5) * list.length), list.length - 1);
    return list[idx];
}

type Palette = typeof Colors.light;

// ── Pulsing Dot ────────────────────────────────────────────────────────────

function PulseDot({ color, size = 10 }: { color: string; size?: number }) {
    const pulse = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        const animation = Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, {
                    toValue: 0.3,
                    duration: 800,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(pulse, {
                    toValue: 1,
                    duration: 800,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ])
        );
        animation.start();
        return () => animation.stop();
    }, [pulse]);

    return (
        <View style={{ width: size + 8, height: size + 8, alignItems: 'center', justifyContent: 'center' }}>
            <Animated.View
                style={{
                    position: 'absolute',
                    width: size + 8,
                    height: size + 8,
                    borderRadius: (size + 8) / 2,
                    backgroundColor: color,
                    opacity: pulse,
                    transform: [{ scale: pulse.interpolate({ inputRange: [0.3, 1], outputRange: [1.4, 0.8] }) }],
                }}
            />
            <View
                style={{
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    backgroundColor: color,
                }}
            />
        </View>
    );
}

// ── Screen ─────────────────────────────────────────────────────────────────

export default function TableNightScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const { nightId } = useLocalSearchParams<{ nightId: string }>();

    // Data
    const { data: nightStatus, isLoading } = useTableNightStatus(nightId);
    const rateMutation = useRateTableNight();
    const readyMutation = useReadyTableNight();
    const revealMutation = useRevealTableNight();
    const joinMutation = useJoinTableNight();

    // Realtime
    useTableNightRealtime({
        nightId,
        onReveal: () => {},
    });

    // Independent overall star rating
    const [starRating, setStarRating] = useState(3.0);

    // Category sliders (separate from star rating)
    const [categories, setCategories] = useState<Record<string, number>>({
        vibe: 3.0,
        flavor: 3.0,
        service: 3.0,
        value: 3.0,
    });

    const updateCategory = (key: string, value: number) => {
        const snapped = Math.round(value * 2) / 2;
        setCategories((prev) => ({ ...prev, [key]: snapped }));
    };

    const updateStar = (value: number) => {
        setStarRating(Math.round(value * 2) / 2);
    };

    // ── Photo state ───────────────────────────────────────────────────────
    const [photoUri, setPhotoUri] = useState<string | null>(null);
    const [photoPublicUrl, setPhotoPublicUrl] = useState<string | null>(null);
    const [photoUploading, setPhotoUploading] = useState(false);
    const [photoError, setPhotoError] = useState(false);

    const uploadPhoto = useCallback(async (uri: string) => {
        if (!user?.id) return;
        setPhotoUri(uri);
        setPhotoUploading(true);
        setPhotoError(false);
        try {
            const publicUrl = await compressAndUpload(uri, user.id);
            setPhotoPublicUrl(publicUrl);
        } catch {
            setPhotoError(true);
        } finally {
            setPhotoUploading(false);
        }
    }, [user?.id]);

    const pickFromCamera = useCallback(async () => {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
            Alert.alert('Permission needed', 'Camera access is required to take a photo.');
            return;
        }
        const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            quality: 1,
        });
        if (!result.canceled && result.assets[0]) {
            uploadPhoto(result.assets[0].uri);
        }
    }, [uploadPhoto]);

    const pickFromLibrary = useCallback(async () => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 1,
        });
        if (!result.canceled && result.assets[0]) {
            uploadPhoto(result.assets[0].uri);
        }
    }, [uploadPhoto]);

    const handlePhotoPress = useCallback(() => {
        if (Platform.OS === 'ios') {
            ActionSheetIOS.showActionSheetWithOptions(
                {
                    options: ['Cancel', 'Take Photo', 'Choose from Library'],
                    cancelButtonIndex: 0,
                },
                (buttonIndex) => {
                    if (buttonIndex === 1) pickFromCamera();
                    if (buttonIndex === 2) pickFromLibrary();
                }
            );
        } else {
            Alert.alert('Add Photo', '', [
                { text: 'Take Photo', onPress: pickFromCamera },
                { text: 'Choose from Library', onPress: pickFromLibrary },
                { text: 'Cancel', style: 'cancel' },
            ]);
        }
    }, [pickFromCamera, pickFromLibrary]);

    const dismissPhoto = useCallback(async () => {
        if (photoPublicUrl) {
            removeUploadedPhoto(photoPublicUrl).catch(() => {});
        }
        setPhotoUri(null);
        setPhotoPublicUrl(null);
        setPhotoError(false);
    }, [photoPublicUrl]);

    // Derived state
    const myParticipant = nightStatus?.participants.find(
        (p) => p.user_id === user?.id
    );
    const isParticipant = !!myParticipant;
    const isReady = myParticipant?.ready ?? false;
    const isHost = nightStatus?.host_user_id === user?.id;
    const isRevealed = nightStatus?.status === 'revealed';
    const allReady = nightStatus?.participants.every((p) => p.ready) ?? false;
    const participantCount = nightStatus?.participants.length ?? 0;

    const handleCastVote = useCallback(async () => {
        if (!nightId) return;

        if (!isParticipant) {
            try {
                await joinMutation.mutateAsync({ table_night_id: nightId });
            } catch (e: any) {
                Alert.alert('Error', e.message ?? 'Could not join');
                return;
            }
        }

        try {
            await rateMutation.mutateAsync({
                table_night_id: nightId,
                rating: Math.round(starRating * 2) / 2,
                photo_url: photoPublicUrl ?? undefined,
                vibe_rating: categories.vibe || undefined,
                flavor_rating: categories.flavor || undefined,
                service_rating: categories.service || undefined,
                value_rating: categories.value || undefined,
            });
        } catch (e: any) {
            Alert.alert('Error', e.message ?? 'Could not submit rating');
            return;
        }

        try {
            await readyMutation.mutateAsync({ table_night_id: nightId });
        } catch (e: any) {
            Alert.alert('Error', e.message ?? 'Could not lock in');
        }
    }, [nightId, isParticipant, starRating, categories, joinMutation, rateMutation, readyMutation]);

    const handleReveal = useCallback(async () => {
        if (!nightId) return;
        try {
            await revealMutation.mutateAsync({ table_night_id: nightId });
        } catch (e: any) {
            Alert.alert('Error', e.message ?? 'Could not reveal');
        }
    }, [nightId, revealMutation]);

    // Loading
    if (isLoading || !nightStatus) {
        return (
            <>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={[styles.center, { backgroundColor: palette.background }]}>
                    <ActivityIndicator color={palette.primary} />
                </View>
            </>
        );
    }

    const isSubmitting =
        joinMutation.isPending || rateMutation.isPending || readyMutation.isPending;

    let ctaLabel = 'Cast Vote';
    let ctaAction = handleCastVote;
    let ctaDisabled = false;

    if (isRevealed) {
        ctaLabel = 'View Full Breakdown';
        ctaAction = async () => {
            router.replace({ pathname: '/table-night-detail', params: { nightId } });
        };
    } else if (isReady) {
        if (isHost && allReady && participantCount >= 2) {
            ctaLabel = 'Reveal Scores';
            ctaAction = handleReveal;
        } else {
            ctaLabel = 'Waiting for others…';
            ctaDisabled = true;
        }
    }

    const restaurantName = nightStatus.restaurants?.name ?? 'Round';

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <View style={{ flex: 1, backgroundColor: palette.background }}>
                <ScrollView
                    contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Hero */}
                    <View style={styles.hero}>
                        <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.surfaceContainer }]} />
                        <View style={styles.heroOverlay} />
                        <View
                            style={[styles.heroContent, { paddingTop: insets.top + Spacing.md }]}
                        >
                            <Pressable onPress={() => router.back()} style={styles.closeBtn}>
                                <Text style={{ color: '#fff', fontSize: 28, lineHeight: 28 }}>×</Text>
                            </Pressable>
                            <View style={styles.heroBottom}>
                                <View
                                    style={[
                                        styles.liveBadge,
                                        {
                                            backgroundColor: isRevealed
                                                ? palette.secondaryContainer
                                                : palette.tertiaryFixed,
                                        },
                                    ]}
                                >
                                    {!isRevealed && (
                                        <PulseDot color={palette.tertiary} size={8} />
                                    )}
                                    <Text
                                        style={{
                                            fontSize: 10,
                                            fontFamily: 'Manrope_700Bold',
                                            letterSpacing: 1.5,
                                            textTransform: 'uppercase',
                                            color: isRevealed ? palette.secondary : palette.tertiary,
                                        }}
                                    >
                                        {isRevealed ? 'Revealed' : 'Voting Live'}
                                    </Text>
                                </View>
                                <Text
                                    style={[
                                        Type.displayLarge,
                                        {
                                            color: '#fff',
                                            fontFamily: 'Newsreader_400Regular_Italic',
                                            fontSize: 48,
                                            lineHeight: 52,
                                        },
                                    ]}
                                >
                                    {restaurantName}
                                </Text>
                            </View>
                        </View>
                    </View>

                    {/* Voting Slip — only if not revealed and not yet ready */}
                    {!isRevealed && !isReady && (
                        <View style={{ paddingHorizontal: Spacing.lg, marginTop: -40 }}>
                            <View
                                style={[
                                    styles.votingCard,
                                    { backgroundColor: palette.surfaceContainerLow },
                                    Shadow.ambient,
                                ]}
                            >
                                <View style={styles.votingHeader}>
                                    <Text
                                        style={[
                                            Type.headlineLarge,
                                            {
                                                color: palette.text,
                                                fontFamily: 'Newsreader_400Regular_Italic',
                                                fontSize: 22,
                                            },
                                        ]}
                                    >
                                        Your Impression
                                    </Text>
                                    <Text
                                        style={[Type.bodySmall, { color: palette.textSecondary, marginTop: 2 }]}
                                    >
                                        How did the evening feel to you?
                                    </Text>
                                </View>

                                {/* ★ Independent Overall Star Rating */}
                                <View
                                    style={[
                                        styles.overallRating,
                                        { backgroundColor: palette.tertiaryFixed },
                                    ]}
                                >
                                    <Text
                                        style={[
                                            Type.labelSmall,
                                            { color: palette.tertiary, opacity: 0.7, marginBottom: 4 },
                                        ]}
                                    >
                                        Overall Rating
                                    </Text>
                                    <Text
                                        style={[
                                            Type.ratingLarge,
                                            { color: palette.tertiary, fontSize: 48, lineHeight: 52 },
                                        ]}
                                    >
                                        {starRating.toFixed(1)}
                                    </Text>
                                    <Slider
                                        style={{ width: '90%', height: 36, marginTop: 4 }}
                                        minimumValue={0.5}
                                        maximumValue={5}
                                        step={0.5}
                                        value={starRating}
                                        onValueChange={updateStar}
                                        minimumTrackTintColor={palette.tertiary}
                                        maximumTrackTintColor={palette.tertiaryFixed}
                                        thumbTintColor={palette.tertiary}
                                    />
                                </View>

                                <View
                                    style={[styles.divider, { backgroundColor: palette.outlineVariant + '30' }]}
                                />

                                {/* Category breakdown label */}
                                <Text
                                    style={[
                                        Type.label,
                                        { color: palette.textMuted, marginBottom: Spacing.md },
                                    ]}
                                >
                                    Breakdown
                                </Text>

                                {CATEGORIES.map(({ key, label }) => (
                                    <View key={key} style={styles.sliderSection}>
                                        <View style={styles.sliderHeader}>
                                            <Text style={[Type.label, { color: palette.textSecondary }]}>
                                                {label}
                                            </Text>
                                            <Text
                                                style={[
                                                    Type.headlineMedium,
                                                    {
                                                        color: palette.primary,
                                                        fontFamily: 'Newsreader_400Regular_Italic',
                                                        fontSize: 18,
                                                    },
                                                ]}
                                            >
                                                {getDescriptor(key, categories[key])}
                                            </Text>
                                        </View>
                                        <Slider
                                            style={{ width: '100%', height: 36 }}
                                            minimumValue={0.5}
                                            maximumValue={5}
                                            step={0.5}
                                            value={categories[key]}
                                            onValueChange={(v) => updateCategory(key, v)}
                                            minimumTrackTintColor={palette.primary}
                                            maximumTrackTintColor={palette.surfaceContainerHigh}
                                            thumbTintColor={palette.primary}
                                        />
                                    </View>
                                ))}

                                {/* ── Photo Section ──────────────────────── */}
                                <View
                                    style={[styles.divider, { backgroundColor: palette.outlineVariant + '30' }]}
                                />
                                <Text
                                    style={[
                                        Type.label,
                                        { color: palette.textMuted, marginBottom: Spacing.sm },
                                    ]}
                                >
                                    Photo (optional)
                                </Text>

                                {!photoUri ? (
                                    <Pressable
                                        onPress={handlePhotoPress}
                                        style={[
                                            styles.photoPlaceholder,
                                            { borderColor: palette.outlineVariant },
                                        ]}
                                    >
                                        <Text style={{ fontSize: 28, marginBottom: 4 }}>📷</Text>
                                        <Text style={[Type.bodySmall, { color: palette.textSecondary }]}>
                                            Add a photo
                                        </Text>
                                    </Pressable>
                                ) : (
                                    <View style={styles.photoPreviewContainer}>
                                        <Image
                                            source={{ uri: photoUri }}
                                            style={styles.photoPreview}
                                            contentFit="cover"
                                        />
                                        {photoUploading && (
                                            <View style={styles.photoOverlay}>
                                                <ActivityIndicator color="#fff" />
                                            </View>
                                        )}
                                        {photoError && (
                                            <View style={styles.photoOverlay}>
                                                <Text style={{ color: '#fff', fontSize: 14 }}>Upload failed</Text>
                                                <Pressable onPress={() => uploadPhoto(photoUri)}>
                                                    <Text style={{ color: '#fff', fontSize: 13, marginTop: 4, textDecorationLine: 'underline' }}>
                                                        Retry
                                                    </Text>
                                                </Pressable>
                                            </View>
                                        )}
                                        <Pressable
                                            onPress={dismissPhoto}
                                            style={styles.photoDismiss}
                                        >
                                            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>×</Text>
                                        </Pressable>
                                    </View>
                                )}
                            </View>
                        </View>
                    )}

                    {/* Locked-in message */}
                    {!isRevealed && isReady && (
                        <View style={{ paddingHorizontal: Spacing.lg, marginTop: -40 }}>
                            <View
                                style={[
                                    styles.votingCard,
                                    { backgroundColor: palette.surfaceContainerLow, alignItems: 'center' },
                                    Shadow.ambient,
                                ]}
                            >
                                <Text style={[Type.headlineMedium, { color: palette.text, textAlign: 'center' }]}>
                                    Vote locked in ✓
                                </Text>
                                <Text
                                    style={[
                                        Type.bodySmall,
                                        { color: palette.textSecondary, textAlign: 'center', marginTop: Spacing.sm },
                                    ]}
                                >
                                    Waiting for everyone to finish…
                                </Text>
                            </View>
                        </View>
                    )}

                    {/* The Table's Verdict */}
                    <View style={{ paddingHorizontal: Spacing.lg, marginTop: Spacing.xxl }}>
                        <View style={styles.verdictHeader}>
                            <Text
                                style={[
                                    Type.headlineLarge,
                                    {
                                        color: palette.text,
                                        fontFamily: 'Newsreader_400Regular_Italic',
                                        fontSize: 22,
                                    },
                                ]}
                            >
                                The Table&apos;s Verdict
                            </Text>
                            <View
                                style={[styles.verdictLine, { backgroundColor: palette.outlineVariant + '40' }]}
                            />
                        </View>

                        <View style={styles.voterList}>
                            {nightStatus.participants.map((p) => (
                                <VoterCard
                                    key={p.user_id}
                                    participant={p}
                                    isRevealed={isRevealed}
                                    palette={palette}
                                />
                            ))}
                        </View>
                    </View>
                </ScrollView>

                {/* Fixed bottom CTA */}
                <View style={[styles.ctaContainer, { paddingBottom: insets.bottom + Spacing.md }]}>
                    <Pressable
                        disabled={ctaDisabled || isSubmitting}
                        onPress={ctaAction}
                        style={({ pressed }) => [
                            styles.ctaButton,
                            {
                                backgroundColor: ctaDisabled ? palette.surfaceContainerHigh : palette.primary,
                                opacity: pressed ? 0.9 : isSubmitting ? 0.6 : 1,
                            },
                        ]}
                    >
                        {isSubmitting ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <Text
                                style={[
                                    Type.label,
                                    { color: ctaDisabled ? palette.textMuted : '#fff', letterSpacing: 2 },
                                ]}
                            >
                                {ctaLabel}
                            </Text>
                        )}
                    </Pressable>
                    {!isRevealed && !isReady && (
                        <Text
                            style={[
                                Type.labelSmall,
                                { color: palette.textSecondary, textAlign: 'center', marginTop: Spacing.sm },
                            ]}
                        >
                            {participantCount} at the table
                        </Text>
                    )}
                </View>
            </View>
        </>
    );
}

// ── Voter Card ─────────────────────────────────────────────────────────────

function VoterCard({
    participant,
    isRevealed,
    palette,
}: {
    participant: TableNightParticipant;
    isRevealed: boolean;
    palette: Palette;
}) {
    const name = participant.profiles.display_name;
    const initials = name.split(' ').map((n) => n[0]).join('').slice(0, 2);
    const hasVoted = participant.ready;

    const hasCategoryRatings =
        isRevealed &&
        (participant.vibe_rating != null ||
            participant.flavor_rating != null ||
            participant.service_rating != null ||
            participant.value_rating != null);

    return (
        <View
            style={[
                styles.voterCard,
                { backgroundColor: palette.card, opacity: hasVoted ? 1 : 0.5 },
                Shadow.subtle,
            ]}
        >
            {/* Avatar + score badge */}
            <View style={{ position: 'relative' }}>
                <View
                    style={[
                        styles.voterAvatar,
                        {
                            backgroundColor: hasVoted ? palette.secondaryContainer : palette.surfaceContainerHigh,
                            borderColor: hasVoted ? palette.primary : palette.surfaceContainerHigh,
                        },
                    ]}
                >
                    {hasVoted ? (
                        <Text style={{ fontSize: 14, fontFamily: 'Manrope_700Bold', color: palette.text }}>
                            {initials}
                        </Text>
                    ) : (
                        <Text style={{ fontSize: 16, color: palette.textMuted }}>⏳</Text>
                    )}
                </View>
                {isRevealed && participant.rating != null && (
                    <View style={[styles.scoreBadge, { backgroundColor: palette.tertiary }]}>
                        <Text style={{ fontSize: 7, color: '#fff', fontWeight: '700' }}>
                            {participant.rating.toFixed(1)}
                        </Text>
                    </View>
                )}
            </View>

            {/* Info + category mini-bars */}
            <View style={{ flex: 1 }}>
                <Text style={[Type.titleSmall, { color: palette.text }]}>{name}</Text>
                {participant.notes ? (
                    <Text
                        style={[
                            Type.bodySmall,
                            { color: palette.textSecondary, fontStyle: 'italic', marginTop: 2 },
                        ]}
                    >
                        &ldquo;{participant.notes}&rdquo;
                    </Text>
                ) : (
                    <Text style={[Type.bodySmall, { color: palette.textMuted, marginTop: 2 }]}>
                        {hasVoted ? 'Locked in' : 'Thinking…'}
                    </Text>
                )}

                {/* Mini category breakdown */}
                {hasCategoryRatings && (
                    <View style={styles.miniBreakdown}>
                        {[
                            { label: 'V', val: participant.vibe_rating },
                            { label: 'F', val: participant.flavor_rating },
                            { label: 'S', val: participant.service_rating },
                            { label: '$', val: participant.value_rating },
                        ].map(
                            ({ label, val }) =>
                                val != null && (
                                    <View key={label} style={[styles.miniChip, { backgroundColor: palette.surfaceContainerHigh }]}>
                                        <Text style={[Type.labelSmall, { color: palette.textMuted, fontSize: 8 }]}>{label}</Text>
                                        <Text style={{ fontSize: 10, fontFamily: 'Newsreader_400Regular_Italic', color: palette.tertiary }}>
                                            {val.toFixed(1)}
                                        </Text>
                                    </View>
                                )
                        )}
                    </View>
                )}
            </View>
        </View>
    );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    hero: { width: SCREEN_WIDTH, height: HERO_HEIGHT, position: 'relative' },
    heroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
    heroContent: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.xxl + 20,
    },
    closeBtn: {
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: 'rgba(0,0,0,0.3)',
        alignItems: 'center', justifyContent: 'center',
    },
    heroBottom: { gap: 6 },
    liveBadge: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: Spacing.md,
        paddingVertical: 4,
        borderRadius: Radius.sm,
        marginBottom: Spacing.sm,
    },

    votingCard: { borderRadius: Radius.lg, padding: Spacing.xl, overflow: 'hidden' },
    votingHeader: { marginBottom: Spacing.md },
    overallRating: {
        alignItems: 'center', justifyContent: 'center',
        paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg,
        borderRadius: Radius.lg, marginBottom: Spacing.lg,
    },
    divider: { height: 1, marginBottom: Spacing.lg },
    sliderSection: { marginBottom: Spacing.xl },
    sliderHeader: {
        flexDirection: 'row', justifyContent: 'space-between',
        alignItems: 'flex-end', marginBottom: Spacing.sm,
    },

    verdictHeader: {
        flexDirection: 'row', alignItems: 'center',
        marginBottom: Spacing.lg, gap: Spacing.md,
    },
    verdictLine: { flex: 1, height: 1 },
    voterList: { gap: Spacing.md },
    voterCard: {
        flexDirection: 'row', alignItems: 'flex-start',
        gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg,
    },
    voterAvatar: {
        width: 48, height: 48, borderRadius: 24,
        borderWidth: 2, alignItems: 'center', justifyContent: 'center',
    },
    scoreBadge: {
        position: 'absolute', bottom: -2, right: -2,
        width: 20, height: 20, borderRadius: 10,
        alignItems: 'center', justifyContent: 'center',
        borderWidth: 2, borderColor: '#fff',
    },

    miniBreakdown: {
        flexDirection: 'row', gap: 4, marginTop: 6,
    },
    miniChip: {
        flexDirection: 'row', alignItems: 'center', gap: 2,
        paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4,
    },

    ctaContainer: {
        position: 'absolute', bottom: 0, left: 0, right: 0,
        paddingHorizontal: Spacing.lg, paddingTop: Spacing.md,
    },
    ctaButton: {
        height: 56, borderRadius: 9999,
        alignItems: 'center', justifyContent: 'center',
    },
    photoPlaceholder: {
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderRadius: Radius.lg,
        paddingVertical: Spacing.lg,
        alignItems: 'center',
        justifyContent: 'center',
    },
    photoPreviewContainer: {
        position: 'relative',
        borderRadius: Radius.lg,
        overflow: 'hidden',
    },
    photoPreview: {
        width: '100%',
        height: 180,
        borderRadius: Radius.lg,
    },
    photoOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.5)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    photoDismiss: {
        position: 'absolute',
        top: 8,
        right: 8,
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: 'rgba(0,0,0,0.6)',
        alignItems: 'center',
        justifyContent: 'center',
    },
});
