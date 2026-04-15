/**
 * CompactEntryRow — single-line compact layout for entries older than 14 days.
 * Shows: 24px avatar, restaurant name (flex 1), rating (if present).
 * Tapping calls onPress to expand to the full card.
 * Works for both SoloShareActivity and TableNightActivity.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors, Spacing, Type } from '@/constants/theme';
import {
    type ActivityItem,
    type SoloShareActivity,
    type TableNightActivity,
} from '@/hooks/tables/useTableActivity';
import { Avatar } from './Avatar';

type Palette = typeof Colors.light;

interface CompactEntryRowProps {
    item: ActivityItem;
    palette: Palette;
    onPress: () => void;
}

function getDisplayData(item: ActivityItem): {
    name: string;
    restaurantName: string;
    rating: number | null;
    isRound: boolean;
} {
    if (item.type === 'table_night') {
        const tn = item as TableNightActivity;
        return {
            name: 'Round',
            restaurantName: tn.restaurants?.name ?? 'Unknown',
            rating: tn.average_rating,
            isRound: true,
        };
    }
    const ss = item as SoloShareActivity;
    return {
        name: ss.profiles?.display_name ?? 'Someone',
        restaurantName: ss.restaurants?.name ?? 'somewhere',
        rating: ss.rating,
        isRound: false,
    };
}

export function CompactEntryRow({ item, palette, onPress }: CompactEntryRowProps) {
    const { name, restaurantName, rating, isRound } = getDisplayData(item);

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.row,
                { opacity: pressed ? 0.7 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${restaurantName}, tap to expand`}
        >
            <Avatar name={name} url={null} size={24} palette={palette} />
            {isRound && (
                <View
                    style={[
                        styles.roundDot,
                        { backgroundColor: palette.primaryMuted },
                    ]}
                />
            )}
            <Text
                style={[
                    Type.body,
                    {
                        color: palette.text,
                        flex: 1,
                        fontSize: 14,
                        marginLeft: Spacing.sm,
                    },
                ]}
                numberOfLines={1}
            >
                {restaurantName}
            </Text>
            {rating != null && (
                <Text
                    style={[
                        Type.rating,
                        {
                            color: palette.tertiary,
                            fontSize: 14,
                            marginLeft: Spacing.sm,
                        },
                    ]}
                >
                    {rating.toFixed(1)}
                </Text>
            )}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: Spacing.xs + 2,
        paddingHorizontal: Spacing.lg,
    },
    roundDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        marginLeft: Spacing.xs,
    },
});
