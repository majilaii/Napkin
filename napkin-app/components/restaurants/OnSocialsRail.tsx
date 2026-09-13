/**
 * OnSocialsRail — the "ON SOCIALS" rail on the restaurant page (TICKET-156).
 *
 * Source notes from the existing visibility-gated feed. A small vertical stack
 * keeps platform, creator, and tap-through legible when no thumbnail exists.
 *
 * Self-hides entirely when empty (return null — no header, no rule, no skeleton).
 * Header copy is "ON SOCIALS" alone, in the restaurant page's left-kicker
 * SectionHeading grammar.
 */
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';

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
    const [expanded, setExpanded] = useState(false);

    // Empty → hidden (AC): no header, no rule, no skeleton.
    if (!clippings || clippings.length === 0) return null;

    return (
        <View style={styles.band}>
            <View style={styles.heading}>
                <SectionHeading
                    label="ON SOCIALS"
                    action={clippings.length > 3 ? expanded ? 'show less' : `all ${clippings.length} clips ›` : undefined}
                    onAction={() => setExpanded((value) => !value)}
                    palette={palette}
                />
            </View>

            <View style={styles.rail}>
                {(expanded ? clippings : clippings.slice(0, 3)).map((clip, i) => (
                    <ClippingCard key={`${clip.saver.user_id}-${clip.source.url ?? clip.created_at}-${i}`} clip={clip} />
                ))}
            </View>
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
        gap: Spacing.sm,
        paddingHorizontal: Spacing.restaurant.pageGutter,
    },
});
