/**
 * TopFourPosterSlot — single slot in the 4-poster grid.
 *
 * Filled:   Pressable → navigate to /restaurant/[id]
 * Empty + owner:  Pressable → calls onOpenEdit()
 * Empty + viewer: inert (no press handler)
 *
 * Aspect ratio 3:4, Radius.sm, ambient Shadow.clip. Matches WishlistByCity poster.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { TopFourPick } from '@/hooks/top-fours/useTopFours';

interface Props {
    pick: TopFourPick | null;   // null = empty slot
    isOwner: boolean;
    onOpenEdit?: () => void;    // called when empty slot tapped by owner
}

export function TopFourPosterSlot({ pick, isOwner, onOpenEdit }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    if (pick) {
        const { restaurant } = pick;
        return (
            <Pressable
                onPress={() => router.push(`/restaurant/${restaurant.id}` as any)}
                style={({ pressed }) => [
                    styles.slot,
                    { opacity: pressed ? 0.92 : 1 },
                ]}
                accessibilityLabel={`View ${restaurant.name}`}
                accessibilityRole="button"
            >
                <View
                    style={[
                        styles.posterWrap,
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
                    {/* Position badge */}
                    <View
                        style={[
                            styles.positionBadge,
                            { backgroundColor: palette.scrimCream },
                        ]}
                    >
                        <Text
                            style={[
                                Type.labelSmall,
                                { color: palette.text, fontSize: 8 },
                            ]}
                        >
                            {pick.position}
                        </Text>
                    </View>
                </View>
                <Text
                    numberOfLines={1}
                    style={[
                        Type.headlineItalic,
                        {
                            fontSize: 11,
                            lineHeight: 14,
                            color: palette.text,
                            marginTop: Spacing.xs,
                        },
                    ]}
                >
                    {restaurant.name}
                </Text>
            </Pressable>
        );
    }

    // Empty slot
    if (isOwner && onOpenEdit) {
        return (
            <Pressable
                onPress={onOpenEdit}
                style={({ pressed }) => [
                    styles.slot,
                    { opacity: pressed ? 0.7 : 1 },
                ]}
                accessibilityLabel="Pick a replacement"
                accessibilityRole="button"
            >
                <View
                    style={[
                        styles.posterWrap,
                        styles.emptySlot,
                        {
                            backgroundColor: palette.terracottaScrim,
                            borderColor: palette.terracottaBorder,
                        },
                    ]}
                >
                    <Text style={[Type.labelSmall, { color: palette.primary, fontSize: 18, lineHeight: 22 }]}>+</Text>
                </View>
                <Text
                    numberOfLines={1}
                    style={[
                        Type.caption,
                        {
                            fontSize: 10,
                            lineHeight: 14,
                            color: palette.textMuted,
                            marginTop: Spacing.xs,
                            textAlign: 'center',
                        },
                    ]}
                >
                    pick a spot
                </Text>
            </Pressable>
        );
    }

    // Viewer empty — inert placeholder
    return (
        <View style={styles.slot}>
            <View
                style={[
                    styles.posterWrap,
                    {
                        backgroundColor: palette.surfaceJournalLow,
                        borderColor: palette.dividerSoft,
                        borderWidth: StyleSheet.hairlineWidth,
                    },
                ]}
            />
            <Text
                numberOfLines={1}
                style={[
                    Type.caption,
                    {
                        fontSize: 10,
                        lineHeight: 14,
                        color: palette.textMuted,
                        marginTop: Spacing.xs,
                        textAlign: 'center',
                    },
                ]}
            >
                —
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    slot: {
        width: '23%',
    },
    posterWrap: {
        width: '100%',
        aspectRatio: 3 / 4,
        borderRadius: Radius.sm,
        overflow: 'hidden',
    },
    emptySlot: {
        borderWidth: 1,
        borderStyle: 'dashed',
        alignItems: 'center',
        justifyContent: 'center',
    },
    positionBadge: {
        position: 'absolute',
        top: 3,
        left: 3,
        width: 14,
        height: 14,
        borderRadius: 7,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
