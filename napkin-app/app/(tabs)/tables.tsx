/**
 * Tables tab — activity feed for the active table.
 * Real data via useTables + useTableActivity hooks.
 * Features: table switcher, PulseDot on live banner, Table Night cards, solo share rows.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    RefreshControl,
    Pressable,
    ActivityIndicator,
    Image,
    Animated,
    Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { Colors, Spacing, Radius, Shadow, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useTables } from '@/hooks/tables/useTables';
import {
    useTableActivity,
    type ActivityItem,
    type SoloShareActivity,
    type TableNightActivity,
} from '@/hooks/tables/useTableActivity';

type Palette = typeof Colors.light;

// ── PulseDot — animated live indicator ─────────────────────────────────────

function PulseDot({ size = 8, color = '#fff' }: { size?: number; color?: string }) {
    const pulse = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        const animation = Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, {
                    toValue: 0.3,
                    duration: 900,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(pulse, {
                    toValue: 1,
                    duration: 900,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ]),
        );
        animation.start();
        return () => animation.stop();
    }, [pulse]);

    return (
        <View
            style={{
                width: size + 8,
                height: size + 8,
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
            <Animated.View
                style={{
                    position: 'absolute',
                    width: size + 8,
                    height: size + 8,
                    borderRadius: (size + 8) / 2,
                    backgroundColor: color,
                    opacity: pulse,
                    transform: [
                        {
                            scale: pulse.interpolate({
                                inputRange: [0.3, 1],
                                outputRange: [1.4, 0.8],
                            }),
                        },
                    ],
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

export default function TablesScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const { user } = useAuth();

    // Real data
    const { data: tables, isLoading: tablesLoading } = useTables(user?.id);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const activeTable = tables?.[selectedIndex]?.tables ?? tables?.[0]?.tables;
    const hasMultipleTables = (tables?.length ?? 0) > 1;

    const cycleTable = () => {
        if (!tables || tables.length <= 1) return;
        setSelectedIndex((i) => (i + 1) % tables.length);
    };

    const {
        data: activityData,
        isLoading: feedLoading,
        isRefetching,
        refetch,
    } = useTableActivity(activeTable?.id);

    const items: ActivityItem[] = useMemo(
        () => activityData?.pages?.flat() ?? [],
        [activityData],
    );

    if (tablesLoading) {
        return (
            <View style={[styles.center, { backgroundColor: palette.background }]}>
                <ActivityIndicator color={palette.primary} />
            </View>
        );
    }

    if (!activeTable) {
        return (
            <View style={[styles.center, { backgroundColor: palette.background }]}>
                <Text style={[Type.displaySmall, { color: palette.text }]}>
                    No tables yet
                </Text>
                <Text
                    style={[
                        Type.body,
                        {
                            color: palette.textSecondary,
                            marginTop: Spacing.sm,
                            textAlign: 'center',
                        },
                    ]}
                >
                    Create or join a table to get started.
                </Text>
            </View>
        );
    }

    const tableName = activeTable.name;
    const isEmpty = !feedLoading && items.length === 0;

    return (
        <View style={{ flex: 1, backgroundColor: palette.background }}>
        <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
                paddingTop: insets.top + Spacing.sm,
                paddingBottom: 100,
            }}
            showsVerticalScrollIndicator={false}
            refreshControl={
                <RefreshControl
                    refreshing={isRefetching}
                    onRefresh={refetch}
                    tintColor={palette.primary}
                />
            }
        >
            {/* Header */}
            <View style={styles.header}>
                <Pressable
                    onPress={cycleTable}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                >
                    <Text
                        style={[
                            Type.headlineLarge,
                            {
                                color: palette.text,
                                fontFamily: 'Newsreader_400Regular_Italic',
                                fontSize: 28,
                            },
                        ]}
                        numberOfLines={1}
                    >
                        {tableName}
                    </Text>
                    {hasMultipleTables && (
                        <Text style={{ color: palette.textMuted, fontSize: 14 }}>▾</Text>
                    )}
                </Pressable>
            </View>

            {/* Feed */}
            {feedLoading ? (
                <ActivityIndicator
                    color={palette.primary}
                    style={{ marginTop: Spacing.xxl }}
                />
            ) : isEmpty ? (
                <View
                    style={{
                        padding: Spacing.xl,
                        alignItems: 'center',
                        marginTop: Spacing.xxl,
                    }}
                >
                    <Text
                        style={[
                            Type.headlineMedium,
                            { color: palette.text, textAlign: 'center' },
                        ]}
                    >
                        Nothing here yet
                    </Text>
                    <Text
                        style={[
                            Type.body,
                            {
                                color: palette.textSecondary,
                                textAlign: 'center',
                                marginTop: Spacing.sm,
                            },
                        ]}
                    >
                        Log a meal or start a Table Night to get the conversation going.
                    </Text>
                </View>
            ) : (
                <View style={styles.feedList}>
                    {items.map((item) => {
                        if (item.type === 'table_night') {
                            return (
                                <TableNightCard
                                    key={`tn-${item.id}`}
                                    item={item}
                                    palette={palette}
                                />
                            );
                        }
                        return (
                            <SoloShareCard
                                key={`solo-${item.id}`}
                                item={item as SoloShareActivity}
                                palette={palette}
                            />
                        );
                    })}
                </View>
            )}
        </ScrollView>
        </View>
    );
}

