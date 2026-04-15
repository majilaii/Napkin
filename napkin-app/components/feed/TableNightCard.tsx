/**
 * TableNightCard — card for table night activity items.
 * Extracted from tables.tsx; handles both active (rating) and revealed rounds.
 */

import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    Pressable,
    Image,
} from 'react-native';
import { useRouter } from 'expo-router';

import { Colors, Spacing, Radius, Shadow, Type } from '@/constants/theme';
import { type TableNightActivity } from '@/hooks/tables/useTableActivity';
import { Avatar } from './Avatar';
import { PulseDot } from './PulseDot';

type Palette = typeof Colors.light;

interface TableNightCardProps {
    item: TableNightActivity;
    palette: Palette;
}

export function TableNightCard({ item, palette }: TableNightCardProps) {
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
                <View
                    style={[
                        styles.tnBadge,
                        {
                            backgroundColor: isActive
                                ? palette.tertiaryFixed
                                : palette.primaryMuted,
                        },
                    ]}
                >
                    {isActive && <PulseDot size={7} color={palette.tertiary} />}
                    <Text
                        style={[
                            Type.labelSmall,
                            {
                                color: isActive
                                    ? palette.tertiary
                                    : palette.primary,
                            },
                        ]}
                    >
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
                                            params: {
                                                nightId: item.id,
                                                userId: p.user_id,
                                            },
                                        });
                                    }
                                }}
                                style={({ pressed }) => [
                                    styles.voterChip,
                                    p.rating != null && {
                                        opacity: pressed ? 0.6 : 1,
                                    },
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
                                            {
                                                color: palette.textMuted,
                                                marginLeft: 'auto',
                                            },
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

const styles = StyleSheet.create({
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
});
