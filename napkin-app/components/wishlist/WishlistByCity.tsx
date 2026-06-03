/**
 * WishlistByCity — personal wishlist grouped by city.
 *
 * Matches the Heirloom Journal "Wishlist · grouped by city" wireframe:
 *   - Top counts strip (`N places · M cities`)
 *   - Per-city section: italic Newsreader heading + count, terracotta "SEE ALL"
 *   - 3-column poster grid (3:4 aspect), warm rule between cities
 *
 * Tap a poster → restaurant page. Long-press → remove sheet.
 * SEE ALL toggles inline expand for that city.
 */
import React, { useMemo, useState } from 'react';
import {
    ScrollView,
    View,
    Text,
    Pressable,
    RefreshControl,
    ActivityIndicator,
    StyleSheet,
    Alert,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import {
    useMyWishlist,
    type PersonalWishlistItem,
} from '@/hooks/wishlist/useMyWishlist';
import { useWishlistRemove } from '@/hooks/wishlist/useWishlistRemove';
import { RemoveConfirmationSheet } from './RemoveConfirmationSheet';
import { WishlistEmpty } from './WishlistEmpty';

const PREVIEW_PER_CITY = 3;
const UNCITIED_LABEL = 'Elsewhere';

interface CityGroup {
    name: string;
    items: PersonalWishlistItem[];
}

function groupByCity(items: PersonalWishlistItem[]): CityGroup[] {
    const map = new Map<string, PersonalWishlistItem[]>();
    for (const item of items) {
        // TICKET-060: skip pending async captures (restaurant not yet resolved)
        if (!item.restaurant) continue;
        const key = item.restaurant.city?.trim() || UNCITIED_LABEL;
        const bucket = map.get(key);
        if (bucket) bucket.push(item);
        else map.set(key, [item]);
    }
    return Array.from(map.entries())
        .map(([name, list]) => ({ name, items: list }))
        .sort((a, b) => {
            if (a.name === UNCITIED_LABEL) return 1;
            if (b.name === UNCITIED_LABEL) return -1;
            return b.items.length - a.items.length;
        });
}

interface PosterProps {
    item: PersonalWishlistItem;
    palette: typeof Colors.light;
    onPress: () => void;
    onLongPress: () => void;
}

function Poster({ item, palette, onPress, onLongPress }: PosterProps) {
    const { restaurant } = item;
    if (!restaurant) return null;  // TICKET-060: skip pending captures
    return (
        <Pressable
            onPress={onPress}
            onLongPress={onLongPress}
            delayLongPress={400}
            style={({ pressed }) => [styles.poster, { opacity: pressed ? 0.92 : 1 }]}
        >
            <View
                style={[
                    styles.posterImageWrap,
                    {
                        backgroundColor: palette.surfaceJournalLow,
                        borderColor: palette.dividerSoft,
                        borderWidth: restaurant.photo_url ? 0 : StyleSheet.hairlineWidth,
                        ...Shadow.clip,
                    },
                ]}
            >
                {restaurant.photo_url ? (
                    <ExpoImage
                        source={{ uri: restaurant.photo_url }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                    />
                ) : null}
            </View>
            <Text
                numberOfLines={1}
                style={[
                    Type.headlineItalic,
                    { fontSize: 13, lineHeight: 16, color: palette.text, marginTop: 6 },
                ]}
            >
                {restaurant.name}
            </Text>
            {restaurant.cuisine ? (
                <Text
                    numberOfLines={1}
                    style={[Type.labelSmall, { color: palette.textMuted, marginTop: 1 }]}
                >
                    {restaurant.cuisine}
                </Text>
            ) : null}
        </Pressable>
    );
}

interface CitySectionProps {
    group: CityGroup;
    isFirst: boolean;
    palette: typeof Colors.light;
    onPosterPress: (item: PersonalWishlistItem) => void;
    onPosterLongPress: (item: PersonalWishlistItem) => void;
}

function CitySection({
    group,
    isFirst,
    palette,
    onPosterPress,
    onPosterLongPress,
}: CitySectionProps) {
    const [expanded, setExpanded] = useState(false);
    const visible = expanded ? group.items : group.items.slice(0, PREVIEW_PER_CITY);
    const hasMore = group.items.length > PREVIEW_PER_CITY;

    return (
        <View
            style={[
                styles.citySection,
                !isFirst && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: palette.dividerSoft,
                },
            ]}
        >
            <View style={styles.cityHeader}>
                <View style={styles.cityHeaderLeft}>
                    <Text
                        style={[
                            Type.headlineMedium,
                            {
                                fontFamily: 'Newsreader_400Regular_Italic',
                                fontSize: 22,
                                color: palette.text,
                            },
                        ]}
                    >
                        {group.name}
                    </Text>
                    <Text
                        style={[
                            Type.caption,
                            { color: palette.textMuted, marginLeft: Spacing.sm },
                        ]}
                    >
                        {group.items.length} {group.items.length === 1 ? 'place' : 'places'}
                    </Text>
                </View>
                {hasMore ? (
                    <Pressable
                        onPress={() => setExpanded((v) => !v)}
                        hitSlop={8}
                    >
                        <Text style={[Type.labelSmall, { color: palette.primary }]}>
                            {expanded ? 'SHOW LESS' : 'SEE ALL'}
                        </Text>
                    </Pressable>
                ) : null}
            </View>
            <View style={styles.posterGrid}>
                {visible.map((item) => (
                    <Poster
                        key={item.id}
                        item={item}
                        palette={palette}
                        onPress={() => onPosterPress(item)}
                        onLongPress={() => onPosterLongPress(item)}
                    />
                ))}
                {/* fill the last row so 1 or 2 cards don't stretch */}
                {visible.length % 3 === 1 ? (
                    <>
                        <View style={styles.poster} />
                        <View style={styles.poster} />
                    </>
                ) : visible.length % 3 === 2 ? (
                    <View style={styles.poster} />
                ) : null}
            </View>
        </View>
    );
}

interface WishlistByCityProps {
    userId: string;
}

export function WishlistByCity({ userId }: WishlistByCityProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const { user } = useAuth();
    const removeMutation = useWishlistRemove(user?.id);

    const [pending, setPending] = useState<PersonalWishlistItem | null>(null);

    const {
        data,
        isLoading,
        isFetchingNextPage,
        hasNextPage,
        fetchNextPage,
        refetch,
        isRefetching,
    } = useMyWishlist(userId);

    const items: PersonalWishlistItem[] = useMemo(
        () => data?.pages.flatMap((p) => p.data) ?? [],
        [data],
    );

    const groups = useMemo(() => groupByCity(items), [items]);
    const cityCount = groups.filter((g) => g.name !== UNCITIED_LABEL).length;

    if (isLoading) {
        return (
            <View style={styles.center}>
                <ActivityIndicator color={palette.primary} />
            </View>
        );
    }

    if (items.length === 0) {
        return <WishlistEmpty palette={palette} onPin={() => router.push('/(tabs)/search')} />;
    }

    const handlePosterPress = (item: PersonalWishlistItem) => {
        if (item.restaurant?.id) router.push(`/restaurant/${item.restaurant.id}`);
    };

    const handleConfirmRemove = () => {
        if (!pending) return;
        const id = pending.restaurant?.id;
        if (!id) return;
        setPending(null);
        removeMutation.mutate(id, {
            onError: () => Alert.alert("Couldn't remove", 'Try again'),
        });
    };

    const handleEndReached = () => {
        if (hasNextPage && !isFetchingNextPage) fetchNextPage();
    };

    return (
        <>
            <ScrollView
                contentContainerStyle={styles.scrollContent}
                refreshControl={
                    <RefreshControl
                        refreshing={isRefetching}
                        onRefresh={refetch}
                        tintColor={palette.primary}
                    />
                }
                onMomentumScrollEnd={(e) => {
                    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
                    if (
                        layoutMeasurement.height + contentOffset.y >=
                        contentSize.height - 200
                    ) {
                        handleEndReached();
                    }
                }}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.countsRow}>
                    <Text style={[Type.caption, { color: palette.textMuted }]}>
                        <Text style={{ color: palette.text, fontWeight: '600' }}>
                            {items.length}
                        </Text>
                        {' '}
                        {items.length === 1 ? 'place' : 'places'}
                    </Text>
                    <Text
                        style={[
                            Type.caption,
                            { color: palette.textMuted, marginLeft: Spacing.lg },
                        ]}
                    >
                        <Text style={{ color: palette.text, fontWeight: '600' }}>
                            {cityCount}
                        </Text>
                        {' '}
                        {cityCount === 1 ? 'city' : 'cities'}
                    </Text>
                </View>
                {groups.map((g, i) => (
                    <CitySection
                        key={g.name}
                        group={g}
                        isFirst={i === 0}
                        palette={palette}
                        onPosterPress={handlePosterPress}
                        onPosterLongPress={(item) => setPending(item)}
                    />
                ))}
                {isFetchingNextPage ? (
                    <ActivityIndicator
                        color={palette.primary}
                        style={{ marginVertical: Spacing.lg }}
                    />
                ) : null}
            </ScrollView>
            <RemoveConfirmationSheet
                visible={pending !== null}
                restaurantName={pending?.restaurant?.name ?? ''}
                onConfirm={handleConfirmRemove}
                onCancel={() => setPending(null)}
            />
        </>
    );
}

const styles = StyleSheet.create({
    scrollContent: {
        paddingBottom: 100,
    },
    countsRow: {
        flexDirection: 'row',
        paddingHorizontal: 22,
        paddingTop: Spacing.xs,
        paddingBottom: Spacing.sm,
    },
    citySection: {
        paddingBottom: Spacing.md,
    },
    cityHeader: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        paddingHorizontal: 22,
        paddingTop: 14,
        paddingBottom: 10,
    },
    cityHeaderLeft: {
        flexDirection: 'row',
        alignItems: 'baseline',
        flexShrink: 1,
    },
    posterGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        paddingHorizontal: 22,
        gap: 8,
    },
    poster: {
        width: '31.5%',
    },
    posterImageWrap: {
        width: '100%',
        aspectRatio: 3 / 4,
        borderRadius: Radius.sm,
        overflow: 'hidden',
    },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: Spacing.xxl,
    },
});
