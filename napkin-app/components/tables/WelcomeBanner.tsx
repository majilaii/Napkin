/**
 * WelcomeBanner — passive "X added you to Y" banner shown once after a member is added.
 *
 * Gating rules:
 *   - caller_welcomed_at IS NULL (server has not yet seen a mark_welcomed call)
 *   - caller_role !== 'admin' (table creators never see this banner)
 *
 * The design tech says: warm-cream surface, Ionicons close X, dismiss calls useMarkWelcomed.
 * One-line copy: "Clara added you to Sunday Roast Club"
 *
 * adderName: The display name of whoever added the user. May be null if lookup fails — falls
 * back to generic copy "You were added to {tableName}".
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing } from '@/constants/theme';
import { useMarkWelcomed } from '@/hooks/tables/useMarkWelcomed';

type Palette = typeof Colors.light;

interface WelcomeBannerProps {
    tableId: string;
    tableName: string;
    /** Display name of the person who added the current user — null if unknown. */
    adderName: string | null;
    palette: Palette;
}

export function WelcomeBanner({ tableId, tableName, adderName, palette }: WelcomeBannerProps) {
    const { mutate: markWelcomed } = useMarkWelcomed();

    const copy = adderName
        ? `${adderName} added you to ${tableName}`
        : `You were added to ${tableName}`;

    return (
        <View
            style={[
                styles.banner,
                {
                    backgroundColor: palette.tertiaryFixed,
                    borderColor: palette.terracottaBorder,
                },
            ]}
        >
            <Ionicons
                name="people-outline"
                size={16}
                color={palette.primary}
                style={styles.icon}
            />
            <Text
                style={[styles.copy, { color: palette.text }]}
                numberOfLines={2}
            >
                {copy}
            </Text>
            <Pressable
                onPress={() => markWelcomed({ tableId })}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Dismiss welcome banner"
            >
                <Ionicons name="close-outline" size={20} color={palette.textMuted} />
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    banner: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 22,
        marginBottom: Spacing.md,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm + 2,
        borderRadius: 10,
        borderWidth: 1,
        gap: Spacing.sm,
    },
    icon: {
        flexShrink: 0,
    },
    copy: {
        flex: 1,
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
        letterSpacing: 0.1,
    },
});
