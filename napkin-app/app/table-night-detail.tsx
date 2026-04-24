/**
 * Round Detail — canvas WF6 aesthetic.
 *
 * Layout (top → bottom):
 *   1. Simple top bar: ← back | "Round · <date>" | ⋯
 *   2. Hero photo (radius 10, margin 22, ~180tall) with:
 *        bottom-left:  italic serif restaurant name + city·cuisine sub
 *        bottom-right: cream rating chip "4.8" + "ROUND AVG"
 *   3. Previously here banner (quiet memory of prior visits)
 *   4. Breakdown — compact 4-cell chip row (category averages)
 *   5. On the Table — menu-card module (revealed only)
 *   6. "{N} voices" — alternating-surface voice cards per participant
 *   7. Photos — shared photo grid (revealed only)
 *   8. Replies
 *
 * Bonus info (breakdown, on-the-table, photos, replies, category chips,
 * per-voice photo strip) is layered *inside* the wireframe aesthetic rather
 * than bolted onto a separate scorecard.
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
import * as Haptics from 'expo-haptics';

import { Colors, Spacing, Radius, Type } from '@/constants/theme';
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
import { InlineStars } from '@/components/feed/InlineStars';
import { usePostInteractions, usePostInteractionsRealtime } from '@/hooks/posts';
import { CommentThread } from '@/components/posts';
import { FeedActionRow } from '@/components/feed';

type Palette = typeof Colors.light;

const CATEGORY_LABELS = [
    { key: 'vibe_rating' as const, label: 'Vibe' },
    { key: 'flavor_rating' as const, label: 'Flavor' },
    { key: 'service_rating' as const, label: 'Service' },
    { key: 'value_rating' as const, label: 'Value' },
];

function voicesLabel(n: number): string {
    const names = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'];
    const word = names[n] ?? String(n);
    return `${word} voices`;
}

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
    const { data: entries } = await supabase
        .from('entries')
        .select('id, user_id')
        .eq('table_night_id', nightId);

    if (!entries || entries.length === 0) return {};

    const entryIds = entries.map((e: { id: string }) => e.id);

    const { data: photos } = await supabase
        .from('entry_photos')
        .select('entry_id, photo_url, sort_order')
        .in('entry_id', entryIds)
        .order('sort_order', { ascending: true });

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
        queryKey: queryKeys.tableNight.nightPhotos(nightId ?? ''),
        queryFn: () => fetchNightEntryPhotos(nightId!),
        enabled: !!nightId,
        staleTime: 1000 * 60 * 5,
    });
}

// ── Shared photo pool ──────────────────────────────────────────────────────

async function fetchNightPhotoPool(nightId: string): Promise<PoolPhoto[]> {
    const { data: entries } = await supabase
        .from('entries')
        .select('id, user_id, profiles(display_name)')
        .eq('table_night_id', nightId);

    if (!entries || entries.length === 0) return [];

    const entryIds = entries.map((e: { id: string }) => e.id);

    const { data: photos } = await supabase
        .from('entry_photos')
        .select('id, entry_id, photo_url, sort_order')
        .in('entry_id', entryIds)
        .order('sort_order', { ascending: true });

    if (!photos || photos.length === 0) return [];

    type EntryRow = {
        id: string;
        user_id: string;
        profiles:
            | { display_name: string }[]
            | { display_name: string }
            | null;
    };
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

async function fetchMyEntryId(nightId: string, userId: string): Promise<string | null> {
    const { data } = await supabase
        .from('entries')
        .select('id')
        .eq('table_night_id', nightId)
        .eq('user_id', userId)
        .maybeSingle();
    return data?.id ?? null;
}

function useMyEntryId(
    nightId: string | null | undefined,
    userId: string | null | undefined,
    enabled: boolean
) {
    return useQuery({
        queryKey: queryKeys.tableNight.myEntryId(nightId ?? '', userId ?? ''),
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

    const { data: interactions } = usePostInteractions(
        isRevealedOrClosed ? 'table_night' : null,
        isRevealedOrClosed ? nightId : null,
        'table',
    );
    usePostInteractionsRealtime({
        targetType: isRevealedOrClosed ? 'table_night' : null,
        targetId: isRevealedOrClosed ? nightId : null,
        scope: 'table',
    });
    const { data: participantPhotoUrls } = useNightEntryPhotos(
        isRevealedOrClosed ? nightId : null
    );
    const { data: poolPhotos } = useNightPhotoPool(
        isRevealedOrClosed ? nightId : null
    );
    const { data: myEntryId = null } = useMyEntryId(nightId, user?.id, isRevealedOrClosed);

    const { data: restaurantHistory } = useTableRestaurantHistory(
        nightStatus?.restaurant_id ?? null,
        nightStatus?.table_id ?? null,
        nightStatus?.id,
    );
    const previousGroupAvg = restaurantHistory?.last_visit?.rating ?? null;

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

    const overallRatings = nightStatus.participants
        .filter((p) => p.rating != null)
        .map((p) => p.rating as number);
    const overallAvg =
        overallRatings.length > 0
            ? overallRatings.reduce((a, b) => a + b, 0) / overallRatings.length
            : null;

    const categoryAvgs = CATEGORY_LABELS.map(({ key, label }) => {
        const vals = nightStatus.participants
            .filter((p) => p[key] != null)
            .map((p) => p[key] as number);
        return {
            label,
            avg: vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
        };
    });

    // Canvas WF6 date format: "Sat 29 Mar"
    const dateShort = new Date(
        nightStatus.revealed_at ?? nightStatus.created_at
    ).toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
    });

    const heroPhotoUrl = nightStatus.restaurants?.photo_url ?? null;
    const restaurantName = nightStatus.restaurants?.name ?? 'Round';
    const citySub = [
        nightStatus.restaurants?.city,
        (nightStatus.restaurants as { cuisine?: string | null } | null)?.cuisine,
    ]
        .filter(Boolean)
        .join(' \u00B7 ');

    const isRevealed = nightStatus.status === 'revealed' || nightStatus.status === 'closed';

    const voicedParticipants = nightStatus.participants;
    const voiceCount = voicedParticipants.length;

    const goToRestaurant = nightStatus.restaurant_id
        ? () =>
              router.push({
                  pathname: '/restaurant/[id]',
                  params: {
                      id: nightStatus.restaurant_id!,
                      tableId: nightStatus.table_id,
                  },
              })
        : undefined;

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <View style={{ flex: 1, backgroundColor: palette.background }}>
                <ScrollView
                    contentContainerStyle={{
                        paddingTop: insets.top + 6,
                        paddingBottom: insets.bottom + 40,
                    }}
                    showsVerticalScrollIndicator={false}
                >
                    {/* ── Top bar: ← | Round · date | ⋯ ── */}
                    <View style={styles.topBar}>
                        <Pressable onPress={() => router.back()} hitSlop={8}>
                            <Text style={[styles.topBarChevron, { color: palette.textMuted }]}>
                                ‹
                            </Text>
                        </Pressable>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.topBarKicker, { color: palette.textMuted }]}>
                                Round {'\u00B7'} {dateShort}
                            </Text>
                        </View>
                        <Text style={[styles.topBarMore, { color: palette.textMuted }]}>
                            ⋯
                        </Text>
                    </View>

                    {/* ── Hero photo w/ rating chip (WF6) ── */}
                    <Pressable onPress={goToRestaurant} disabled={!goToRestaurant}>
                        <View style={styles.hero}>
                            {heroPhotoUrl ? (
                                <Image
                                    source={{ uri: heroPhotoUrl }}
                                    style={StyleSheet.absoluteFillObject}
                                    resizeMode="cover"
                                />
                            ) : (
                                <View
                                    style={[
                                        StyleSheet.absoluteFillObject,
                                        { backgroundColor: palette.surfaceContainerHigh },
                                    ]}
                                />
                            )}
                            {/* Subtle darkening scrim at bottom so text reads */}
                            {heroPhotoUrl && <View style={styles.heroScrim} />}

                            <View style={styles.heroOverlay}>
                                <View style={{ flex: 1, minWidth: 0 }}>
                                    <Text
                                        style={[
                                            styles.heroName,
                                            { color: heroPhotoUrl ? palette.cream : palette.text },
                                        ]}
                                        numberOfLines={2}
                                    >
                                        {restaurantName}
                                    </Text>
                                    {!!citySub && (
                                        <Text
                                            style={[
                                                styles.heroSub,
                                                {
                                                    color: heroPhotoUrl
                                                        ? 'rgba(246,236,217,0.85)'
                                                        : palette.textMuted,
                                                },
                                            ]}
                                            numberOfLines={1}
                                        >
                                            {citySub}
                                        </Text>
                                    )}
                                </View>

                                {overallAvg != null && (
                                    <View style={styles.heroPill}>
                                        <Text
                                            style={[styles.heroPillValue, { color: palette.tertiary }]}
                                        >
                                            {overallAvg.toFixed(1)}
                                        </Text>
                                        <Text
                                            style={[styles.heroPillLabel, { color: palette.textMuted }]}
                                        >
                                            ROUND AVG
                                        </Text>
                                    </View>
                                )}
                            </View>
                        </View>
                    </Pressable>

                    {/* Delta vs last table visit (subtle, directly under hero) */}
                    {overallAvg != null && previousGroupAvg != null && (
                        <View style={styles.deltaRow}>
                            <DeltaChip current={overallAvg} previous={previousGroupAvg} />
                        </View>
                    )}

                    {/* Previously here — table-scoped memory, excludes this round */}
                    {restaurantHistory && restaurantHistory.visit_count > 0 && (
                        <PreviouslyHereBanner
                            voice="table"
                            visitCount={restaurantHistory.visit_count}
                            lastRating={restaurantHistory.last_visit?.rating ?? null}
                            lastDate={restaurantHistory.last_visit?.date ?? null}
                            onPress={goToRestaurant}
                        />
                    )}

                    {/* Breakdown — compact 4-cell chip row */}
                    {categoryAvgs.some((c) => c.avg != null) && (
                        <View style={styles.section}>
                            <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>
                                Breakdown
                            </Text>
                            <View style={styles.breakdownRow}>
                                {categoryAvgs.map(({ label, avg }) => (
                                    <View
                                        key={label}
                                        style={[
                                            styles.breakdownCell,
                                            { backgroundColor: palette.surfaceJournalLow },
                                        ]}
                                    >
                                        <Text
                                            style={[
                                                styles.breakdownValue,
                                                { color: palette.tertiary },
                                            ]}
                                        >
                                            {avg != null ? avg.toFixed(1) : '–'}
                                        </Text>
                                        <Text
                                            style={[
                                                styles.breakdownLabel,
                                                { color: palette.textMuted },
                                            ]}
                                        >
                                            {label}
                                        </Text>
                                    </View>
                                ))}
                            </View>
                        </View>
                    )}

                    {/* On the Table — revealed/closed only */}
                    {isRevealedOrClosed && (
                        <View style={styles.section}>
                            <OnTheTableList
                                participants={nightStatus.participants}
                                nightId={nightId!}
                                palette={palette}
                            />
                        </View>
                    )}

                    {/* Voices — WF6 style cards */}
                    <View style={styles.section}>
                        <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>
                            {voicesLabel(voiceCount)}
                        </Text>
                        <View style={{ gap: 14 }}>
                            {voicedParticipants.map((p, i) => (
                                <VoiceCard
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

                    {/* Action row + Replies — revealed only */}
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
                            <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>
                                Replies
                            </Text>
                            <CommentThread
                                targetType="table_night"
                                targetId={nightId}
                                comments={interactions?.comments ?? []}
                                scope="table"
                                autoFocusComposer={focus === 'reply'}
                            />
                        </View>
                    )}

                    <View style={{ paddingHorizontal: 22, paddingTop: 24 }}>
                        <Text
                            style={[
                                styles.footer,
                                { color: palette.textMuted },
                            ]}
                        >
                            {voiceCount} at the table
                        </Text>
                    </View>
                </ScrollView>

                {lightboxPhoto && (
                    <PhotoLightbox photo={lightboxPhoto} onClose={() => setLightboxPhoto(null)} />
                )}
            </View>
        </>
    );
}

