/**
 * WishlistCard — single card in the Pinterest-style wishlist grid.
 *
 * Two modes:
 *   personal — long-press opens RemoveConfirmationSheet; tap → restaurant page
 *   table    — read-only; shows overlap chip + avatar stack; long-press is a no-op
 *
 * Variable card heights driven by image aspect ratio.
 * Default aspect ratio 4:3 while loading; updates once the image reports its dimensions.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useRouter } from 'expo-router';
import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useWishlistRemove } from '@/hooks/wishlist/useWishlistRemove';
import { OverlapChip } from './OverlapChip';
import { AvatarStack } from './AvatarStack';
import { RemoveConfirmationSheet } from './RemoveConfirmationSheet';
import type { WishlistRestaurant } from '@/hooks/wishlist/useMyWishlist';
import type { TableWishlistMember } from '@/hooks/wishlist/useTableWishlist';

interface PersonalCardProps {
    mode: 'personal';
    id: string;
    note: string | null;
    created_at: string;
    restaurant: WishlistRestaurant;
}

interface TableCardProps {
    mode: 'table';
    restaurant: WishlistRestaurant;
    count: number;
    members: TableWishlistMember[];
}

type WishlistCardProps = PersonalCardProps | TableCardProps;

export function WishlistCard(props: WishlistCardProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const { user } = useAuth();

    const [showRemoveSheet, setShowRemoveSheet] = useState(false);
    const [imageAspect, setImageAspect] = useState<number>(4 / 3); // default 4:3

    const removeMutation = useWishlistRemove(user?.id);

    const { restaurant } = props;
    const photoUrl = restaurant.photo_url;
    const secondaryLine = restaurant.city ?? restaurant.cuisine ?? null;

    const handleTap = () => {
        if (restaurant.id) {
            router.push(`/restaurant/${restaurant.id}`);
        }
    };

    const handleLongPress = () => {
        if (props.mode === 'personal') {
            setShowRemoveSheet(true);
        }
        // Table mode: no-op
    };

    const handleRemoveConfirm = () => {
        setShowRemoveSheet(false);
        removeMutation.mutate(restaurant.id, {
            onError: () => {
                Alert.alert("Couldn't remove", 'Try again');
            },
        });
    };

    return (
        <>
            <Pressable
                onPress={handleTap}
                onLongPress={handleLongPress}
                delayLongPress={400}
                style={({ pressed }) => [
                    styles.card,
                    {
                        backgroundColor: palette.card,
                        ...Shadow.subtle,
                        opacity: pressed ? 0.92 : 1,
                    },
                ]}
            >
                {/* Photo */}
                {photoUrl ? (
                    <ExpoImage
                        source={{ uri: photoUrl }}
                        style={[styles.photo, { aspectRatio: imageAspect }]}
                        contentFit="cover"
                        onLoad={(e) => {
                            const { width, height } = e.source;
                            if (width && height) {
                                setImageAspect(width / height);
                            }
                        }}
                    />
                ) : (
                    <View
                        style={[
                            styles.photoPlaceholder,
                            { backgroundColor: palette.surfaceContainerHigh },
                        ]}
                    />
                )}

                {/* Text */}
                <View style={styles.textContainer}>
                    <Text
                        style={[Type.titleSmall, { color: palette.text }]}
                        numberOfLines={2}
                    >
                        {restaurant.name}
                    </Text>
                    {secondaryLine && (
                        <Text
                            style={[Type.caption, { color: palette.textMuted, marginTop: 2 }]}
                            numberOfLines={1}
                        >
                            {secondaryLine}
                        </Text>
                    )}

                    {/* Table mode: overlap chip + avatar stack */}
                    {props.mode === 'table' && (
                        <View style={styles.overlapRow}>
                            <OverlapChip count={props.count} />
                            <AvatarStack members={props.members} />
                        </View>
                    )}
                </View>
            </Pressable>

            {/* Personal mode: removal sheet */}
            {props.mode === 'personal' && (
                <RemoveConfirmationSheet
                    visible={showRemoveSheet}
                    restaurantName={restaurant.name}
                    onConfirm={handleRemoveConfirm}
                    onCancel={() => setShowRemoveSheet(false)}
                />
            )}
        </>
    );
}

const styles = StyleSheet.create({
    card: {
        borderRadius: Radius.md,
        overflow: 'hidden',
        flex: 1,
    },
    photo: {
        width: '100%',
    },
    photoPlaceholder: {
        width: '100%',
        aspectRatio: 4 / 3,
    },
    textContainer: {
        padding: Spacing.sm,
        paddingBottom: Spacing.md,
        gap: 2,
    },
    overlapRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xs,
        marginTop: Spacing.xs,
        flexWrap: 'wrap',
    },
});
