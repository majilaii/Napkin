/**
 * WishlistHeartButton — reusable heart icon for restaurant pages.
 *
 * States:
 *   - unsaved: outline heart, neutral text color
 *   - saved:   filled heart, warm accent (Colors.primary)
 *
 * Behavior:
 *   - Optimistic toggle is owned by the hook layer (useWishlistAdd /
 *     useWishlistRemove): they flip the wishlist.check cache key on
 *     mutate and roll back on error. useIsWishlisted reads that key,
 *     so the UI stays in sync without component-local state.
 *     (TICKET-036 P1-2 / P1-14)
 *   - Scale-bounce animation via Reanimated withSpring on tap.
 *
 * Props:
 *   - restaurantId: UUID of a persisted restaurant (pass this OR restaurant)
 *   - restaurant:   Places payload for a ghost restaurant (server will upsert)
 *   - size:         icon size in pt (default 24)
 *   - userId:       required to enable the mutations and drive useIsWishlisted
 */
import React from 'react';
import { Pressable, Alert, ActivityIndicator } from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useIsWishlisted } from '@/hooks/wishlist/useIsWishlisted';
import { useWishlistAdd } from '@/hooks/wishlist/useWishlistAdd';
import { useWishlistRemove } from '@/hooks/wishlist/useWishlistRemove';
import type { RestaurantPayload } from '@/hooks/wishlist/useWishlistAdd';

interface WishlistHeartButtonProps {
    restaurantId?: string;
    restaurant?: RestaurantPayload;
    size?: number;
    userId: string | null | undefined;
}

export function WishlistHeartButton({
    restaurantId,
    restaurant,
    size = 24,
    userId,
}: WishlistHeartButtonProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    // useIsWishlisted accepts either a UUID (queries server) or an
    // external_id (reads cache, populated by useWishlistAdd's dual-write
    // optimistic patch). Either way, the hook is the single source of truth.
    const effectiveId = restaurantId ?? restaurant?.external_id;
    const saved = useIsWishlisted(effectiveId, userId);

    const scale = useSharedValue(1);
    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));

    const addMutation = useWishlistAdd(userId);
    const removeMutation = useWishlistRemove(userId);

    const handlePress = () => {
        if (!userId || saved === undefined) return;

        // Scale bounce
        scale.value = withSpring(1.3, { damping: 10, stiffness: 300 }, () => {
            scale.value = withSpring(1, { damping: 12, stiffness: 260 });
        });

        if (!saved) {
            // Adding to wishlist — hook handles the optimistic check-key flip.
            const addInput = restaurantId
                ? { restaurant_id: restaurantId }
                : { restaurant };

            addMutation.mutate(addInput as Parameters<typeof addMutation.mutate>[0], {
                onError: () => {
                    Alert.alert("Couldn't save", 'Try again');
                },
            });
        } else {
            // Removing from wishlist — need the persisted restaurant_id.
            // For a ghost restaurant we may have just resolved one via the add mutation.
            const rid = restaurantId ?? addMutation.data?.restaurant_id;
            if (!rid) return;
            removeMutation.mutate(rid, {
                onError: () => {
                    Alert.alert("Couldn't remove", 'Try again');
                },
            });
        }
    };

    return (
        <Pressable
            onPress={handlePress}
            disabled={!userId || saved === undefined || addMutation.isPending || removeMutation.isPending}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={saved === undefined ? 'Checking wishlist' : saved ? 'Remove from wishlist' : 'Add to wishlist'}
            accessibilityState={{
                disabled: !userId || saved === undefined,
                selected: saved === true,
                busy: addMutation.isPending || removeMutation.isPending,
            }}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
            <Animated.View style={animatedStyle}>
                {saved === undefined || addMutation.isPending || removeMutation.isPending ? (
                    <ActivityIndicator size="small" color={palette.icon} />
                ) : (
                    <Ionicons
                        name={saved ? 'heart' : 'heart-outline'}
                        size={size}
                        color={saved ? palette.primary : palette.icon}
                    />
                )}
            </Animated.View>
        </Pressable>
    );
}
