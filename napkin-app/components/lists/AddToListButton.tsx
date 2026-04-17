/**
 * AddToListButton — bookmark/plus icon button.
 * Sibling to WishlistHeartButton; opens AddToListSheet.
 *
 * Shows a filled bookmark if any of the user's lists contain this restaurant.
 */
import React, { useState } from 'react';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useListsContainingRestaurant } from '@/hooks/lists/useListsContainingRestaurant';
import { AddToListSheet } from './AddToListSheet';
import type { RestaurantPayload } from '@/hooks/wishlist/useWishlistAdd';

interface Props {
    restaurantId?: string;
    restaurantPayload?: RestaurantPayload;
    restaurantName?: string;
    userId: string | null | undefined;
    size?: number;
}

export function AddToListButton({
    restaurantId,
    restaurantPayload,
    restaurantName,
    userId,
    size = 24,
}: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const [sheetOpen, setSheetOpen] = useState(false);
    const { data: containingIds = [] } = useListsContainingRestaurant(userId, restaurantId);
    const inAnyList = containingIds.length > 0;

    return (
        <>
            <Pressable
                onPress={() => setSheetOpen(true)}
                hitSlop={8}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
                <Ionicons
                    name={inAnyList ? 'bookmark' : 'bookmark-outline'}
                    size={size}
                    color={inAnyList ? palette.primary : palette.icon}
                />
            </Pressable>

            <AddToListSheet
                visible={sheetOpen}
                onClose={() => setSheetOpen(false)}
                userId={userId}
                restaurantId={restaurantId}
                restaurantPayload={restaurantPayload}
                restaurantName={restaurantName}
            />
        </>
    );
}
