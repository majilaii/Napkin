/**
 * CommunityTab — V4c "Everyone" tab for the restaurant page.
 *
 * Layout (per restaurant-canvas.html V4c):
 *   ┌──────────────────────────────────────────┐
 *   │  [ 4.2  (italic serif)   ★★★★☆    ]       │  rating strip (journal card)
 *   │  [ 12.4k ratings                  ]       │  "From Google" label right
 *   └──────────────────────────────────────────┘
 *      ── Napkin community ──
 *      Cross-Table ratings arrive with Ring 2.
 *      For now, the external read is on the right.
 *      ── Professional takes ──
 *      (empty; will list critics when wired)
 *
 * Doctrine (CLAUDE.md):
 *   - External context (Google) is shown as a sibling signal.
 *   - Never merged with Napkin numbers.
 *   - Never computed as a cross-Table aggregate.
 * The V4c "Napkin community" histogram is deferred until Ring 2 ships;
 * we render an honest placeholder in its slot.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { InlineStars } from '@/components/feed/InlineStars';

type Palette = typeof Colors.light;

interface Props {
    googleRating: number | null;
    googleRatingCount: number | null;
}

function formatCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
    return `${n}`;
}

export function CommunityTab({ googleRating, googleRatingCount }: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;

    const hasGoogle = googleRating != null;
    const countLabel = googleRatingCount
        ? `${formatCount(googleRatingCount)} ratings`
        : '';

    return (
        <View style={styles.container}>
            {/* ── Rating strip ── */}
            {hasGoogle ? (
                <View
                    style={[
                        styles.strip,
                        { backgroundColor: palette.surfaceJournal },
                    ]}
                >
                    <View style={styles.stripLeft}>
                        <Text
                            style={[
                                styles.scoreNumber,
                                { color: palette.text },
                            ]}
                        >
                            {googleRating!.toFixed(1)}
                        </Text>
                        {countLabel ? (
                            <Text
                                style={[
                                    styles.countLabel,
                                    { color: palette.textMuted },
                                ]}
                                numberOfLines={1}
                            >
                                {countLabel}
                            </Text>
                        ) : null}
                    </View>

                    <View style={styles.stripMiddle}>
                        <InlineStars
                            value={googleRating!}
                            size={14}
                            color={palette.star}
                        />
                    </View>

                    <View style={styles.stripRight}>
                        <Text
                            style={[
                                styles.stripCaptionAccent,
                                { color: palette.primary },
                            ]}
                        >
                            From
                        </Text>
                        <Text
                            style={[
                                styles.stripCaption,
                                { color: palette.textMuted },
                            ]}
                        >
                            Google
                        </Text>
                    </View>
                </View>
            ) : (
                <View
                    style={[
                        styles.emptyStrip,
                        { backgroundColor: palette.surfaceJournal },
                    ]}
                >
                    <Text
                        style={[
                            styles.emptyStripText,
                            { color: palette.textMuted },
                        ]}
                    >
                        No external ratings on file yet.
                    </Text>
                </View>
            )}

            {/* ── Napkin community (future) ── */}
            <View style={styles.divider}>
                <View
                    style={[
                        styles.dividerRule,
                        { backgroundColor: palette.ruleInkSoft },
                    ]}
                />
                <Text
                    style={[
                        styles.dividerLabel,
                        { color: palette.textMuted },
                    ]}
                >
                    Napkin community
                </Text>
                <View
                    style={[
                        styles.dividerRule,
                        { backgroundColor: palette.ruleInkSoft },
                    ]}
                />
            </View>

            <Text
                style={[
                    styles.bodyNote,
                    { color: palette.textSecondary },
                ]}
            >
                Cross-Table ratings — filterable by solo diners, date nights, or
                tables like yours — arrive with Ring 2.
            </Text>

            {/* ── Professional takes (future) ── */}
            <View style={[styles.divider, { marginTop: Spacing.lg }]}>
                <View
                    style={[
                        styles.dividerRule,
                        { backgroundColor: palette.ruleInkSoft },
                    ]}
                />
                <Text
                    style={[
                        styles.dividerLabel,
                        { color: palette.textMuted },
                    ]}
                >
                    Professional takes
                </Text>
                <View
                    style={[
                        styles.dividerRule,
                        { backgroundColor: palette.ruleInkSoft },
                    ]}
                />
            </View>

            <Text
                style={[
                    styles.bodyNote,
                    { color: palette.textSecondary },
                ]}
            >
                Critic reviews — NYT, Infatuation, Eater — will collect here.
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: 22,
        paddingTop: 16,
    },
    strip: {
        padding: 14,
        borderRadius: Radius.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        marginBottom: 18,
    },
    stripLeft: {
        alignItems: 'flex-start',
    },
    scoreNumber: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 30,
        lineHeight: 30,
        letterSpacing: -0.6,
    },
    countLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 9,
        letterSpacing: 0.3,
        marginTop: 5,
    },
    stripMiddle: {
        flex: 1,
        alignItems: 'flex-start',
    },
    stripRight: {
        alignItems: 'flex-end',
    },
    stripCaptionAccent: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 0.3,
        textTransform: 'uppercase',
    },
    stripCaption: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 0.3,
        textTransform: 'uppercase',
    },
    emptyStrip: {
        padding: 18,
        borderRadius: Radius.md,
        marginBottom: 18,
    },
    emptyStripText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
        textAlign: 'center',
    },
    divider: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginTop: 8,
        marginBottom: 12,
    },
    dividerRule: {
        flex: 1,
        height: StyleSheet.hairlineWidth,
    },
    dividerLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
    },
    bodyNote: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
        lineHeight: 21,
        textAlign: 'center',
        paddingHorizontal: 8,
    },
});
