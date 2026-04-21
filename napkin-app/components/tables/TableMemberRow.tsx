/**
 * TableMemberRow — presentational row for a table member.
 *
 * Shows: avatar + display_name + optional "Owner" chip.
 * Tapping routes to the member's profile.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors, Spacing } from '@/constants/theme';
import { Avatar } from '@/components/feed/Avatar';

type Palette = typeof Colors.light;

export interface TableMemberRowProps {
    userId: string;
    displayName: string;
    avatarUrl: string | null;
    isOwner?: boolean;
    palette: Palette;
    onPress?: () => void;
}

export function TableMemberRow({
    userId,
    displayName,
    avatarUrl,
    isOwner = false,
    palette,
    onPress,
}: TableMemberRowProps) {
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.row,
                { opacity: pressed ? 0.7 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={displayName}
        >
            <Avatar
                name={displayName}
                url={avatarUrl}
                size={36}
                palette={palette}
            />
            <View style={styles.textBlock}>
                <Text
                    style={[styles.name, { color: palette.text }]}
                    numberOfLines={1}
                >
                    {displayName}
                </Text>
            </View>
            {isOwner && (
                <View style={[styles.ownerChip, { backgroundColor: palette.primaryMuted }]}>
                    <Text style={[styles.ownerChipText, { color: palette.primary }]}>
                        Owner
                    </Text>
                </View>
            )}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        paddingVertical: 10,
        gap: Spacing.md,
    },
    textBlock: {
        flex: 1,
        minWidth: 0,
    },
    name: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 15,
        letterSpacing: 0.1,
    },
    ownerChip: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 10,
    },
    ownerChipText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11,
        letterSpacing: 0.4,
    },
});
