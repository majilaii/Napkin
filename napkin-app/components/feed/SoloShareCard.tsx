/**
 * SoloShareCard — card for solo share and collaborative entry activity items.
 * Extracted from tables.tsx; renders photo variant when photo_url is present.
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
import { type SoloShareActivity } from '@/hooks/tables/useTableActivity';
import { Avatar } from './Avatar';

type Palette = typeof Colors.light;

interface SoloShareCardProps {
    item: SoloShareActivity;
    palette: Palette;
}

export function SoloShareCard({ item, palette }: SoloShareCardProps) {
    const router = useRouter();
    const displayName = item.profiles?.display_name ?? 'Someone';
    const restaurantName = item.restaurants?.name ?? 'somewhere';
    const verb = item.rating != null ? 'tried' : 'noted';
    const photoUrl = item.restaurants?.photo_url ?? null;

    const handlePress = () =>
        router.push({ pathname: '/entry-detail', params: { entryId: item.id } });

    const contentBlock = (
        <>
            <View style={[styles.soloHeader, photoUrl ? { gap: Spacing.sm } : {}]}>
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
                            {
                                color: palette.tertiary,
                                fontSize: 20,
                                marginLeft: Spacing.sm,
                            },
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
                        {
                            color: palette.textMuted,
                            marginTop: Spacing.xs,
                            lineHeight: 18,
                        },
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
            style={({ pressed }) => [styles.soloCard, { opacity: pressed ? 0.7 : 1 }]}
        >
            {contentBlock}
        </Pressable>
    );
}

const styles = StyleSheet.create({
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
