/**
 * Entry Detail — full view of a single entry (solo share or round take).
 * Shows restaurant, overall rating, secondary ratings, notes, dish, date.
 */
import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Pressable,
    ActivityIndicator,
    Image,
    Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Colors, Spacing, Radius, Shadow, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/lib/supabase';
import { StarRating } from '@/components/StarRating';
import { useRoundContext } from '@/hooks/tables/useTableNight';
import { useUserRestaurantHistory } from '@/hooks/restaurants/useRestaurantHistory';
import { PreviouslyHereBanner } from '@/components/restaurants';
import { useAuth } from '@/providers/AuthProvider';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type Palette = typeof Colors.light;

const CATEGORY_LABELS = [
    { key: 'vibe_rating' as const, label: 'Vibe' },
    { key: 'flavor_rating' as const, label: 'Flavor' },
    { key: 'service_rating' as const, label: 'Service' },
    { key: 'value_rating' as const, label: 'Value' },
];

interface EntryDetail {
    id: string;
    user_id: string;
    restaurant_id: string | null;
    rating: number | null;
    content: string | null;
    dish_description: string | null;
    visited_at: string;
    created_at: string;
    table_id: string | null;
    table_night_id: string | null;
    visibility: string;
    vibe_rating: number | null;
    flavor_rating: number | null;
    service_rating: number | null;
    value_rating: number | null;
    photo_url: string | null;
    restaurants: {
        id: string;
        name: string;
        address: string | null;
        city: string | null;
        photo_url: string | null;
    } | null;
    profiles: {
        display_name: string;
    };
}

async function fetchEntry(entryId?: string, nightId?: string, userId?: string): Promise<EntryDetail> {
    let entry: any;

    if (entryId) {
        // Direct entry lookup
        const { data, error } = await supabase
            .from('entries')
            .select(`
                id,
                user_id,
                restaurant_id,
                rating,
                content,
                dish_description,
                visited_at,
                created_at,
                table_id,
                table_night_id,
                visibility,
                vibe_rating,
                flavor_rating,
                service_rating,
                value_rating,
                photo_url,
                restaurants (
                    id,
                    name,
                    address,
                    city,
                    photo_url
                )
            `)
            .eq('id', entryId)
            .single();

        if (error) throw error;
        entry = data;
    } else if (nightId && userId) {
        // Lookup by table_night_id + user_id (for round participants)
        const { data, error } = await supabase
            .from('entries')
            .select(`
                id,
                user_id,
                restaurant_id,
                rating,
                content,
                dish_description,
                visited_at,
                created_at,
                table_id,
                table_night_id,
                visibility,
                vibe_rating,
                flavor_rating,
                service_rating,
                value_rating,
                photo_url,
                restaurants (
                    id,
                    name,
                    address,
                    city,
                    photo_url
                )
            `)
            .eq('table_night_id', nightId)
            .eq('user_id', userId)
            .single();

        if (error) throw error;
        entry = data;
    } else {
        throw new Error('Either entryId or nightId+userId required');
    }

    // Fetch profile
    const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('user_id', entry.user_id)
        .single();

    // PostgREST returns FK-joined restaurants as object (with .single()),
    // but TS may infer it as array. Normalize:
    const restaurant = Array.isArray(entry.restaurants)
        ? entry.restaurants[0] ?? null
        : entry.restaurants ?? null;

    return {
        ...entry,
        restaurants: restaurant,
        profiles: profile ?? { display_name: 'User' },
    } as unknown as EntryDetail;
}

