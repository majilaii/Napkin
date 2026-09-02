/**
 * OnSocialsRail — the "ON SOCIALS" rail on the restaurant page (TICKET-156).
 *
 * A single horizontal rail of your circle's (and, via TICKET-155, strangers')
 * social clippings — the TikTok/Reel a saver clipped this place from — as compact
 * press-clipping cards on cream, tapping out to the original video.
 *
 * Self-hides entirely when empty (return null — no header, no rule, no skeleton).
 * Header copy is "ON SOCIALS" alone, in the restaurant page's left-kicker
 * SectionHeading grammar.
 */
import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ClippingCard, type ClippingCardData } from './ClippingCard';
import { SectionHeading } from './RestaurantPageV3';

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
            <View style={styles.heading}>
                <SectionHeading label="ON SOCIALS" palette={palette} />
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
        marginTop: Spacing.restaurant.sectionGap,
        paddingBottom: Spacing.md,
    },
    heading: {
        paddingHorizontal: Spacing.restaurant.pageGutter,
    },
    rail: {
        flexDirection: 'row',
        gap: Spacing.restaurant.listChipHorizontal,
        paddingHorizontal: Spacing.restaurant.pageGutter,
    },
});
