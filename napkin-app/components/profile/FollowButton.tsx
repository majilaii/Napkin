/**
 * FollowButton — pill button for following/unfollowing a user. TICKET-028.
 *
 * - "Follow"    → terracotta fill, white label
 * - "Following" → outline, textSecondary label
 * - Long-press or tap-when-Following triggers unfollow (no confirmation dialog)
 * - Optimistic: button flips instantly, reverts on error
 */
import React, { useEffect, useState } from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useFollow, useUnfollow } from '@/hooks/users/useFollow';

interface Props {
    targetUserId: string;
    initialIsFollowing: boolean;
}

export function FollowButton({ targetUserId, initialIsFollowing }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    // Local state tracks optimistic state between parent cache updates
    const [isFollowing, setIsFollowing] = useState(initialIsFollowing);

    const followMutation = useFollow();
    const unfollowMutation = useUnfollow();

    const isPending = followMutation.isPending || unfollowMutation.isPending;

    // Re-sync local state when the parent's follow flag changes (e.g. profile
    // refetch after onSuccess, or navigating between profiles that reuse this
    // component). Guarded on isPending so an in-flight optimistic flip is never
    // clobbered by a stale prop mid-mutation.
    useEffect(() => {
        if (isPending) return;
        setIsFollowing(initialIsFollowing);
    }, [initialIsFollowing, isPending]);

    const handlePress = () => {
        if (isPending) return;

        if (isFollowing) {
            setIsFollowing(false);
            unfollowMutation.mutate(
                { targetUserId },
                {
                    onError: () => setIsFollowing(true),
                }
            );
        } else {
            setIsFollowing(true);
            followMutation.mutate(
                { targetUserId },
                {
                    onError: () => setIsFollowing(false),
                }
            );
        }
    };

    return (
        <Pressable
            onPress={handlePress}
            onLongPress={isFollowing ? handlePress : undefined}
            style={({ pressed }) => [
                styles.button,
                isFollowing
                    ? [
                        styles.followingButton,
                        {
                            borderColor: palette.outlineVariant,
                            backgroundColor: 'transparent',
                        },
                      ]
                    : [
                        styles.followButton,
                        { backgroundColor: palette.primary },
                      ],
                pressed && styles.pressed,
            ]}
            accessibilityLabel={isFollowing ? 'Unfollow' : 'Follow'}
            accessibilityRole="button"
        >
            <Text
                style={[
                    styles.label,
                    isFollowing
                        ? { color: palette.textSecondary }
                        : { color: palette.textInverse },
                ]}
            >
                {isFollowing ? 'Following' : 'Follow'}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    button: {
        height: 32,
        paddingHorizontal: Spacing.md,
        borderRadius: Radius.full,
        justifyContent: 'center',
        alignItems: 'center',
        minWidth: 80,
    },
    followButton: {
        // terracotta fill — set inline
    },
    followingButton: {
        borderWidth: 1,
    },
    pressed: {
        opacity: 0.7,
    },
    label: {
        ...Type.caption,
        fontFamily: 'Manrope_600SemiBold',
        fontWeight: '600',
    },
});
