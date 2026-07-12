/**
 * DiaryRow — used inside app/diary.tsx.
 * TICKET-025
 *
 * Day/weekday left rail + optional photo thumb + restaurant name + rating.
 * Dates and names use upright editorial type; italic is reserved for the rating.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';

import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Rating } from './Rating';
import type { DiaryEntryRow } from '@/hooks/users/useUserProfile';

interface Props {
    entry: DiaryEntryRow;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function DiaryRow({ entry }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    const d = new Date(entry.visited_at ?? entry.created_at);
    const day = d.getDate();
    const weekday = DAYS[d.getDay()];

    return (
        <Pressable
            onPress={() => router.push({ pathname: '/entry-detail', params: { entryId: entry.entry_id } })}
            style={({ pressed }) => [styles.container, { borderBottomColor: palette.dividerSoft, opacity: pressed ? 0.92 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel={`View entry for ${entry.restaurant_name}`}
        >
            {/* Day rail */}
            <View style={styles.dayRail}>
                <Text
                    style={[Type.editorialTitle, { color: palette.text }]}
                >
                    {day}
                </Text>
                <Text style={[Type.labelSmall, { color: palette.textMuted, marginTop: 2 }]}>
                    {weekday}
                </Text>
            </View>

            {/* Photo thumb — only if photo_url present */}
            {entry.photo_url ? (
                <View style={[styles.thumb, { backgroundColor: palette.surfaceContainerHigh }]}>
                    <Image
                        source={{ uri: entry.photo_url }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        transition={150}
                    />
                </View>
            ) : null}

            {/* Restaurant + metadata */}
            <View style={styles.content}>
                <Text
                    style={[Type.editorialBody, { color: palette.text }]}
                    numberOfLines={1}
                >
                    {entry.restaurant_name}
                </Text>
                {entry.city && (
                    <Text style={[Type.metadata, { color: palette.textMuted, marginTop: 2 }]}>
                        {entry.city}
                    </Text>
                )}
            </View>

            {/* Rating */}
            {entry.rating != null && (
                <Rating value={entry.rating} />
            )}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        paddingVertical: 10,
        borderBottomWidth: 1,
        gap: 14,
    },
    dayRail: {
        width: 36,
        alignItems: 'center',
        flexShrink: 0,
    },
    thumb: {
        width: 40,
        height: 40,
        borderRadius: Radius.sm,
        flexShrink: 0,
        overflow: 'hidden',
    },
    content: {
        flex: 1,
        minWidth: 0,
    },
});
