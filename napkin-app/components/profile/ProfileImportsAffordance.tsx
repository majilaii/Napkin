/**
 * ProfileImportsAffordance — the always-visible imports door in the profile
 * header's self actions row (TICKET-191 rev 2: "access up top, storage in the
 * hub"). Self-only (the caller gates), zero scroll, sits beside the gear.
 *
 * A tray glyph, always rendered; a terracotta badge ONLY when the import slot
 * is attention-bearing — the slot's headline count when it has one (review
 * spot count), else a quiet dot (NotifBell treatment). Calm/idle states show
 * nothing: the icon itself is the standing affordance. Tap → /import-progress
 * (never past the hub).
 */
import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { ImportSlot } from '@/hooks/imports/importSlotUtils';

interface Props {
    /** Live import slot (null when idle). Accent decides the badge; the icon always shows. */
    slot: ImportSlot | null;
}

export function ProfileImportsAffordance({ slot }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    const attention = slot?.accent === 'attention';
    // Only 'review' carries a headline number; the other attention tiers dot.
    const badgeCount = attention && slot?.count != null ? slot.count : null;

    return (
        <Pressable
            onPress={() => router.push('/import-progress')}
            hitSlop={10}
            style={({ pressed }) => [styles.wrap, { opacity: pressed ? 0.6 : 1 }]}
            accessibilityRole="button"
            accessibilityLabel={attention && slot ? `Imports — ${slot.title}` : 'Imports'}
            testID="profile-imports-affordance"
        >
            <Ionicons name="file-tray-outline" size={22} color={palette.text} />
            {attention ? (
                badgeCount != null ? (
                    <View
                        style={[
                            styles.badge,
                            {
                                backgroundColor: palette.primary,
                                borderColor: palette.background,
                            },
                        ]}
                        testID="imports-badge-count"
                    >
                        <Text
                            style={[styles.badgeText, { color: palette.textInverse }]}
                            maxFontSizeMultiplier={1.2}
                        >
                            {badgeCount > 99 ? '99+' : String(badgeCount)}
                        </Text>
                    </View>
                ) : (
                    <View
                        style={[
                            styles.dot,
                            {
                                backgroundColor: palette.primary,
                                borderColor: palette.background,
                            },
                        ]}
                        testID="imports-badge-dot"
                    />
                )
            ) : null}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    // 32pt frame + 10pt hitSlop = a 52pt effective target, matching the
    // NotifBell / gear rhythm in the same row.
    wrap: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
    },
    badge: {
        position: 'absolute',
        top: -2,
        right: -4,
        minWidth: 18,
        height: 18,
        borderRadius: 9,
        borderWidth: 2,
        paddingHorizontal: 3,
        alignItems: 'center',
        justifyContent: 'center',
    },
    badgeText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        lineHeight: 13,
    },
    // Same quiet dot as NotifBell's unread tell.
    dot: {
        position: 'absolute',
        top: 4,
        right: 4,
        width: 9,
        height: 9,
        borderRadius: 4.5,
        borderWidth: 2,
    },
});