// ── Table Night Card (revealed/closed) ─────────────────────────────────────

function TableNightCard({
    item,
    palette,
}: {
    item: TableNightActivity;
    palette: Palette;
}) {
    const router = useRouter();
    const isActive = item.status === 'rating';
    const photoUrl = item.restaurants?.photo_url ?? null;
    const restaurantInitial = (item.restaurants?.name ?? 'R')[0].toUpperCase();

    return (
        <Pressable
            onPress={() =>
                router.push({
                    pathname: isActive ? '/table-night' : '/table-night-detail',
                    params: { nightId: item.id },
                })
            }
            style={({ pressed }) => [
                styles.tnCard,
                {
                    backgroundColor: palette.surfaceContainerLow,
                    opacity: pressed ? 0.95 : 1,
                    padding: 0,
                    overflow: 'hidden',
                },
                Shadow.subtle,
            ]}
        >
            {/* Hero image or fallback */}
            {photoUrl ? (
                <Image
                    source={{ uri: photoUrl }}
                    style={{
                        width: '100%',
                        aspectRatio: 3 / 2,
                        borderTopLeftRadius: Radius.xl,
                        borderTopRightRadius: Radius.xl,
                    }}
                    resizeMode="cover"
                />
            ) : (
                <View
                    style={{
                        width: '100%',
                        height: 80,
                        backgroundColor: palette.primaryMuted,
                        borderTopLeftRadius: Radius.xl,
                        borderTopRightRadius: Radius.xl,
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <Text
                        style={{
                            fontFamily: 'Newsreader_400Regular',
                            fontSize: 32,
                            color: palette.primary,
                            opacity: 0.4,
                        }}
                    >
                        {restaurantInitial}
                    </Text>
                </View>
            )}

            {/* Card content */}
            <View style={{ padding: Spacing.lg }}>
            {/* Badge */}
            <View style={[styles.tnBadge, { backgroundColor: isActive ? palette.tertiaryFixed : palette.primaryMuted }]}>
                {isActive && <PulseDot size={7} color={palette.tertiary} />}
                <Text style={[Type.labelSmall, { color: isActive ? palette.tertiary : palette.primary }]}>
                    {isActive ? 'ACTIVE ROUND' : 'ROUND'}
                </Text>
            </View>

            {/* Restaurant + rating */}
            <View style={styles.tnHeader}>
                <Text
                    style={[
                        Type.headlineLarge,
                        { color: palette.text, fontSize: 24, flex: 1 },
                    ]}
                    numberOfLines={1}
                >
                    {item.restaurants?.name ?? 'Unknown'}
                </Text>
                {item.average_rating != null && (
                    <Text
                        style={[
                            Type.rating,
                            { color: palette.tertiary, fontSize: 24 },
                        ]}
                    >
                        {item.average_rating.toFixed(1)}
                    </Text>
                )}
            </View>

            {/* Participants */}
            {item.participants?.length > 0 && (
                <View style={styles.tnVoters}>
                    {item.participants.map((p, i) => (
                        <Pressable
                            key={`${p.user_id}-${i}`}
                            onPress={() => {
                                if (p.rating != null) {
                                    router.push({
                                        pathname: '/entry-detail',
                                        params: { nightId: item.id, userId: p.user_id },
                                    });
                                }
                            }}
                            style={({ pressed }) => [
                                styles.voterChip,
                                p.rating != null && { opacity: pressed ? 0.6 : 1 },
                            ]}
                        >
                            <Avatar
                                name={p.profiles?.display_name ?? '?'}
                                url={null}
                                size={28}
                                palette={palette}
                            />
                            <Text
                                style={[
                                    Type.labelSmall,
                                    { color: palette.text, marginLeft: 6 },
                                ]}
                            >
                                {p.profiles?.display_name ?? 'User'}
                            </Text>
                            {p.rating != null && (
                                <Text
                                    style={[
                                        Type.rating,
                                        {
                                            color: palette.tertiary,
                                            fontSize: 14,
                                            marginLeft: 4,
                                        },
                                    ]}
                                >
                                    {p.rating.toFixed(1)}
                                </Text>
                            )}
                            {p.rating != null && (
                                <Text
                                    style={[
                                        Type.labelSmall,
                                        { color: palette.textMuted, marginLeft: 'auto' },
                                    ]}
                                >
                                    →
                                </Text>
                            )}
                        </Pressable>
                    ))}
                </View>
            )}
            </View>
        </Pressable>
    );
}

// ── Solo Share Card ────────────────────────────────────────────────────────

function SoloShareCard({
    item,
    palette,
}: {
    item: SoloShareActivity;
    palette: Palette;
}) {
    const router = useRouter();
    const displayName = item.profiles?.display_name ?? 'Someone';
    const restaurantName = item.restaurants?.name ?? 'somewhere';
    const verb = item.rating != null ? 'tried' : 'noted';
    const photoUrl = item.restaurants?.photo_url ?? null;

    const handlePress = () =>
        router.push({ pathname: '/entry-detail', params: { entryId: item.id } });

    const contentBlock = (
        <>
            <View style={[styles.soloHeader, { gap: photoUrl ? Spacing.sm : Spacing.md }]}>
                <Avatar
                    name={displayName}
                    url={null}
                    size={photoUrl ? 28 : 40}
                    palette={palette}
                />
                <View style={{ flex: 1 }}>
                    <Text style={[Type.body, { color: palette.text }]}>
                        <Text style={{ fontFamily: 'Manrope_600SemiBold' }}>
                            {displayName}
                        </Text>{' '}
                        {verb}
                    </Text>
                    <Text
                        style={[
                            Type.headlineMedium,
                            { color: palette.text, fontSize: 20, marginTop: 2 },
                        ]}
                        numberOfLines={1}
                    >
                        {restaurantName}
                    </Text>
                </View>
                {item.rating != null && (
                    <Text
                        style={[
                            Type.rating,
                            { color: palette.tertiary, fontSize: 20, marginLeft: Spacing.sm },
                        ]}
                    >
                        {item.rating.toFixed(1)}
                    </Text>
                )}
            </View>
            {item.dish_description ? (
                <Text
                    style={[
                        Type.labelSmall,
                        {
                            color: palette.tertiary,
                            backgroundColor: palette.tertiaryFixed,
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                            borderRadius: Radius.sm,
                            alignSelf: 'flex-start',
                            marginTop: Spacing.xs,
                            overflow: 'hidden',
                        },
                    ]}
                    numberOfLines={1}
                >
                    {item.dish_description}
                </Text>
            ) : null}
            {item.content ? (
                <Text
                    style={[
                        Type.bodySmall,
                        { color: palette.textMuted, marginTop: Spacing.xs, lineHeight: 18 },
                    ]}
                    numberOfLines={2}
                >
                    {item.content}
                </Text>
            ) : null}
        </>
    );

    if (photoUrl) {
        return (
            <Pressable
                onPress={handlePress}
                style={({ pressed }) => [
                    {
                        backgroundColor: palette.surfaceContainerLow,
                        borderRadius: Radius.xl,
                        overflow: 'hidden',
                        opacity: pressed ? 0.95 : 1,
                    },
                    Shadow.subtle,
                ]}
            >
                <Image
                    source={{ uri: photoUrl }}
                    style={{
                        width: '100%',
                        aspectRatio: 3 / 2,
                        borderTopLeftRadius: Radius.xl,
                        borderTopRightRadius: Radius.xl,
                    }}
                    resizeMode="cover"
                />
                <View style={{ padding: Spacing.lg }}>{contentBlock}</View>
            </Pressable>
        );
    }

    return (
        <Pressable
            onPress={handlePress}
            style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
        >
            {contentBlock}
        </Pressable>
    );
}

// ── Avatar ─────────────────────────────────────────────────────────────────

function Avatar({
    name,
    url,
    size,
    palette,
}: {
    name: string;
    url: string | null;
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

    const baseStyle = {
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: tint,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
    };

    if (url) return <Image source={{ uri: url }} style={baseStyle} />;

    return (
        <View style={baseStyle}>
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
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: Spacing.xl,
    },
    header: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.lg,
        paddingBottom: Spacing.md,
    },
    feedList: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.xl,
        gap: Spacing.xl,
    },

    // Table Night card
    tnCard: {
        borderRadius: Radius.xl,
        padding: Spacing.lg,
    },
    tnBadge: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: Spacing.sm,
        paddingVertical: 3,
        borderRadius: Radius.sm,
        marginBottom: Spacing.sm,
    },
    tnHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    tnVoters: {
        marginTop: Spacing.md,
        gap: Spacing.sm,
    },
    voterChip: {
        flexDirection: 'row',
        alignItems: 'center',
    },

    // Solo share card
    soloCard: {
        flexDirection: 'row',
        gap: Spacing.md,
        alignItems: 'flex-start',
    },
    soloHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
});
