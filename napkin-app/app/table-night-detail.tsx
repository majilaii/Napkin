/**
 * Table Night Detail — full breakdown of a revealed/closed Table Night.
 * Shows per-person overall + category scores (vibe/flavor/service/value).
 * Also shows a shared photo grid aggregated from all participants' entries.
 */
import React, { useState, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Pressable,
    ActivityIndicator,
    Image,
    Modal,
    Alert,
    ActionSheetIOS,
    Platform,
    useWindowDimensions,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

import { Colors, Spacing, Radius, Shadow, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { compressAndUpload } from '@/lib/imageUpload';
import {
    useTableNightStatus,
    type TableNightParticipant,
} from '@/hooks/tables/useTableNight';
import { useTableRestaurantHistory } from '@/hooks/restaurants/useRestaurantHistory';
import { PreviouslyHereBanner, DeltaChip } from '@/components/restaurants';
import { OnTheTableList } from '@/components/table-night';
import { usePostInteractions, usePostInteractionsRealtime } from '@/hooks/posts';
import { CommentThread } from '@/components/posts';
import { FeedActionRow } from '@/components/feed';

type Palette = typeof Colors.light;

const CATEGORY_LABELS = [
    { key: 'vibe_rating' as const, label: 'Vibe', short: 'V' },
    { key: 'flavor_rating' as const, label: 'Flavor', short: 'F' },
    { key: 'service_rating' as const, label: 'Service', short: 'S' },
    { key: 'value_rating' as const, label: 'Value', short: '$' },
];

// ── Pool photo type ────────────────────────────────────────────────────────

export interface PoolPhoto {
    id: string;
    photo_url: string;
    user_id: string;
    entry_id: string;
    display_name: string;
}

// ── Entry photos per participant ───────────────────────────────────────────

async function fetchNightEntryPhotos(nightId: string): Promise<Record<string, string[]>> {
    // Fetch all entries for this night
    const { data: entries } = await supabase
        .from('entries')
        .select('id, user_id')
        .eq('table_night_id', nightId);

    if (!entries || entries.length === 0) return {};

    const entryIds = entries.map((e: { id: string }) => e.id);

    // Fetch all photos for these entries
    const { data: photos } = await supabase
        .from('entry_photos')
        .select('entry_id, photo_url, sort_order')
        .in('entry_id', entryIds)
        .order('sort_order', { ascending: true });

    // Build a map: user_id -> [photo_url, ...]
    const entryToUser = new Map(
        entries.map((e: { id: string; user_id: string }) => [e.id, e.user_id])
    );
    const userPhotos: Record<string, string[]> = {};
    for (const photo of (photos ?? []) as { entry_id: string; photo_url: string }[]) {
        const userId = entryToUser.get(photo.entry_id);
        if (!userId) continue;
        if (!userPhotos[userId]) userPhotos[userId] = [];
        userPhotos[userId].push(photo.photo_url);
    }
    return userPhotos;
}

function useNightEntryPhotos(nightId: string | null | undefined) {
    return useQuery({
        queryKey: ['night-entry-photos', nightId],
        queryFn: () => fetchNightEntryPhotos(nightId!),
        enabled: !!nightId,
        staleTime: 1000 * 60 * 5,
    });
}

// ── Shared photo pool ──────────────────────────────────────────────────────

async function fetchNightPhotoPool(nightId: string): Promise<PoolPhoto[]> {
    // Fetch all entries for this night (with profile display_name)
    const { data: entries } = await supabase
        .from('entries')
        .select('id, user_id, profiles(display_name)')
        .eq('table_night_id', nightId);

    if (!entries || entries.length === 0) return [];

    const entryIds = entries.map((e: { id: string }) => e.id);

    // Fetch all photos for these entries ordered by sort_order then created_at
    const { data: photos } = await supabase
        .from('entry_photos')
        .select('id, entry_id, photo_url, sort_order')
        .in('entry_id', entryIds)
        .order('sort_order', { ascending: true });

    if (!photos || photos.length === 0) return [];

    // Build lookup: entry_id -> { user_id, display_name }
    // Supabase returns profiles as an array even for single FK joins
    type EntryRow = { id: string; user_id: string; profiles: { display_name: string }[] | { display_name: string } | null };
    const entryMeta = new Map(
        (entries as EntryRow[]).map((e) => {
            const profilesData = e.profiles;
            let displayName = 'Unknown';
            if (Array.isArray(profilesData)) {
                displayName = profilesData[0]?.display_name ?? 'Unknown';
            } else if (profilesData) {
                displayName = profilesData.display_name;
            }
            return [e.id, { user_id: e.user_id, display_name: displayName }];
        })
    );

    return (photos as { id: string; entry_id: string; photo_url: string }[])
        .map((photo) => {
            const meta = entryMeta.get(photo.entry_id);
            if (!meta) return null;
            return {
                id: photo.id,
                photo_url: photo.photo_url,
                user_id: meta.user_id,
                entry_id: photo.entry_id,
                display_name: meta.display_name,
            };
        })
        .filter((p): p is PoolPhoto => p !== null);
}

function useNightPhotoPool(nightId: string | null | undefined) {
    return useQuery({
        queryKey: queryKeys.tableNight.photoPool(nightId ?? ''),
        queryFn: () => fetchNightPhotoPool(nightId!),
        enabled: !!nightId,
        staleTime: 1000 * 60 * 5,
    });
}

/** Fetch the current user's entry_id for a given night (null if no entry). */
async function fetchMyEntryId(nightId: string, userId: string): Promise<string | null> {
    const { data } = await supabase
        .from('entries')
        .select('id')
        .eq('table_night_id', nightId)
        .eq('user_id', userId)
        .maybeSingle();
    return data?.id ?? null;
}

function useMyEntryId(nightId: string | null | undefined, userId: string | null | undefined, enabled: boolean) {
    return useQuery({
        queryKey: ['myEntryId', nightId, userId],
        queryFn: () => fetchMyEntryId(nightId!, userId!),
        enabled: enabled && !!nightId && !!userId,
        staleTime: 1000 * 60 * 10,
    });
}

// ── Screen ─────────────────────────────────────────────────────────────────

export default function TableNightDetailScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();
    const queryClient = useQueryClient();
    const { width: screenWidth } = useWindowDimensions();

    const { nightId, focus } = useLocalSearchParams<{ nightId: string; focus?: string }>();
    const { data: nightStatus, isLoading } = useTableNightStatus(nightId);
    const isRevealedOrClosed =
        nightStatus?.status === 'revealed' || nightStatus?.status === 'closed';

    // Post interactions — only fetch + subscribe after reveal
    const { data: interactions } = usePostInteractions(
        isRevealedOrClosed ? 'table_night' : null,
        isRevealedOrClosed ? nightId : null,
    );
    usePostInteractionsRealtime({
        targetType: isRevealedOrClosed ? 'table_night' : null,
        targetId: isRevealedOrClosed ? nightId : null,
    });
    const { data: participantPhotoUrls } = useNightEntryPhotos(
        isRevealedOrClosed ? nightId : null
    );
    const { data: poolPhotos } = useNightPhotoPool(
        isRevealedOrClosed ? nightId : null
    );
    const { data: myEntryId = null } = useMyEntryId(nightId, user?.id, isRevealedOrClosed);

    // Restaurant history (excluding this round). Powers the "Previously here"
    // banner + delta chip. Only meaningful once nightStatus has loaded.
    const { data: restaurantHistory } = useTableRestaurantHistory(
        nightStatus?.restaurant_id ?? null,
        nightStatus?.table_id ?? null,
        nightStatus?.id,
    );
    const previousGroupAvg = restaurantHistory?.last_visit?.rating ?? null;

    // Lightbox state
    const [lightboxPhoto, setLightboxPhoto] = useState<PoolPhoto | null>(null);

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

    // Overall average from star ratings
    const overallRatings = nightStatus.participants
        .filter((p) => p.rating != null)
        .map((p) => p.rating as number);
    const overallAvg =
        overallRatings.length > 0
            ? overallRatings.reduce((a, b) => a + b, 0) / overallRatings.length
            : null;

    // Category averages
    const categoryAvgs = CATEGORY_LABELS.map(({ key, label }) => {
        const vals = nightStatus.participants
            .filter((p) => p[key] != null)
            .map((p) => p[key] as number);
        return {
            label,
            avg: vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
        };
    });

    const date = new Date(
        nightStatus.revealed_at ?? nightStatus.created_at
    ).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

    const heroPhotoUrl = nightStatus.restaurants?.photo_url ?? null;

    // Post-round photo upload state
    const isRevealed = nightStatus.status === 'revealed' || nightStatus.status === 'closed';

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <View style={{ flex: 1, backgroundColor: palette.background }}>
                <ScrollView
                    contentContainerStyle={{
                        paddingBottom: insets.bottom + 40,
                        paddingTop: heroPhotoUrl ? 0 : insets.top + Spacing.md,
                    }}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Hero image with canvas-style overlay */}
                    {heroPhotoUrl ? (
                        <View>
                            <Image
                                source={{ uri: heroPhotoUrl }}
                                style={{ width: '100%', aspectRatio: 16 / 9 }}
                                resizeMode="cover"
                            />
                            {/* Gradient scrim — top (nav) + bottom (text) */}
                            <View
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    right: 0,
                                    height: insets.top + 56,
                                    backgroundColor: 'rgba(0,0,0,0.35)',
                                }}
                            />
                            <View
                                style={{
                                    position: 'absolute',
                                    bottom: 0,
                                    left: 0,
                                    right: 0,
                                    height: 100,
                                    backgroundColor: 'rgba(0,0,0,0.45)',
                                }}
                            />
                            {/* Back button */}
                            <View
                                style={[
                                    styles.topBar,
                                    { position: 'absolute', top: insets.top, left: 0, right: 0 },
                                ]}
                            >
                                <Pressable onPress={() => router.back()}>
                                    <Text style={[Type.body, { color: '#fff' }]}>← Back</Text>
                                </Pressable>
                            </View>
                            {/* Canvas overlay: restaurant name bottom-left, rating pill bottom-right */}
                            <View style={styles.heroOverlayRow}>
                                <Pressable
                                    onPress={() => {
                                        if (nightStatus.restaurant_id) {
                                            router.push({
                                                pathname: '/restaurant/[id]',
                                                params: {
                                                    id: nightStatus.restaurant_id,
                                                    tableId: nightStatus.table_id,
                                                },
                                            });
                                        }
                                    }}
                                    disabled={!nightStatus.restaurant_id}
                                    style={{ flex: 1 }}
                                >
                                    <Text style={[styles.heroRestaurantName]} numberOfLines={2}>
                                        {nightStatus.restaurants?.name ?? 'Round'}
                                    </Text>
                                </Pressable>
                                {overallAvg != null && (
                                    <View
                                        style={[
                                            styles.heroRatingChip,
                                            { backgroundColor: palette.tertiaryFixed },
                                        ]}
                                    >
                                        <Text
                                            style={[
                                                styles.heroRatingValue,
                                                { color: palette.tertiary },
                                            ]}
                                        >
                                            {overallAvg.toFixed(1)}
                                        </Text>
                                        <Text
                                            style={[
                                                styles.heroRatingLabel,
                                                { color: palette.tertiary },
                                            ]}
                                        >
                                            AVG
                                        </Text>
                                    </View>
                                )}
                            </View>
                        </View>
                    ) : (
                        <View style={styles.topBar}>
                            <Pressable onPress={() => router.back()}>
                                <Text style={[Type.body, { color: palette.primary }]}>← Back</Text>
                            </Pressable>
                        </View>
                    )}

                    {/* Header — only shown when there is no hero photo */}
                    {!heroPhotoUrl && (
                        <View style={styles.headerSection}>
                            <Text style={[Type.labelSmall, { color: palette.textMuted, letterSpacing: 1.5 }]}>
                                Round · {date}
                            </Text>
                            <Pressable
                                onPress={() => {
                                    if (nightStatus.restaurant_id) {
                                        router.push({
                                            pathname: '/restaurant/[id]',
                                            params: {
                                                id: nightStatus.restaurant_id,
                                                tableId: nightStatus.table_id,
                                            },
                                        });
                                    }
                                }}
                                disabled={!nightStatus.restaurant_id}
                            >
                                <Text
                                    style={[
                                        Type.displayLarge,
                                        {
                                            color: palette.text,
                                            fontFamily: 'Newsreader_400Regular_Italic',
                                            fontSize: 38,
                                            lineHeight: 42,
                                            marginTop: Spacing.xs,
                                        },
                                    ]}
                                >
                                    {nightStatus.restaurants?.name ?? 'Round'}
                                </Text>
                            </Pressable>
                        </View>
                    )}

                    {/* Date sub-label when hero photo is present */}
                    {heroPhotoUrl && (
                        <View style={[styles.headerSection, { marginTop: Spacing.sm }]}>
                            <Text style={[Type.labelSmall, { color: palette.textMuted, letterSpacing: 1.5 }]}>
                                Round · {date}
                            </Text>
                        </View>
                    )}

                    {/* Previously here — table-scoped memory, excludes this round */}
                    {restaurantHistory && restaurantHistory.visit_count > 0 && (
                        <PreviouslyHereBanner
                            voice="table"
                            visitCount={restaurantHistory.visit_count}
                            lastRating={restaurantHistory.last_visit?.rating ?? null}
                            lastDate={restaurantHistory.last_visit?.date ?? null}
                            onPress={
                                nightStatus.restaurant_id
                                    ? () =>
                                          router.push({
                                              pathname: '/restaurant/[id]',
                                              params: {
                                                  id: nightStatus.restaurant_id!,
                                                  tableId: nightStatus.table_id,
                                              },
                                          })
                                    : undefined
                            }
                        />
                    )}

                    {/* Overall Rating + Summary Sentence */}
                    {overallAvg != null && (
                        <View style={{ alignItems: 'center', marginTop: Spacing.lg }}>
                            <View
                                style={[
                                    styles.overallBubble,
                                    { backgroundColor: palette.tertiaryFixed },
                                    Shadow.ambient,
                                ]}
                            >
                                <Text
                                    style={[
                                        Type.ratingLarge,
                                        { color: palette.tertiary, fontSize: 36, lineHeight: 40 },
                                    ]}
                                >
                                    {overallAvg.toFixed(1)}
                                </Text>
                                <Text style={[Type.labelSmall, { color: palette.tertiary, opacity: 0.7 }]}>
                                    Final Average
                                </Text>
                            </View>
                            <DeltaChip current={overallAvg} previous={previousGroupAvg} />
                            <SummarySentence overallAvg={overallAvg} categoryAvgs={categoryAvgs} palette={palette} />
                        </View>
                    )}

                    {/* Category Breakdown — table-wide averages */}
                    {categoryAvgs.some((c) => c.avg != null) && (
                        <View style={styles.section}>
                            <SectionLabel palette={palette}>Breakdown</SectionLabel>
                            <View style={styles.breakdownGrid}>
                                {categoryAvgs.map(
                                    ({ label, avg }) =>
                                        avg != null && (
                                            <View
                                                key={label}
                                                style={[
                                                    styles.breakdownCell,
                                                    { backgroundColor: palette.surfaceContainerLow },
                                                ]}
                                            >
                                                <Text
                                                    style={[Type.rating, { color: palette.tertiary, fontSize: 22 }]}
                                                >
                                                    {avg.toFixed(1)}
                                                </Text>
                                                <Text
                                                    style={[Type.labelSmall, { color: palette.textMuted, marginTop: 4 }]}
                                                >
                                                    {label}
                                                </Text>
                                            </View>
                                        )
                                )}
                            </View>
                        </View>
                    )}

                    {/* On the Table — menu-card module (revealed/closed only) */}
                    {isRevealedOrClosed && (
                        <View style={styles.section}>
                            <OnTheTableList
                                participants={nightStatus.participants}
                                nightId={nightId!}
                                palette={palette}
                            />
                        </View>
                    )}

                    {/* Who Said What — per-person scores with category breakdown */}
                    <View style={styles.section}>
                        <SectionLabel palette={palette}>Who Said What</SectionLabel>
                        <View style={{ gap: Spacing.md }}>
                            {nightStatus.participants.map((p, i) => (
                                <ParticipantRow
                                    key={p.user_id}
                                    participant={p}
                                    nightId={nightId!}
                                    tableId={nightStatus.table_id}
                                    canTapProfile={isRevealedOrClosed}
                                    palette={palette}
                                    photoUrls={participantPhotoUrls?.[p.user_id] ?? []}
                                    rowIndex={i}
                                />
                            ))}
                        </View>
                    </View>

                    {/* Shared Photo Grid */}
                    <SharedPhotoGrid
                        nightId={nightId!}
                        photos={poolPhotos ?? []}
                        isRevealed={isRevealed}
                        myEntryId={myEntryId}
                        userId={user?.id ?? null}
                        palette={palette}
                        screenWidth={screenWidth}
                        onPhotoPress={setLightboxPhoto}
                        queryClient={queryClient}
                    />

                    {/* Action row + Replies — only when revealed */}
                    {isRevealedOrClosed && nightId && (
                        <View style={styles.section}>
                            <FeedActionRow
                                targetType="table_night"
                                targetId={nightId}
                                topEmojis={interactions?.counts.top_emojis ?? []}
                                reactionCount={interactions?.counts.reactions ?? 0}
                                commentCount={interactions?.counts.comments ?? 0}
                                myReactions={
                                    user
                                        ? (interactions?.reactions ?? [])
                                              .filter((r) => r.user_id === user.id)
                                              .map((r) => r.emoji)
                                        : []
                                }
                                palette={palette}
                                detailPathname="/table-night-detail"
                                detailParams={{ nightId }}
                                tableId={nightStatus?.table_id ?? undefined}
                            />
                            <View style={{ height: Spacing.lg }} />
                            <SectionLabel palette={palette}>Replies</SectionLabel>
                            <CommentThread
                                targetType="table_night"
                                targetId={nightId}
                                comments={interactions?.comments ?? []}
                                autoFocusComposer={focus === 'reply'}
                            />
                        </View>
                    )}

                    {/* Footer */}
                    <View style={styles.section}>
                        <Text
                            style={[
                                Type.bodySmall,
                                { color: palette.textMuted, textAlign: 'center', fontStyle: 'italic' },
                            ]}
                        >
                            {nightStatus.participants.length} people at the table
                        </Text>
                    </View>
                </ScrollView>

                {/* Photo Lightbox */}
                {lightboxPhoto && (
                    <PhotoLightbox
                        photo={lightboxPhoto}
                        onClose={() => setLightboxPhoto(null)}
                    />
                )}
            </View>
        </>
    );
}

