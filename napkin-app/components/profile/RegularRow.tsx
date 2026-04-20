/**
 * RegularRow — used inside app/regulars.tsx.
 * TICKET-025
 *
 * 56px thumb + name + city + last visit + avg rating + ×N in terracotta.
 * Matches canvas Artboard 5.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

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
        <View style={[styles.container, { borderBottomColor: palette.dividerSoft }]}>
            {/* Thumb */}
            <View style={[styles.thumb, { backgroundColor: palette.surfaceContainerHigh }]} />

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
        </View>
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
    },
    content: {
        flex: 1,
        minWidth: 0,
    },
});