// ── VoiceCard (WF6) ────────────────────────────────────────────────────────

function VoiceCard({
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
    // Alternating surface — WF6: even rows on note, odd rows on journal-low
    const cardBg = rowIndex % 2 === 0 ? palette.surfaceNote : palette.surfaceJournalLow;
    const router = useRouter();
    const name = participant.profiles.display_name;
    const initials = name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

    const handleProfilePress = () => {
        if (canTapProfile) {
            router.push({
                pathname: '/u/[identifier]',
                params: { identifier: participant.user_id },
            });
        }
    };

    // Waiting state — hasn't submitted yet
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
                    voiceStyles.card,
                    { backgroundColor: cardBg, borderColor: palette.divider, opacity: 0.55 },
                ]}
            >
                <View style={voiceStyles.topRow}>
                    <View
                        style={[
                            voiceStyles.avatar,
                            { backgroundColor: palette.surfaceContainerHigh },
                        ]}
                    >
                        <Text style={[voiceStyles.initials, { color: palette.textMuted }]}>
                            {initials}
                        </Text>
                    </View>
                    <Text
                        style={[
                            voiceStyles.name,
                            { color: palette.textMuted, flex: 1 },
                        ]}
                    >
                        {name}
                    </Text>
                    <Text
                        style={[
                            voiceStyles.waiting,
                            { color: palette.textMuted },
                        ]}
                    >
                        hasn&apos;t submitted
                    </Text>
                </View>
            </View>
        );
    }

    const cardContent = (
        <>
            {/* Top row: avatar · name · stars · rating */}
            <View style={voiceStyles.topRow}>
                <Pressable
                    onPress={canTapProfile ? handleProfilePress : undefined}
                    hitSlop={canTapProfile ? 8 : 0}
                    disabled={!canTapProfile}
                    style={[
                        voiceStyles.avatar,
                        { backgroundColor: palette.secondaryContainer },
                    ]}
                >
                    <Text style={[voiceStyles.initials, { color: palette.text }]}>
                        {initials}
                    </Text>
                </Pressable>
                <Pressable
                    onPress={canTapProfile ? handleProfilePress : undefined}
                    hitSlop={4}
                    disabled={!canTapProfile}
                    style={{ flex: 1, minWidth: 0 }}
                >
                    <Text
                        style={[voiceStyles.name, { color: palette.text }]}
                        numberOfLines={1}
                    >
                        {name}
                    </Text>
                </Pressable>
                {participant.rating != null && (
                    <>
                        <InlineStars value={participant.rating} size={11} color={palette.star} />
                        <Text
                            style={[
                                voiceStyles.rating,
                                { color: palette.textSecondary },
                            ]}
                        >
                            {participant.rating.toFixed(1)}
                        </Text>
                    </>
                )}
            </View>

            {/* Italic pull-quote, indented past avatar */}
            {participant.notes ? (
                <Text
                    style={[voiceStyles.quote, { color: palette.text }]}
                    numberOfLines={4}
                >
                    &ldquo;{participant.notes}&rdquo;
                </Text>
            ) : null}

            {/* Category chips (inline, optional) */}
            {hasCategoryRatings && (
                <View style={voiceStyles.chipRow}>
                    {CATEGORY_LABELS.map(({ key, label }) => {
                        const val = participant[key];
                        if (val == null) return null;
                        return (
                            <View
                                key={key}
                                style={[
                                    voiceStyles.chip,
                                    { backgroundColor: palette.surfaceJournalHi },
                                ]}
                            >
                                <Text
                                    style={[voiceStyles.chipLabel, { color: palette.textMuted }]}
                                >
                                    {label}
                                </Text>
                                <Text
                                    style={[voiceStyles.chipValue, { color: palette.tertiary }]}
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
                <View style={voiceStyles.photoStrip}>
                    {photoUrls.slice(0, 4).map((url, i) => (
                        <Image
                            key={i}
                            source={{ uri: url }}
                            style={voiceStyles.photoThumb}
                            resizeMode="cover"
                        />
                    ))}
                    {photoUrls.length > 4 && (
                        <View
                            style={[
                                voiceStyles.photoThumb,
                                voiceStyles.photoOverflow,
                                { backgroundColor: palette.surfaceContainerHigh },
                            ]}
                        >
                            <Text style={[Type.caption, { color: palette.textSecondary }]}>
                                +{photoUrls.length - 4}
                            </Text>
                        </View>
                    )}
                </View>
            )}
        </>
    );

    if (!canTapProfile) {
        return (
            <View style={[voiceStyles.card, { backgroundColor: cardBg, borderColor: palette.divider }]}>
                {cardContent}
            </View>
        );
    }

    return (
        <Pressable
            onPressIn={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
            onPress={() =>
                router.push({
                    pathname: '/entry-detail',
                    params: { nightId, userId: participant.user_id },
                })
            }
            style={({ pressed }) => [
                voiceStyles.card,
                { backgroundColor: cardBg, borderColor: palette.divider, opacity: pressed ? 0.85 : 1 },
            ]}
        >
            {cardContent}
        </Pressable>
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

    const gap = Spacing.xs;
    const padding = 22;
    const thumbSize = Math.floor((screenWidth - padding * 2 - gap * 2) / 3);

    const uploadPhoto = useCallback(
        async (uri: string) => {
            if (!userId || !myEntryId) return;
            setIsUploading(true);
            try {
                const publicUrl = await compressAndUpload(uri, userId);

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

                await Promise.all([
                    queryClient.invalidateQueries({
                        queryKey: queryKeys.tableNight.photoPool(nightId),
                    }),
                    queryClient.invalidateQueries({
                        queryKey: queryKeys.tableNight.nightPhotos(nightId),
                    }),
                ]);
            } catch {
                Alert.alert('Upload failed', 'Could not upload photo. Please try again.');
            } finally {
                setIsUploading(false);
            }
        },
        [userId, myEntryId, nightId, queryClient]
    );

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
                Alert.alert(
                    'Camera Unavailable',
                    'Camera is not available on this device. Try choosing from your photo library instead.'
                );
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

    const showAddButton = isRevealed && myEntryId !== null;
    if (photos.length === 0 && !showAddButton) return null;

    return (
        <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>
                Photos{photos.length > 0 ? ` \u00B7 ${photos.length}` : ''}
            </Text>

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
                                        style={{
                                            width: thumbSize,
                                            height: thumbSize,
                                            borderRadius: Radius.sm,
                                        }}
                                        contentFit="cover"
                                    />
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
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    return (
        <Modal visible transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.lightboxBackdrop}>
                <ExpoImage
                    source={{ uri: photo.photo_url }}
                    style={styles.lightboxImage}
                    contentFit="contain"
                />
                <View style={styles.lightboxFooter}>
                    <Text style={[Type.bodySmall, { color: palette.textInverse, fontStyle: 'italic' }]}>
                        Photo by {photo.display_name}
                    </Text>
                </View>
                <Pressable onPress={onClose} style={styles.lightboxClose} hitSlop={12}>
                    <Ionicons name="close" size={24} color={palette.textInverse} />
                </Pressable>
            </View>
        </Modal>
    );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

    // Top bar — WF6
    topBar: {
        paddingHorizontal: 22,
        paddingTop: 6,
        paddingBottom: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    topBarChevron: {
        fontSize: 24,
        lineHeight: 24,
        fontFamily: 'Manrope_400Regular',
    },
    topBarKicker: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
    },
    topBarMore: {
        fontSize: 16,
        lineHeight: 16,
    },

    // Hero — WF6: margin 22, height 180, radius 10
    hero: {
        marginHorizontal: 22,
        marginBottom: 16,
        height: 180,
        borderRadius: Radius.md - 2, // 10
        overflow: 'hidden',
        backgroundColor: Colors.light.primary,
        position: 'relative',
    },
    heroScrim: {
        position: 'absolute',
        left: 0, right: 0, bottom: 0,
        height: 110,
        backgroundColor: 'rgba(0,0,0,0.35)',
    },
    heroOverlay: {
        position: 'absolute',
        left: 14,
        right: 14,
        bottom: 12,
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 10,
    },
    heroName: {
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 26,
        lineHeight: 29,
        letterSpacing: -0.3,
        textShadowColor: 'rgba(0,0,0,0.4)',
        textShadowRadius: 8,
    },
    heroSub: {
        fontSize: 10,
        letterSpacing: 0.4,
        marginTop: 3,
        fontFamily: 'Manrope_500Medium',
    },
    heroPill: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: 'rgba(252,249,244,0.92)',
        alignItems: 'center',
        flexDirection: 'row',
        gap: 6,
    },
    heroPillValue: {
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 18,
        lineHeight: 18,
    },
    heroPillLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
    },

    // Delta under hero
    deltaRow: {
        paddingHorizontal: 22,
        paddingBottom: 12,
        flexDirection: 'row',
    },

    // Section shell
    section: {
        paddingHorizontal: 22,
        paddingTop: 14,
    },
    sectionLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
        marginBottom: 10,
    },

    // Breakdown
    breakdownRow: {
        flexDirection: 'row',
        gap: 8,
    },
    breakdownCell: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 10,
        borderRadius: Radius.md - 2,
    },
    breakdownValue: {
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 20,
        lineHeight: 22,
    },
    breakdownLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        marginTop: 2,
    },

    // Photos grid
    photoGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: Spacing.xs,
    },
    gridThumbScrim: {
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
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
        color: Colors.light.textInverse,
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

    // Footer
    footer: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 12,
        textAlign: 'center',
    },

    // Lightbox
    lightboxBackdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.92)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    lightboxImage: { width: '100%', flex: 1 },
    lightboxFooter: {
        position: 'absolute',
        bottom: 40,
        left: 0, right: 0,
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

// ── Voice styles ──────────────────────────────────────────────────────────

const voiceStyles = StyleSheet.create({
    card: {
        padding: 14,
        borderRadius: Radius.md - 2,
        borderWidth: 1,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    avatar: {
        width: 26,
        height: 26,
        borderRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    initials: {
        fontSize: 11,
        fontFamily: 'Manrope_700Bold',
    },
    name: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
    },
    rating: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 12,
    },
    waiting: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 11,
    },
    quote: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
        lineHeight: 19,
        marginTop: 8,
        paddingLeft: 36, // past 26-avatar + 10-gap
    },
    chipRow: {
        flexDirection: 'row',
        gap: 6,
        marginTop: 10,
        paddingLeft: 36,
        flexWrap: 'wrap',
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 3,
    },
    chipLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 0.4,
        textTransform: 'uppercase',
    },
    chipValue: {
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 11,
    },
    photoStrip: {
        flexDirection: 'row',
        gap: Spacing.xs,
        marginTop: 10,
        paddingLeft: 36,
    },
    photoThumb: {
        width: 44,
        height: 44,
        borderRadius: Radius.sm,
    },
    photoOverflow: {
        alignItems: 'center',
        justifyContent: 'center',
    },
});