// ── SharedPhotoGrid ────────────────────────────────────────────────────────

function SharedPhotoGrid({
    nightId,
    photos,
    isRevealed,
    myEntryId,
    userId,
    palette,
    screenWidth,
    onPhotoPress,
    queryClient,
}: {
    nightId: string;
    photos: PoolPhoto[];
    isRevealed: boolean;
    myEntryId: string | null;
    userId: string | null;
    palette: Palette;
    screenWidth: number;
    onPhotoPress: (photo: PoolPhoto) => void;
    queryClient: ReturnType<typeof useQueryClient>;
}) {
    const [isUploading, setIsUploading] = useState(false);

    // 3-column grid with Spacing.xs gap
    const gap = Spacing.xs;
    const padding = Spacing.lg;
    const thumbSize = Math.floor((screenWidth - padding * 2 - gap * 2) / 3);

    const uploadPhoto = useCallback(async (uri: string) => {
        if (!userId || !myEntryId) return;
        setIsUploading(true);
        try {
            const publicUrl = await compressAndUpload(uri, userId);

            // Determine next sort_order from existing photos for this entry
            const { data: maxRow } = await supabase
                .from('entry_photos')
                .select('sort_order')
                .eq('entry_id', myEntryId)
                .order('sort_order', { ascending: false })
                .limit(1)
                .single();
            const sortOrder = (maxRow?.sort_order ?? 0) + 1;

            const { error } = await supabase
                .from('entry_photos')
                .insert({
                    entry_id: myEntryId,
                    photo_url: publicUrl,
                    sort_order: sortOrder,
                });

            if (error) {
                Alert.alert('Upload failed', error.message);
                return;
            }

            // Invalidate both the pool and the per-participant photo queries
            await Promise.all([
                queryClient.invalidateQueries({
                    queryKey: queryKeys.tableNight.photoPool(nightId),
                }),
                queryClient.invalidateQueries({
                    queryKey: ['night-entry-photos', nightId],
                }),
            ]);
        } catch {
            Alert.alert('Upload failed', 'Could not upload photo. Please try again.');
        } finally {
            setIsUploading(false);
        }
    }, [userId, myEntryId, nightId, queryClient]);

    const handleAddPhoto = useCallback(() => {
        if (!userId || !myEntryId) return;

        const pickFromCamera = async () => {
            const perm = await ImagePicker.requestCameraPermissionsAsync();
            if (!perm.granted) {
                Alert.alert('Permission needed', 'Camera access is required to take a photo.');
                return;
            }
            let result;
            try {
                result = await ImagePicker.launchCameraAsync({
                    mediaTypes: ['images'],
                    quality: 1,
                });
            } catch {
                Alert.alert('Camera Unavailable', 'Camera is not available on this device. Try choosing from your photo library instead.');
                return;
            }
            if (!result.canceled && result.assets[0]) {
                await uploadPhoto(result.assets[0].uri);
            }
        };

        const pickFromLibrary = async () => {
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                quality: 1,
            });
            if (!result.canceled && result.assets[0]) {
                await uploadPhoto(result.assets[0].uri);
            }
        };

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
            Alert.alert('Add a Photo', undefined, [
                { text: 'Take Photo', onPress: pickFromCamera },
                { text: 'Choose from Library', onPress: pickFromLibrary },
                { text: 'Cancel', style: 'cancel' },
            ]);
        }
    }, [userId, myEntryId, uploadPhoto]);

    // Hide section entirely if no photos and no upload button to show
    const showAddButton = isRevealed && myEntryId !== null;
    if (photos.length === 0 && !showAddButton) return null;

    return (
        <View style={styles.section}>
            <SectionLabelWithCount palette={palette} count={photos.length}>
                Photos
            </SectionLabelWithCount>

            {photos.length > 0 && (
                <View style={styles.photoGrid}>
                    {photos.map((photo) => {
                        const initials = photo.display_name
                            .split(' ')
                            .map((n) => n[0])
                            .join('')
                            .slice(0, 2)
                            .toUpperCase();

                        return (
                            <Pressable
                                key={photo.id}
                                onPress={() => onPhotoPress(photo)}
                                style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
                            >
                                <View style={{ width: thumbSize, height: thumbSize }}>
                                    <ExpoImage
                                        source={{ uri: photo.photo_url }}
                                        style={{ width: thumbSize, height: thumbSize, borderRadius: Radius.sm }}
                                        contentFit="cover"
                                    />
                                    {/* Dark scrim + initials avatar overlay */}
                                    <View style={styles.gridThumbScrim} />
                                    <View style={styles.gridThumbAvatar}>
                                        <Text style={styles.gridThumbInitials}>{initials}</Text>
                                    </View>
                                </View>
                            </Pressable>
                        );
                    })}
                </View>
            )}

            {/* "Add Photos" button — only when revealed and user has an entry */}
            {showAddButton && (
                <Pressable
                    onPress={handleAddPhoto}
                    disabled={isUploading}
                    style={({ pressed }) => [
                        styles.addPhotosButton,
                        {
                            backgroundColor: palette.surfaceContainerLow,
                            borderColor: palette.outlineVariant,
                            opacity: pressed || isUploading ? 0.7 : 1,
                            marginTop: photos.length > 0 ? Spacing.sm : 0,
                        },
                    ]}
                >
                    {isUploading ? (
                        <ActivityIndicator size="small" color={palette.textMuted} />
                    ) : (
                        <Ionicons name="camera-outline" size={16} color={palette.textSecondary} />
                    )}
                    <Text style={[Type.bodySmall, { color: palette.textSecondary, marginLeft: Spacing.xs }]}>
                        {isUploading ? 'Uploading…' : 'Add Photos'}
                    </Text>
                </Pressable>
            )}
        </View>
    );
}

