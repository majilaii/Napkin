/**
 * WhoBeenRow — horizontal scroll of Tablemate avatars who've been to this restaurant.
 * Each avatar shows that user's personal average beneath.
 * Hidden by the caller when users array is empty.
 */
import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { WhosBeenEntry } from '@/hooks/restaurants/useRestaurantPage';

type Palette = typeof Colors.light;

const AVATAR_SIZE = 48;

interface Props {
    users: WhosBeenEntry[];
}

export function WhoBeenRow({ users }: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;

    if (users.length === 0) return null;

    return (
        <View style={styles.container}>
            <Text style={[Type.label, { color: palette.textSecondary, marginBottom: Spacing.sm }]}>
                Who&apos;s been
            </Text>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.scroll}
            >
                {users.map((u) => (
                    <View key={u.user_id} style={styles.item}>
                        {/* Avatar */}
                        <View
                            style={[
                                styles.avatarRing,
                                { borderColor: palette.outlineVariant },
                            ]}
                        >
                            {u.avatar_url ? (
                                <ExpoImage
                                    source={{ uri: u.avatar_url }}
                                    style={styles.avatar}
                                    contentFit="cover"
                                />
                            ) : (
                                <View
                                    style={[
                                        styles.avatar,
                                        { backgroundColor: palette.surfaceContainerHigh, justifyContent: 'center', alignItems: 'center' },
                                    ]}
                                >
                                    <Ionicons
                                        name="person"
                                        size={20}
                                        color={palette.textMuted}
                                    />
                                </View>
                            )}
                        </View>
                        {/* Name */}
                        <Text
                            style={[Type.caption, { color: palette.textSecondary, marginTop: 4 }]}
                            numberOfLines={1}
                        >
                            {u.display_name.split(' ')[0]}
                        </Text>
                        {/* Personal avg */}
                        <Text
                            style={[
                                Type.rating,
                                { color: palette.tertiary, fontSize: 14, lineHeight: 18 },
                            ]}
                        >
                            {u.personal_average.toFixed(1)}
                        </Text>
                    </View>
                ))}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingTop: Spacing.xl,
        paddingHorizontal: Spacing.lg,
    },
    scroll: {
        gap: Spacing.lg,
        paddingRight: Spacing.lg,
    },
    item: {
        alignItems: 'center',
        width: AVATAR_SIZE + 12,
    },
    avatarRing: {
        width: AVATAR_SIZE + 4,
        height: AVATAR_SIZE + 4,
        borderRadius: Radius.full,
        borderWidth: 1.5,
        overflow: 'hidden',
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatar: {
        width: AVATAR_SIZE,
        height: AVATAR_SIZE,
        borderRadius: Radius.full,
    },
});