function getRelativeDate(dateString: string): { relative: string; full: string } {
    const date = new Date(dateString);
    const full = date.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

    if (isNaN(date.getTime())) return { relative: full, full };

    const nowMs = Date.now();
    const diffMs = nowMs - date.getTime();
    if (diffMs < 0) return { relative: full, full };
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHrs = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHrs / 24);

    let relative: string;
    if (diffSec < 60) {
        relative = 'Just now';
    } else if (diffMin < 60) {
        relative = `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
    } else if (diffHrs < 24) {
        relative = `${diffHrs} hour${diffHrs === 1 ? '' : 's'} ago`;
    } else if (diffDays === 1) {
        relative = 'Yesterday';
    } else if (diffDays < 7) {
        relative = `${diffDays} days ago`;
    } else if (diffDays < 14) {
        relative = 'Last week';
    } else {
        relative = full;
    }

    return { relative, full };
}

function useEntryDetail(entryId?: string, nightId?: string, userId?: string) {
    return useQuery({
        queryKey: ['entry-detail', entryId ?? `${nightId}-${userId}`],
        queryFn: () => fetchEntry(entryId, nightId, userId),
        enabled: !!entryId || (!!nightId && !!userId),
    });
}

async function fetchEntryPhotos(entryId: string): Promise<string[]> {
    const { data, error } = await supabase
        .from('entry_photos')
        .select('photo_url')
        .eq('entry_id', entryId)
        .order('sort_order', { ascending: true });

    if (error) throw error;
    return (data ?? []).map((row: { photo_url: string }) => row.photo_url);
}

function useEntryPhotos(entryId?: string) {
    return useQuery({
        queryKey: ['entry-photos', entryId],
        queryFn: () => fetchEntryPhotos(entryId!),
        enabled: !!entryId,
        staleTime: 1000 * 60 * 5,
    });
}

// ── Screen ─────────────────────────────────────────────────────────────────

export default function EntryDetailScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();

    const { entryId, nightId, userId } = useLocalSearchParams<{
        entryId?: string;
        nightId?: string;
        userId?: string;
    }>();
    const { data: entry, isLoading, error } = useEntryDetail(entryId, nightId, userId);
    // Round context for banner — enabled only once we know the entry's table_night_id
    const { data: roundContext } = useRoundContext(entry?.table_night_id ?? null);
    // entry_photos for carousel (resolved after entry loads)
    const { data: entryPhotoUrls } = useEntryPhotos(entry?.id);
    // Viewer's personal history at this restaurant (cross-Table, excludes this entry)
    const { user: viewer } = useAuth();
    const { data: userHistory } = useUserRestaurantHistory(
        entry?.restaurant_id ?? null,
        viewer?.id ?? null,
        entry?.id,
    );
    // Photo carousel index
    const [activePhotoIndex, setActivePhotoIndex] = useState(0);

    if (isLoading || !entry) {
        return (
            <>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={[styles.center, { backgroundColor: palette.background }]}>
                    <ActivityIndicator color={palette.primary} />
                </View>
            </>
        );
    }

    if (error) {
        return (
            <>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={[styles.center, { backgroundColor: palette.background }]}>
                    <Text style={[Type.body, { color: palette.error }]}>
                        Couldn&apos;t load this entry.
                    </Text>
                    <Pressable onPress={() => router.back()} style={{ marginTop: Spacing.md }}>
                        <Text style={[Type.body, { color: palette.primary }]}>← Go back</Text>
                    </Pressable>
                </View>
            </>
        );
    }

    const restaurantName = entry.restaurants?.name ?? 'Unknown spot';
    const displayName = entry.profiles?.display_name ?? 'Someone';
    const { relative: relativeDate, full: fullDate } = getRelativeDate(entry.visited_at ?? entry.created_at);

    const hasCategoryRatings =
        entry.vibe_rating != null ||
        entry.flavor_rating != null ||
        entry.service_rating != null ||
        entry.value_rating != null;

    const isRoundEntry = !!entry.table_night_id;

    // Build allPhotos with backward compat fallback:
    // Use entry_photos if available, otherwise fall back to entry.photo_url
    const allPhotos: string[] = entryPhotoUrls && entryPhotoUrls.length > 0
        ? entryPhotoUrls
        : entry.photo_url
            ? [entry.photo_url]
            : [];

    // For non-user photos (restaurants), use restaurant photo if no user photos
    const hasUserPhotos = allPhotos.length > 0;
    const heroDisplayUrl = hasUserPhotos ? allPhotos[0] : entry.restaurants?.photo_url ?? null;
    const hasHeroDisplay = !!heroDisplayUrl;

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <View style={{ flex: 1, backgroundColor: palette.background }}>
                <ScrollView
                    contentContainerStyle={{
                        paddingBottom: insets.bottom + 40,
                        paddingTop: hasHeroDisplay ? 0 : insets.top + Spacing.md,
                    }}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Hero image / carousel */}
                    {hasHeroDisplay ? (
                        <View>
                            {hasUserPhotos && allPhotos.length > 1 ? (
                                // Multi-photo carousel
                                <View>
                                    <ScrollView
                                        horizontal
                                        pagingEnabled
                                        showsHorizontalScrollIndicator={false}
                                        style={{ width: SCREEN_WIDTH }}
                                        onMomentumScrollEnd={(e) => {
                                            const idx = Math.round(
                                                e.nativeEvent.contentOffset.x / SCREEN_WIDTH
                                            );
                                            setActivePhotoIndex(idx);
                                        }}
                                    >
                                        {allPhotos.map((url, i) => (
                                            <Image
                                                key={i}
                                                source={{ uri: url }}
                                                style={{ width: SCREEN_WIDTH, aspectRatio: 16 / 9 }}
                                                resizeMode="cover"
                                            />
                                        ))}
                                    </ScrollView>
                                    {/* Page dots */}
                                    <View style={styles.pageDots}>
                                        {allPhotos.map((_, i) => (
                                            <View
                                                key={i}
                                                style={[
                                                    styles.pageDot,
                                                    {
                                                        backgroundColor: i === activePhotoIndex
                                                            ? palette.tertiary
                                                            : `${palette.textMuted}4D`,
                                                    },
                                                ]}
                                            />
                                        ))}
                                    </View>
                                </View>
                            ) : (
                                // Single hero image
                                <Image
                                    source={{ uri: heroDisplayUrl! }}
                                    style={{ width: '100%', aspectRatio: 16 / 9 }}
                                    resizeMode="cover"
                                />
                            )}
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
                                style={[
                                    styles.topBar,
                                    { position: 'absolute', top: insets.top, left: 0, right: 0 },
                                ]}
                            >
                                <Pressable onPress={() => router.back()}>
                                    <Text style={[Type.body, { color: '#fff' }]}>← Back</Text>
                                </Pressable>
                            </View>
                            {/* "User photo" caption — only shown for user-uploaded single photos */}
                            {hasUserPhotos && allPhotos.length === 1 && (
                                <View style={styles.userPhotoCaptionContainer}>
                                    <Text style={[Type.caption, { color: 'rgba(255,255,255,0.85)' }]}>
                                        User photo
                                    </Text>
                                </View>
                            )}
                        </View>
                    ) : (
                        <View style={styles.topBar}>
                            <Pressable onPress={() => router.back()}>
                                <Text style={[Type.body, { color: palette.primary }]}>← Back</Text>
                            </Pressable>
                        </View>
                    )}

                    {/* Header */}
                    <View style={styles.headerSection}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <Pressable
                                onPress={() => {
                                    if (entry.user_id && entry.table_id) {
                                        router.push({
                                            pathname: '/member/[userId]',
                                            params: { userId: entry.user_id, tableId: entry.table_id },
                                        });
                                    }
                                }}
                                hitSlop={8}
                            >
                                <InitialsAvatar name={displayName} size={36} palette={palette} />
                            </Pressable>
                            <View>
                                <Pressable
                                    onPress={() => {
                                        if (entry.user_id && entry.table_id) {
                                            router.push({
                                                pathname: '/member/[userId]',
                                                params: { userId: entry.user_id, tableId: entry.table_id },
                                            });
                                        }
                                    }}
                                    hitSlop={4}
                                >
                                    <Text style={[Type.titleSmall, { color: palette.text }]}>
                                        {displayName}
                                    </Text>
                                </Pressable>
                                <Text style={[Type.titleSmall, { color: palette.text }]}>
                                    {relativeDate}
                                </Text>
                                <Text style={[Type.labelSmall, { color: palette.textMuted, marginTop: 1 }]}>
                                    {fullDate}
                                    {isRoundEntry ? ' · Round' : ''}
                                </Text>
                                {/* View profile link */}
                                {entry.user_id && entry.table_id && (
                                    <Pressable
                                        onPress={() =>
                                            router.push({
                                                pathname: '/member/[userId]',
                                                params: { userId: entry.user_id, tableId: entry.table_id! },
                                            })
                                        }
                                        hitSlop={4}
                                    >
                                        <Text
                                            style={[
                                                Type.caption,
                                                { color: palette.primary, marginTop: 2 },
                                            ]}
                                        >
                                            View profile
                                        </Text>
                                    </Pressable>
                                )}
                            </View>
                        </View>

                        <Pressable
                            onPress={() => {
                                if (entry.restaurant_id) {
                                    router.push({
                                        pathname: '/restaurant/[id]',
                                        params: {
                                            id: entry.restaurant_id,
                                            ...(entry.table_id ? { tableId: entry.table_id } : {}),
                                        },
                                    });
                                }
                            }}
                            disabled={!entry.restaurant_id}
                        >
                            <Text
                                style={[
                                    Type.displayLarge,
                                    {
                                        color: palette.text,
                                        fontFamily: 'Newsreader_400Regular_Italic',
                                        fontSize: 38,
                                        lineHeight: 44,
                                        marginTop: Spacing.lg,
                                    },
                                ]}
                            >
                                {restaurantName}
                            </Text>

                            {entry.restaurants?.address ? (
                                <Text style={[Type.bodySmall, { color: palette.textMuted, marginTop: 4 }]}>
                                    {entry.restaurants.address}
                                </Text>
                            ) : null}
                        </Pressable>
                    </View>

                    {/* Previously here — viewer's cross-Table personal history */}
                    {userHistory && userHistory.visit_count > 0 && (
                        <PreviouslyHereBanner
                            voice="user"
                            visitCount={userHistory.visit_count}
                            lastRating={userHistory.last_visit?.rating ?? null}
                            lastDate={userHistory.last_visit?.date ?? null}
                            onPress={
                                entry.restaurant_id
                                    ? () =>
                                          router.push({
                                              pathname: '/restaurant/[id]',
                                              params: {
                                                  id: entry.restaurant_id!,
                                                  ...(entry.table_id ? { tableId: entry.table_id } : {}),
                                              },
                                          })
                                    : undefined
                            }
                        />
                    )}

                    {/* Round Context Banner */}
                    {isRoundEntry && roundContext && (
                        <Pressable
                            onPress={() =>
                                router.push({
                                    pathname: '/table-night-detail',
                                    params: { nightId: entry.table_night_id! },
                                })
                            }
                            style={({ pressed }) => [
                                styles.roundBanner,
                                { backgroundColor: palette.primaryMuted, opacity: pressed ? 0.7 : 1 },
                            ]}
                        >
                            <View style={{ flex: 1 }}>
                                <Text style={[Type.titleSmall, { color: palette.primary }]}>
                                    Part of a Round
                                </Text>
                                <Text style={[Type.bodySmall, { color: palette.textMuted, marginTop: 2 }]}>
                                    {roundContext.participantCount} {roundContext.participantCount === 1 ? 'person' : 'people'}
                                    {roundContext.groupAverage != null
                                        ? ` · Group avg ${roundContext.groupAverage.toFixed(1)}`
                                        : ''}
                                </Text>
                            </View>
                            <Text style={[Type.body, { color: palette.primary }]}>›</Text>
                        </Pressable>
                    )}

                    {/* Overall Rating */}
                    {entry.rating != null && (
                        <View style={{ alignItems: 'center', marginTop: Spacing.xl }}>
                            <View
                                style={[
                                    styles.ratingBubble,
                                    { backgroundColor: palette.tertiaryFixed },
                                    Shadow.ambient,
                                ]}
                            >
                                <Text
                                    style={[
                                        Type.ratingLarge ?? Type.rating,
                                        { color: palette.tertiary, fontSize: 36, lineHeight: 40 },
                                    ]}
                                >
                                    {entry.rating.toFixed(1)}
                                </Text>
                                <Text style={[Type.labelSmall, { color: palette.tertiary, opacity: 0.7 }]}>
                                    Overall
                                </Text>
                            </View>
                            <View style={{ marginTop: Spacing.sm }}>
                                <StarRating value={entry.rating} size={24} editable={false} />
                            </View>
                        </View>
                    )}

                    {/* Category Breakdown */}
                    {hasCategoryRatings && (
                        <View style={styles.section}>
                            <Text style={[Type.label, { color: palette.textSecondary, marginBottom: Spacing.md }]}>
                                Breakdown
                            </Text>
                            <View style={styles.breakdownGrid}>
                                {CATEGORY_LABELS.map(({ key, label }) => {
                                    const val = entry[key];
                                    if (val == null) return null;
                                    return (
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
                                                {val.toFixed(1)}
                                            </Text>
                                            <Text
                                                style={[Type.labelSmall, { color: palette.textMuted, marginTop: 4 }]}
                                            >
                                                {label}
                                            </Text>
                                        </View>
                                    );
                                })}
                            </View>
                        </View>
                    )}

                    {/* Dish */}
                    {entry.dish_description ? (
                        <View style={styles.section}>
                            <Text style={[Type.label, { color: palette.textSecondary, marginBottom: Spacing.sm }]}>
                                Dish
                            </Text>
                            <View
                                style={[
                                    styles.dishChip,
                                    { backgroundColor: palette.tertiaryFixed },
                                ]}
                            >
                                <Text style={[Type.body, { color: palette.tertiary }]}>
                                    {entry.dish_description}
                                </Text>
                            </View>
                        </View>
                    ) : null}

                    {/* Notes */}
                    {entry.content ? (
                        <View style={styles.section}>
                            <Text style={[Type.label, { color: palette.textSecondary, marginBottom: Spacing.sm }]}>
                                Notes
                            </Text>
                            <View
                                style={[
                                    styles.quoteCard,
                                    {
                                        backgroundColor: palette.surfaceContainerLow,
                                        borderLeftColor: palette.tertiaryFixed,
                                    },
                                ]}
                            >
                                <Text
                                    style={[
                                        Type.body,
                                        {
                                            color: palette.text,
                                            fontStyle: 'italic',
                                            lineHeight: 24,
                                        },
                                    ]}
                                >
                                    &ldquo;{entry.content}&rdquo;
                                </Text>
                            </View>
                        </View>
                    ) : null}
                </ScrollView>
            </View>
        </>
    );
}

// ── Components ─────────────────────────────────────────────────────────────

function InitialsAvatar({
    name,
    size,
    palette,
}: {
    name: string;
    size: number;
    palette: Palette;
}) {
    const initials = name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();

    const tints = [
        palette.tertiaryFixed,
        palette.secondaryContainer,
        palette.primaryMuted,
    ];
    const tint = tints[(initials.charCodeAt(0) || 0) % tints.length];

    return (
        <View
            style={{
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: tint,
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
            <Text
                style={{
                    fontFamily: 'Manrope_600SemiBold',
                    fontSize: size * 0.36,
                    color: palette.text,
                }}
            >
                {initials}
            </Text>
        </View>
    );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    topBar: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
    headerSection: { paddingHorizontal: Spacing.lg },
    ratingBubble: {
        alignItems: 'center',
        paddingHorizontal: Spacing.xl,
        paddingVertical: Spacing.md,
        borderRadius: Radius.xl,
    },
    section: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.xxl },
    breakdownGrid: { flexDirection: 'row', gap: Spacing.sm },
    breakdownCell: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: Spacing.md,
        borderRadius: Radius.lg,
    },
    dishChip: {
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        borderRadius: Radius.sm,
        alignSelf: 'flex-start',
    },
    roundBanner: {
        marginHorizontal: Spacing.lg,
        marginTop: Spacing.lg,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.md,
        borderRadius: Radius.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    quoteCard: {
        padding: Spacing.md,
        borderRadius: Radius.md,
        borderLeftWidth: 3,
    },
    userPhotoCaptionContainer: {
        position: 'absolute',
        bottom: Spacing.sm,
        right: Spacing.sm,
        backgroundColor: 'rgba(0,0,0,0.35)',
        paddingHorizontal: Spacing.sm,
        paddingVertical: 3,
        borderRadius: Radius.sm,
    },
    pageDots: {
        position: 'absolute',
        bottom: Spacing.sm,
        left: 0,
        right: 0,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    pageDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
});