// ── PhotoLightbox ──────────────────────────────────────────────────────────

function PhotoLightbox({
    photo,
    onClose,
}: {
    photo: PoolPhoto;
    onClose: () => void;
}) {
    return (
        <Modal
            visible
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <View style={styles.lightboxBackdrop}>
                <ExpoImage
                    source={{ uri: photo.photo_url }}
                    style={styles.lightboxImage}
                    contentFit="contain"
                />

                {/* Photographer name */}
                <View style={styles.lightboxFooter}>
                    <Text style={[Type.bodySmall, { color: '#fff', fontStyle: 'italic' }]}>
                        Photo by {photo.display_name}
                    </Text>
                </View>

                {/* Close button */}
                <Pressable
                    onPress={onClose}
                    style={styles.lightboxClose}
                    hitSlop={12}
                >
                    <Ionicons name="close" size={24} color="#fff" />
                </Pressable>
            </View>
        </Modal>
    );
}

// ── Components ─────────────────────────────────────────────────────────────

function SectionLabel({ palette, children }: { palette: Palette; children: string }) {
    return (
        <Text style={[Type.label, { color: palette.textSecondary, marginBottom: Spacing.md }]}>
            {children}
        </Text>
    );
}

function SectionLabelWithCount({
    palette,
    children,
    count,
}: {
    palette: Palette;
    children: string;
    count: number;
}) {
    return (
        <Text style={[Type.label, { color: palette.textSecondary, marginBottom: Spacing.md }]}>
            {children}
            {count > 0 && (
                <Text style={[Type.label, { color: palette.textMuted }]}>
                    {' '}({count})
                </Text>
            )}
        </Text>
    );
}

