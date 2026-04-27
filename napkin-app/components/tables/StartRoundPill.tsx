/**
 * StartRoundPill — quiet CTA to start a Round from within a Table page.
 *
 * Placement: between TableHeader/WelcomeBanner and the Activity|Wishlist|Atlas
 * tab strip. Rendered only when the Activity tab is active, the Table is social
 * (not personal), has ≥2 members, and has no active Round in progress.
 *
 * Visibility predicate lives in tables.tsx (showStartRoundPill).
 * This component is purely presentational — no data, no internal state.
 *
 * Visual grammar: warm-paper pill (surfaceContainerHigh), left-aligned,
 * italic Newsreader label, small terracotta add-circle-outline icon,
 * ambient shadow only. Mirrors EmptyChairInvitation shadow pattern.
 */

import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Shadow } from '@/constants/theme';

type Palette = typeof Colors.light;

interface StartRoundPillProps {
    palette: Palette;
    onPress: () => void;
    accessibilityLabel: string; // e.g. "Start a round at Sunday Roast Club"
}

export function StartRoundPill({ palette, onPress, accessibilityLabel }: StartRoundPillProps) {
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            style={({ pressed }) => [
                styles.pill,
                {
                    backgroundColor: palette.surfaceContainerHigh,
                    opacity: pressed ? 0.85 : 1,
                },
            ]}
        >
            <Ionicons
                name="add-circle-outline"
                size={16}
                color={palette.primary}
            />
            <Text style={[styles.label, { color: palette.text }]}>
                start a round
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',      // left-aligned, sized to content
        height: 40,
        paddingHorizontal: 18,
        borderRadius: 999,
        marginHorizontal: 22,         // align with TableHeader's paddingHorizontal: 22
        marginTop: 12,                // 12pt above (separates from TableHeader's 14pt bottom padding)
        marginBottom: 14,             // 14pt below (separates from tab strip)
        gap: 6,
        ...Shadow.ambient,
    },
    label: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
        letterSpacing: -0.1,          // mild optical tightening for italic serif at 15pt
    },
});
