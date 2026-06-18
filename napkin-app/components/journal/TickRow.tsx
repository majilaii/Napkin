/**
 * TickRow — the atomic unit of the journal feed.
 *
 * Canvas spec: amber italic 17 rating · middle-dot · italic serif 17 restaurant name
 *              · sans 12 muted city · flex spacer · sans 12 muted weekday
 *
 * Used on: Journal tab (entries without body), restaurant history,
 *          and any date-grouped list where the entry earns only a tick.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export interface TickRowProps {
    rating: number | null;
    restaurantName: string;
    city?: string | null;
    /** Shared to a Table/Round — subtle people-outline glyph before the weekday. */
    shared?: boolean;
    weekday?: string;          // "tue", "sat 23", etc.
    onPress?: () => void;
}

export function TickRow({
    rating,
    restaurantName,
    city,
    shared,
    weekday,
    onPress,
}: TickRowProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const content = (
        <View style={styles.row}>
            {/* Amber italic rating */}
            {rating != null && (
                <>
                    <Text style={[styles.rating, { color: palette.amberBright }]}>
                        {rating % 1 === 0 ? `${rating}.0` : `${rating}`}
                    </Text>
                    <Text style={[styles.dot, { color: palette.textMuted }]}>·</Text>
                </>
            )}

            {/* Italic serif restaurant name */}
            <Text
                style={[styles.name, { color: palette.text }]}
                numberOfLines={1}
                ellipsizeMode="tail"
            >
                {restaurantName}
            </Text>

            {/* City — sans 12 muted */}
            {city ? (
                <>
                    <Text style={[styles.dot, { color: palette.textMuted }]}>·</Text>
                    <Text
                        style={[styles.city, { color: palette.textMuted }]}
                        numberOfLines={1}
                    >
                        {city}
                    </Text>
                </>
            ) : null}

            {/* Spacer */}
            <View style={{ flex: 1 }} />

            {/* Shared-to-a-Table glyph */}
            {shared ? (
                <Ionicons
                    name="people-outline"
                    size={13}
                    color={palette.textMuted}
                    style={styles.sharedGlyph}
                    accessibilityLabel="shared to a table"
                />
            ) : null}

            {/* Weekday */}
            {weekday ? (
                <Text style={[styles.weekday, { color: palette.textMuted }]}>{weekday}</Text>
            ) : null}
        </View>
    );

    if (onPress) {
        return (
            <Pressable
                onPress={onPress}
                style={({ pressed }) => pressed ? { opacity: 0.7 } : undefined}
                accessibilityRole="button"
            >
                {content}
            </Pressable>
        );
    }
    return content;
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 8,
        paddingVertical: Spacing.sm + 1,
        paddingHorizontal: Spacing.lg,
    },
    rating: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 17,
        lineHeight: 22,
    },
    dot: {
        fontSize: 12,
        lineHeight: 18,
    },
    name: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 17,
        lineHeight: 22,
        flexShrink: 1,
    },
    city: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        flexShrink: 2,
    },
    weekday: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        flexShrink: 0,
    },
    sharedGlyph: {
        alignSelf: 'center',
        marginRight: 2,
    },
});