function SummarySentence({
    overallAvg,
    categoryAvgs,
    palette,
}: {
    overallAvg: number;
    categoryAvgs: { label: string; avg: number | null }[];
    palette: Palette;
}) {
    const withData = categoryAvgs.filter((c) => c.avg != null) as { label: string; avg: number }[];
    if (withData.length === 0) return null;

    const highest = withData.reduce((best, c) => (c.avg > best.avg ? c : best), withData[0]);

    // Check if all categories are within 0.1 of each other (consensus)
    const allTied = withData.every((c) => Math.abs(c.avg - highest.avg) <= 0.1);

    const sentence = allTied
        ? `The table gave this a ${overallAvg.toFixed(1)} across the board.`
        : `The table gave this a ${overallAvg.toFixed(1)}. ${highest.label} was the standout at ${highest.avg.toFixed(1)}.`;

    return (
        <Text
            style={[
                Type.bodySmall,
                {
                    color: palette.textMuted,
                    fontStyle: 'italic',
                    textAlign: 'center',
                    marginTop: Spacing.sm,
                    paddingHorizontal: Spacing.xl,
                },
            ]}
        >
            {sentence}
        </Text>
    );
}

function ParticipantRow({
    participant,
    nightId,
    tableId,
    canTapProfile,
    palette,
    photoUrls,
    rowIndex = 0,
}: {
    participant: TableNightParticipant;
    nightId: string;
    tableId: string;
    canTapProfile: boolean;
    palette: Palette;
    photoUrls: string[];
    rowIndex?: number;
}) {
    // Canvas WF6: alternating surfaces — even rows on card, odd rows on lower surface.
    const cardBg = rowIndex % 2 === 0 ? palette.card : palette.surfaceContainerLow;
    const router = useRouter();
    const name = participant.profiles.display_name;
    const initials = name.split(' ').map((n) => n[0]).join('').slice(0, 2);

    const handleProfilePress = () => {
        if (canTapProfile && tableId) {
            router.push({
                pathname: '/member/[userId]',
                params: { userId: participant.user_id, tableId },
            });
        }
    };

    // Waiting state: participant hasn't submitted yet
    const isWaiting = participant.rating === null && !participant.ready;

    const hasCategoryRatings =
        participant.vibe_rating != null ||
        participant.flavor_rating != null ||
        participant.service_rating != null ||
        participant.value_rating != null;

    if (isWaiting) {
        return (
            <View
                style={[
                    styles.participantCard,
                    { backgroundColor: cardBg, opacity: 0.5 },
                    Shadow.subtle,
                ]}
            >
                <View style={styles.participantTop}>
                    <View
                        style={[styles.participantAvatar, { backgroundColor: palette.surfaceContainerHigh }]}
                    >
                        <Text style={{ fontSize: 12, fontFamily: 'Manrope_700Bold', color: palette.textMuted }}>
                            {initials}
                        </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={[Type.titleSmall, { color: palette.textMuted }]}>{name}</Text>
                        <Text
                            style={[
                                Type.bodySmall,
                                { color: palette.textMuted, fontStyle: 'italic', marginTop: 2 },
                            ]}
                        >
                            hasn&apos;t submitted yet
                        </Text>
                    </View>
                </View>
            </View>
        );
    }

    return (
        <Pressable
            onPress={() =>
                router.push({
                    pathname: '/entry-detail',
                    params: { nightId, userId: participant.user_id },
                })
            }
            style={({ pressed }) => [
                styles.participantCard,
                { backgroundColor: cardBg, opacity: pressed ? 0.8 : 1 },
                Shadow.subtle,
            ]}
        >
            {/* Top row: avatar + name + overall score */}
            <View style={styles.participantTop}>
                <Pressable
                    onPress={canTapProfile ? handleProfilePress : undefined}
                    hitSlop={canTapProfile ? 8 : 0}
                    style={[styles.participantAvatar, { backgroundColor: palette.secondaryContainer }]}
                >
                    <Text style={{ fontSize: 12, fontFamily: 'Manrope_700Bold', color: palette.text }}>
                        {initials}
                    </Text>
                </Pressable>
                <View style={{ flex: 1, gap: Spacing.xs }}>
                    <Pressable onPress={canTapProfile ? handleProfilePress : undefined} hitSlop={4}>
                        <Text style={[Type.titleSmall, { color: palette.text }]}>{name}</Text>
                    </Pressable>
                    {participant.notes ? (
                        <Text
                            style={[
                                styles.voiceQuote,
                                { color: palette.textSecondary },
                            ]}
                            numberOfLines={3}
                        >
                            &ldquo;{participant.notes}&rdquo;
                        </Text>
                    ) : null}
                </View>
                {participant.rating != null && (
                    <Text style={[Type.rating, { color: palette.tertiary, fontSize: 20 }]}>
                        {participant.rating.toFixed(1)}
                    </Text>
                )}
            </View>

            {/* Category breakdown chips */}
            {hasCategoryRatings && (
                <View style={styles.categoryChips}>
                    {CATEGORY_LABELS.map(({ key, label }) => {
                        const val = participant[key];
                        if (val == null) return null;
                        return (
                            <View
                                key={key}
                                style={[styles.categoryChip, { backgroundColor: palette.surfaceContainerLow }]}
                            >
                                <Text style={[Type.labelSmall, { color: palette.textMuted, fontSize: 9 }]}>
                                    {label}
                                </Text>
                                <Text
                                    style={{
                                        fontSize: 13,
                                        fontFamily: 'Newsreader_400Regular_Italic',
                                        color: palette.tertiary,
                                    }}
                                >
                                    {val.toFixed(1)}
                                </Text>
                            </View>
                        );
                    })}
                </View>
            )}

            {/* Photo thumbnail strip */}
            {photoUrls.length > 0 && (
                <View style={styles.photoStrip}>
                    {photoUrls.slice(0, 4).map((url, i) => (
                        <Image
                            key={i}
                            source={{ uri: url }}
                            style={styles.photoStripThumb}
                            resizeMode="cover"
                        />
                    ))}
                    {photoUrls.length > 4 && (
                        <View style={[styles.photoStripThumb, styles.photoStripOverflow, { backgroundColor: palette.surfaceContainerHigh }]}>
                            <Text style={[Type.caption, { color: palette.textSecondary }]}>
                                +{photoUrls.length - 4}
                            </Text>
                        </View>
                    )}
                </View>
            )}
        </Pressable>
    );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    topBar: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
    headerSection: { paddingHorizontal: Spacing.lg },

    // Canvas hero overlay — bottom strip with restaurant name + rating
    heroOverlayRow: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.md,
        gap: Spacing.md,
    },
    heroRestaurantName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 28,
        lineHeight: 34,
        color: '#fff',
    },
    heroRatingChip: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: Radius.lg,
        alignItems: 'center',
        flexShrink: 0,
    },
    heroRatingValue: {
        fontFamily: 'Newsreader_700Bold',
        fontSize: 22,
        lineHeight: 26,
    },
    heroRatingLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 9,
        letterSpacing: 0.8,
        opacity: 0.7,
        marginTop: -2,
    },
    overallBubble: {
        alignItems: 'center',
        paddingHorizontal: Spacing.xl,
        paddingVertical: Spacing.md,
        borderRadius: Radius.xl,
    },
    section: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.xl },

    breakdownGrid: { flexDirection: 'row', gap: Spacing.sm },
    breakdownCell: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: Spacing.md,
        borderRadius: Radius.lg,
    },

    participantCard: {
        padding: Spacing.md,
        borderRadius: Radius.lg,
    },
    // Canvas: italic serif pull-quote for participant voice
    voiceQuote: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
        lineHeight: 20,
    },
    participantTop: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
    },
    participantAvatar: {
        width: 44, height: 44, borderRadius: 22,
        alignItems: 'center', justifyContent: 'center',
    },
    categoryChips: {
        flexDirection: 'row',
        gap: Spacing.sm,
        marginTop: Spacing.sm,
        marginLeft: 44 + Spacing.md, // offset past avatar
    },
    categoryChip: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 6,
        borderRadius: Radius.sm,
        gap: 2,
    },
    photoStrip: {
        flexDirection: 'row',
        gap: Spacing.xs,
        marginTop: Spacing.sm,
        marginLeft: 44 + Spacing.md, // offset past avatar
    },
    photoStripThumb: {
        width: 48,
        height: 48,
        borderRadius: Radius.sm,
    },
    photoStripOverflow: {
        alignItems: 'center',
        justifyContent: 'center',
    },

    // Shared photo grid
    photoGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: Spacing.xs,
    },
    gridThumbScrim: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 28,
        borderBottomLeftRadius: Radius.sm,
        borderBottomRightRadius: Radius.sm,
        backgroundColor: 'rgba(0,0,0,0.3)',
    },
    gridThumbAvatar: {
        position: 'absolute',
        bottom: 4,
        left: 4,
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: 'rgba(0,0,0,0.55)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    gridThumbInitials: {
        fontSize: 7,
        fontFamily: 'Manrope_700Bold',
        color: '#fff',
        letterSpacing: 0.3,
    },
    addPhotosButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: Spacing.sm,
        paddingHorizontal: Spacing.md,
        borderRadius: Radius.lg,
        borderWidth: 1,
        borderStyle: 'dashed',
    },

    // Lightbox
    lightboxBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.92)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    lightboxImage: {
        width: '100%',
        flex: 1,
    },
    lightboxFooter: {
        position: 'absolute',
        bottom: 40,
        left: 0,
        right: 0,
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
    },
    lightboxClose: {
        position: 'absolute',
        top: 52,
        right: Spacing.lg,
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: 'rgba(0,0,0,0.5)',
        alignItems: 'center',
        justifyContent: 'center',
    },
});
