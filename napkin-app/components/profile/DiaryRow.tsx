/**
 * DiaryRow — used inside app/diary.tsx.
 * TICKET-025
 *
 * Day/weekday left rail + optional photo thumb + restaurant name + rating.
 * Matches canvas Artboard 4.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

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

    const d = new Date(entry.visited_at ?? entry.created_at);
    const day = d.getDate();
    const weekday = DAYS[d.getDay()];

    return (
        <View style={[styles.container, { borderBottomColor: palette.dividerSoft }]}>
            {/* Day rail */}
            <View style={styles.dayRail}>
                <Text
                    style={{
                        fontFamily: 'Newsreader_400Regular_Italic',
                        fontSize: 22,
                        fontWeight: '500',
                        color: palette.text,
                        lineHeight: 24,
                    }}
                >
                    {day}
                </Text>
                <Text style={[Type.labelSmall, { color: palette.textMuted, marginTop: 2 }]}>
                    {weekday}
                </Text>
            </View>

            {/* Photo thumb — only if photo_url present */}
            {entry.photo_url ? (
                <View style={[styles.thumb, { backgroundColor: palette.surfaceContainerHigh }]} />
            ) : null}

            {/* Restaurant + metadata */}
            <View style={styles.content}>
                <Text
                    style={{
                        fontFamily: 'Newsreader_400Regular_Italic',
                        fontSize: 15,
                        color: palette.text,
                        lineHeight: 19,
                    }}
                    numberOfLines={1}
                >
                    {entry.restaurant_name}
                </Text>
                {entry.city && (
                    <Text style={[Type.caption, { color: palette.textMuted, marginTop: 2, fontSize: 10 }]}>
                        {entry.city}
                    </Text>
                )}
            </View>

            {/* Rating */}
            {entry.rating != null && (
                <Rating value={entry.rating} size={12} />
            )}
        </View>
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
    },
    content: {
        flex: 1,
        minWidth: 0,
    },
});
