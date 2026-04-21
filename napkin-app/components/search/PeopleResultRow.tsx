/**
 * PeopleResultRow — presentational row for a single people-search result.
 * TICKET-028
 *
 * Layout: [Avatar 40] [display_name] [Following pill?]
 * Tap → onPress(user_id)
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    is_following?: boolean;
    onPress: (userId: string) => void;
}

function initials(name: string): string {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.slice(0, 1).toUpperCase();
}

export function PeopleResultRow({ user_id, display_name, avatar_url, is_following, onPress }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <Pressable
            onPress={() => onPress(user_id)}
            style={({ pressed }) => [
                styles.row,
                { backgroundColor: pressed ? palette.surfaceContainerLow : 'transparent' },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${display_name}${is_following ? ', following' : ''}`}
        >
            {/* Avatar */}
            <View style={[styles.avatar, { backgroundColor: palette.primaryContainer }]}>
                {avatar_url ? (
                    <Image source={{ uri: avatar_url }} style={styles.avatarImg} />
                ) : (
                    <Text style={styles.avatarInitials}>{initials(display_name)}</Text>
                )}
            </View>

            {/* Name */}
            <Text
                style={[styles.name, { color: palette.text }]}
                numberOfLines={1}
            >
                {display_name}
            </Text>

            {/* Following pill */}
            {is_following && (
                <View style={[styles.pill, { backgroundColor: palette.oliveCream }]}>
                    <Text style={[styles.pillText, { color: palette.textSecondary }]}>
                        Following
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
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm + 2,
        gap: Spacing.sm + 4,
    },
    avatar: {
        width: 40,
        height: 40,
        borderRadius: Radius.full,
        justifyContent: 'center',
        alignItems: 'center',
        flexShrink: 0,
        overflow: 'hidden',
    },
    avatarImg: {
        width: 40,
        height: 40,
        borderRadius: Radius.full,
    },
    avatarInitials: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
        color: 'rgba(255,255,255,0.92)',
    },
    name: {
        flex: 1,
        fontFamily: 'Manrope_500Medium',
        fontSize: 15,
    },
    pill: {
        paddingHorizontal: Spacing.sm,
        paddingVertical: 3,
        borderRadius: Radius.full,
    },
    pillText: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
    },
});
