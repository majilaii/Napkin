/**
 * WishlistHeartButton — reusable heart icon for restaurant pages.
 *
 * States:
 *   - unsaved: outline heart, neutral text color
 *   - saved:   filled heart, warm accent (Colors.primary)
 *
 * Behavior:
 *   - Optimistic toggle: flips local state immediately, fires mutation, rolls back + Alert on error
 *   - Scale-bounce animation via Reanimated withSpring on tap
 *
 * Props:
 *   - restaurantId: UUID of a persisted restaurant (pass this OR restaurant)
 *   - restaurant:   Places payload for a ghost restaurant (server will upsert)
 *   - size:         icon size in pt (default 24)
 *   - userId:       required to enable the mutations and drive useIsWishlisted
 */
import React, { useEffect } from 'react';
import { Pressable, Alert } from 'react-native';
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

    const isServerSaved = useIsWishlisted(restaurantId, userId);
    const [optimisticSaved, setOptimisticSaved] = React.useState<boolean | null>(null);
    const saved = optimisticSaved !== null ? optimisticSaved : isServerSaved;

    // Sync optimistic state when server state changes (e.g., after cache invalidation)
    useEffect(() => {
        setOptimisticSaved(null);
    }, [isServerSaved]);

    const scale = useSharedValue(1);
    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));

    const addMutation = useWishlistAdd(userId);
    const removeMutation = useWishlistRemove(userId);

    const handlePress = () => {
        if (!userId) return;

        // Optimistic flip
        const nextSaved = !saved;
        setOptimisticSaved(nextSaved);

        // Scale bounce
        scale.value = withSpring(1.3, { damping: 10, stiffness: 300 }, () => {
            scale.value = withSpring(1, { damping: 12, stiffness: 260 });
        });

        if (nextSaved) {
            // Adding to wishlist
            const addInput = restaurantId
                ? { restaurant_id: restaurantId }
                : { restaurant };

            addMutation.mutate(addInput as any, {
                onError: () => {
                    setOptimisticSaved(!nextSaved); // rollback
                    Alert.alert("Couldn't save", 'Try again');
                },
            });
        } else {
            // Removing from wishlist — need the restaurant_id
            const rid = restaurantId;
            if (!rid) {
                // Ghost restaurant that was never saved — nothing to remove
                setOptimisticSaved(!nextSaved);
                return;
            }
            removeMutation.mutate(rid, {
                onError: () => {
                    setOptimisticSaved(!nextSaved); // rollback
                    Alert.alert("Couldn't remove", 'Try again');
                },
            });
        }
    };

    return (
        <Pressable
            onPress={handlePress}
            hitSlop={8}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
            <Animated.View style={animatedStyle}>
                <Ionicons
                    name={saved ? 'heart' : 'heart-outline'}
                    size={size}
                    color={saved ? palette.primary : palette.icon}
                />
            </Animated.View>
        </Pressable>
    );
}
