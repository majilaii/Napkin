/**
 * RegularRow — used inside app/regulars.tsx.
 * TICKET-025
 *
 * 56px thumb + name + city + last visit + avg rating + ×N in terracotta.
 * Matches canvas Artboard 5.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';

import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Rating } from './Rating';
import type { RegularSummary } from '@/hooks/users/useUserProfile';

interface Props {
    regular: RegularSummary;
}

export function RegularRow({ regular }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    const formatLastVisit = (ts: string | null): string => {
        if (!ts) return '';
        const d = new Date(ts);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    const subtitle = [
        regular.city,
        regular.last_visited_at ? `last ${formatLastVisit(regular.last_visited_at)}` : null,
    ]
        .filter(Boolean)
        .join(' · ');

    return (
        <Pressable
            onPress={() => router.push(`/restaurant/${regular.restaurant_id}` as any)}
            style={({ pressed }) => [styles.container, { borderBottomColor: palette.dividerSoft, opacity: pressed ? 0.92 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel={`View ${regular.name}`}
        >
            {/* Thumb — user's own entry photo, else a quiet monogram (no restaurant photos). */}
            <View style={[styles.thumb, { backgroundColor: regular.photo_url ? palette.surfaceContainerHigh : palette.surfaceJournalLow }]}>
                {regular.photo_url ? (
                    <Image
                        source={{ uri: regular.photo_url }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        transition={150}
                    />
                ) : (
                    <View style={styles.monogram}>
                        <Text
                            style={{
                                fontFamily: 'Newsreader_400Regular_Italic',
                                fontSize: 22,
                                color: palette.textMuted,
                            }}
                        >
                            {regular.name?.trim()?.charAt(0)?.toUpperCase() ?? ''}
                        </Text>
                    </View>
                )}
            </View>

            {/* Details */}
            <View style={styles.content}>
                <Text
                    style={{
                        fontFamily: 'Newsreader_400Regular_Italic',
                        fontSize: 16,
                        color: palette.text,
                        lineHeight: 20,
                    }}
                    numberOfLines={1}
                >
                    {regular.name}
                </Text>
                {subtitle ? (
                    <Text style={[Type.caption, { color: palette.textMuted, marginTop: 2, fontSize: 11, letterSpacing: 0.2 }]}>
                        {subtitle}
                    </Text>
                ) : null}
                {regular.avg_rating != null && (
                    <View style={{ marginTop: 4 }}>
                        <Rating value={regular.avg_rating} size={11} />
                    </View>
                )}
            </View>

            {/* ×N visit count in terracotta */}
            <Text
                style={{
                    fontFamily: 'Newsreader_400Regular_Italic',
                    fontSize: 24,
                    fontWeight: '500',
                    color: palette.primary,
                    flexShrink: 0,
                }}
            >
                {`×${regular.visit_count}`}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        paddingVertical: 12,
        borderBottomWidth: 1,
        gap: 14,
    },
    thumb: {
        width: 56,
        height: 56,
        borderRadius: Radius.sm,
        flexShrink: 0,
        overflow: 'hidden',
    },
    monogram: {
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
    },
    content: {
        flex: 1,
        minWidth: 0,
    },
});
