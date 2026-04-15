/**
 * Entry Detail — full view of a single entry (solo share or round take).
 * Shows restaurant, overall rating, secondary ratings, notes, dish, date.
 */
import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Pressable,
    ActivityIndicator,
    Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { Colors, Spacing, Radius, Shadow, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { supabase } from '@/lib/supabase';
import { StarRating } from '@/components/StarRating';
import { useRoundContext } from '@/hooks/tables/useTableNight';

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
    table_night_id: string | null;
    visibility: string;
    vibe_rating: number | null;
    flavor_rating: number | null;
    service_rating: number | null;
    value_rating: number | null;
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
                table_night_id,
                visibility,
                vibe_rating,
                flavor_rating,
                service_rating,
                value_rating,
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
                table_night_id,
                visibility,
                vibe_rating,
                flavor_rating,
                service_rating,
                value_rating,
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
    const heroPhotoUrl = entry.restaurants?.photo_url ?? null;

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
                    {/* Hero image with scrim overlay */}
                    {heroPhotoUrl ? (
                        <View>
                            <Image
                                source={{ uri: heroPhotoUrl }}
                                style={{ width: '100%', aspectRatio: 16 / 9 }}
                                resizeMode="cover"
                            />
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
                            <InitialsAvatar name={displayName} size={36} palette={palette} />
                            <View>
                                <Text style={[Type.titleSmall, { color: palette.text }]}>
                                    {displayName}
                                </Text>
                                <Text style={[Type.titleSmall, { color: palette.text }]}>
                                    {relativeDate}
                                </Text>
                                <Text style={[Type.labelSmall, { color: palette.textMuted, marginTop: 1 }]}>
                                    {fullDate}
                                    {isRoundEntry ? ' · Round' : ''}
                                </Text>
                            </View>
                        </View>

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
                    </View>

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
});
