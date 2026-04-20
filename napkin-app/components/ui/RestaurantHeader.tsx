/**
 * RestaurantHeader — 48px rounded thumbnail + italic-serif name + uppercase meta.
 *
 * Heirloom kit: the header block that sits at the top of every logger surface.
 * Replaces the old "locked chip" / "selected place" rows in FastLogForm and
 * create-entry.
 *
 * - Thumbnail: 48×48, radius 4 (scrapbook-clip). Falls back to surfaceJournalHi fill
 *   when `photoUrl` is missing. Optional trailing lock icon for locked restaurants.
 * - Name: Newsreader italic 20px weight 500, lineHeight 22.
 * - Meta: Manrope 12px uppercase tracked (textMuted).
 *
 * Pressable when `onPress` provided (used to clear a selected place). Otherwise
 * renders as a static View.
 */
import React from 'react';
import { View, Text, Pressable, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface RestaurantHeaderProps {
    name: string;
    /** Meta row — e.g. "Italian · Greenwich Village" or "Dinner · Tue Apr 14" */
    meta?: string;
    /** Remote photo URL. When absent, a warm cream tile renders instead. */
    photoUrl?: string | null;
    /** When true, renders a lock-closed glyph after the name (used for locked restaurants). */
    locked?: boolean;
    /** Optional clear action — renders a trailing ✕. Receives no args. */
    onClear?: () => void;
    /** Pressable wrap — used when the whole row should be tappable (e.g. clear chip). */
    onPress?: () => void;
}

export function RestaurantHeader({
    name,
    meta,
    photoUrl,
    locked = false,
    onClear,
    onPress,
}: RestaurantHeaderProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const body = (
        <View style={styles.row}>
            <View
                style={[
                    styles.thumb,
                    { backgroundColor: palette.surfaceContainerHigh },
                ]}
            >
                {photoUrl ? (
                    <Image source={{ uri: photoUrl }} style={styles.thumbImage} />
                ) : null}
            </View>
            <View style={styles.textWrap}>
                <View style={styles.nameRow}>
                    <Text
                        style={{
                            fontFamily: 'Newsreader_400Regular_Italic',
                            fontSize: 20,
                            color: palette.text,
                            lineHeight: 22,
                            flexShrink: 1,
                        }}
                        numberOfLines={1}
                    >
                        {name}
                    </Text>
                    {locked ? (
                        <Ionicons
                            name="lock-closed-outline"
                            size={13}
                            color={palette.textMuted}
                            style={styles.lockIcon}
                        />
                    ) : null}
                </View>
                {meta ? (
                    <Text
                        style={{
                            fontFamily: 'Manrope_500Medium',
                            fontSize: 12,
                            color: palette.textMuted,
                            letterSpacing: 0.4,
                            textTransform: 'uppercase',
                            marginTop: Spacing.xs,
                        }}
                        numberOfLines={1}
                    >
                        {meta}
                    </Text>
                ) : null}
            </View>
            {onClear ? (
                <Pressable onPress={onClear} hitSlop={12} style={styles.clearBtn}>
                    <Text style={{ fontSize: 16, color: palette.textMuted }}>✕</Text>
                </Pressable>
            ) : null}
        </View>
    );

    if (onPress) {
        return (
            <Pressable
                onPress={onPress}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
                {body}
            </Pressable>
        );
    }
    return body;
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md - 4,
    },
    thumb: {
        width: 48,
        height: 48,
        borderRadius: Radius.sm,
        overflow: 'hidden',
        flexShrink: 0,
    },
    thumbImage: {
        width: '100%',
        height: '100%',
    },
    textWrap: {
        flex: 1,
        minWidth: 0,
    },
    nameRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    lockIcon: {
        marginLeft: Spacing.xs,
    },
    clearBtn: {
        paddingHorizontal: Spacing.sm,
        paddingVertical: Spacing.xs,
    },
});
