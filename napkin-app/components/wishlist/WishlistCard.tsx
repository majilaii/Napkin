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
import type { WishlistSource } from '@/lib/types/wishlistSource';

interface PersonalCardProps {
    mode: 'personal';
    id: string;
    note: string | null;
    created_at: string;
    restaurant: WishlistRestaurant;
    /** TikTok / google_maps / web source captured at save time (TICKET-053). */
    source?: WishlistSource | null;
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

    // TICKET-054: "tiktok" tag — personal mode only; never shown in table mode
    const isTikTokSourced =
        props.mode === 'personal' && props.source?.type === 'tiktok';

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
                {/* Photo + optional TikTok tag overlay */}
                <View style={styles.photoWrapper}>
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
                    {/* TICKET-054: TikTok grid tag — bottom-right of photo, personal mode only */}
                    {isTikTokSourced ? (
                        <Text
                            style={[
                                styles.tiktokTag,
                                {
                                    color: palette.textMuted,
                                    textShadowColor: palette.surfaceJournalLow,
                                    textShadowOffset: { width: 0, height: 1 },
                                    textShadowRadius: 4,
                                },
                            ]}
                            importantForAccessibility="no"
                            accessibilityElementsHidden
                        >
                            tiktok
                        </Text>
                    ) : null}
                </View>

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
    photoWrapper: {
        // Relative container so the tiktok tag can be absolutely positioned
        position: 'relative',
    },
    photo: {
        width: '100%',
    },
    photoPlaceholder: {
        width: '100%',
        aspectRatio: 4 / 3,
    },
    tiktokTag: {
        // TICKET-054: lowercase Manrope tag, bottom-right of photo, Spacing.xs inset
        position: 'absolute',
        bottom: Spacing.xs,
        right: Spacing.xs,
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1,
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
