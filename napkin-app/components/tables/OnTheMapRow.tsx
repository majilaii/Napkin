/**
 * OnTheMapRow — the Table tab's one doorway to the map (TICKET-238).
 *
 * The Table stopped keeping a map of its own: this row pushes the scoped Places
 * screen (`/places-scope?scope=table&tableId=…`, TICKET-237) and back lands
 * here. Deliberately count-free — a meta line would mean mounting the wishlist
 * and map-pins queries on the Activity pane, and the Activity pane pays for no
 * queries it does not render.
 *
 * Purely presentational; the Tables screen supplies the handler.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, IconSize, Radius, Spacing, Type } from '@/constants/theme';

type Palette = typeof Colors.light;

export interface OnTheMapRowProps {
    onPress: () => void;
    palette: Palette;
}

export function OnTheMapRow({ onPress, palette }: OnTheMapRowProps) {
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel="on the map"
            style={({ pressed }) => [
                styles.row,
                { backgroundColor: palette.surfaceJournalLow },
                pressed && styles.pressed,
            ]}
        >
            <Ionicons name="map-outline" size={IconSize.lg} color={palette.primary} />
            <View style={styles.copy}>
                <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
                    on the map
                </Text>
            </View>
            <Ionicons
                name="chevron-forward-outline"
                size={IconSize.sm + 1}
                color={palette.textFaint}
            />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm + Spacing.xs,
        marginHorizontal: Spacing.pageGutter,
        marginTop: Spacing.restaurant.cardHorizontal,
        paddingHorizontal: Spacing.restaurant.cardHorizontal,
        paddingVertical: Spacing.md - Spacing.xs,
        borderRadius: Radius.lg,
    },
    pressed: {
        opacity: 0.64,
    },
    copy: {
        flex: 1,
    },
    title: {
        ...Type.feedNoteRestaurant,
    },
});
