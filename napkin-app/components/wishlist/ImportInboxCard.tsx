/**
 * ImportInboxCard — the single "imports to sort" inbox at the top of the Pinned
 * list (Heirloom redesign). Consolidates the old in-flight band + recently-
 * imported band into one quiet note: a terracotta sparkle tile, a title, a
 * provenance/time sublabel, and a chevron. Tapping routes to the existing import
 * surfaces (progress hub / batch detail).
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Shadow } from '@/constants/theme';

interface Props {
    title: string;
    sublabel: string;
    palette: typeof Colors.light;
    onPress: () => void;
    iconName?: keyof typeof Ionicons.glyphMap;
}

export function ImportInboxCard({ title, sublabel, palette, onPress, iconName = 'sparkles-outline' }: Props) {
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.card,
                Shadow.note,
                { backgroundColor: palette.surfaceNote, opacity: pressed ? 0.85 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={title}
        >
            <View style={[styles.tile, { backgroundColor: palette.primaryMuted }]}>
                <Ionicons name={iconName} size={20} color={palette.primary} />
            </View>
            <View style={styles.textBlock}>
                <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
                    {title}
                </Text>
                <Text style={[styles.sub, { color: palette.textMuted }]} numberOfLines={1}>
                    {sublabel}
                </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 13,
        borderRadius: Radius.lg,
        paddingHorizontal: 15,
        paddingVertical: 13,
        marginTop: 6,
        marginBottom: 6,
    },
    tile: {
        width: 40,
        height: 40,
        borderRadius: Radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    textBlock: {
        flex: 1,
        minWidth: 0,
    },
    title: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 14,
    },
    sub: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        marginTop: 2,
    },
});
