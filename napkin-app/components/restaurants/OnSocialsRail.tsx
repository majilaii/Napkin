/**
 * OnSocialsRail — the "ON SOCIALS" rail on the restaurant page (TICKET-156).
 *
 * A single horizontal rail of your circle's (and, via TICKET-155, strangers')
 * social clippings — the TikTok/Reel a saver clipped this place from — as compact
 * press-clipping cards on cream, tapping out to the original video.
 *
 * Self-hides entirely when empty (return null — no header, no rule, no skeleton).
 * Header copy is "ON SOCIALS" alone, in the shared hairline-flanked uppercase
 * Manrope band grammar.
 */
import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ClippingCard, type ClippingCardData } from './ClippingCard';

interface Props {
    clippings: ClippingCardData[];
}

export function OnSocialsRail({ clippings }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    // Empty → hidden (AC): no header, no rule, no skeleton.
    if (!clippings || clippings.length === 0) return null;

    return (
        <View style={styles.band}>
            {/* Section header: hairline · "ON SOCIALS" · hairline (shared band grammar) */}
            <View style={styles.headerRow}>
                <View style={[styles.headerRule, { backgroundColor: palette.ruleInkSoft }]} />
                <Text
                    style={[styles.headerLabel, { color: palette.textMuted }]}
                    accessibilityRole="header"
                >
                    ON SOCIALS
                </Text>
                <View style={[styles.headerRule, { backgroundColor: palette.ruleInkSoft }]} />
            </View>

            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.rail}
            >
                {clippings.map((clip, i) => (
                    <ClippingCard key={`${clip.saver.user_id}-${clip.created_at}-${i}`} clip={clip} />
                ))}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    band: {
        paddingBottom: Spacing.md,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        marginBottom: Spacing.md,
        paddingHorizontal: 22,
    },
    headerRule: {
        flex: 1,
        height: 1,
    },
    headerLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        lineHeight: 15,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
    },
    rail: {
        flexDirection: 'row',
        gap: 12,
        paddingHorizontal: 22,
    },
});
