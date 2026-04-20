/**
 * ActiveGatherBanner — "Where are we eating?" live-vote banner for an
 * active round. Canvas WF4.
 *
 * Sits at the top of the Tables feed when there's a round in rating.
 * Shows up to three candidate restaurants as vote bars + a CTA to
 * cast your vote (leading to the live round screen).
 *
 * Since the current schema doesn't model pre-meal restaurant voting,
 * we derive a proxy view: the restaurant of the active round is the
 * leader; candidates 2 and 3 are placeholders pulled from
 * `candidateLabels` (passed by the caller — e.g. recent table pins).
 */

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Colors, Spacing } from '@/constants/theme';
import { PulseDot } from '@/components/feed/PulseDot';

type Palette = typeof Colors.light;

export interface GatherCandidate {
    name: string;
    pct: number;
    leading?: boolean;
}

interface ActiveGatherBannerProps {
    when: string; // e.g. "Fri 7:30pm" or "Tonight"
    leaderBy?: string; // "Tatiana leads"
    votedCount: number;
    totalCount: number;
    candidates: GatherCandidate[];
    onCastVote: () => void;
    palette: Palette;
}

export function ActiveGatherBanner({
    when,
    leaderBy,
    votedCount,
    totalCount,
    candidates,
    onCastVote,
    palette,
}: ActiveGatherBannerProps) {
    return (
        <View
            style={[
                styles.container,
                {
                    backgroundColor: palette.surfaceNote,
                    shadowColor: palette.text,
                },
            ]}
        >
            <View style={styles.kickerRow}>
                <PulseDot size={8} color={palette.primary} />
                <Text style={[styles.kicker, { color: palette.primary }]}>
                    {`GATHERING \u00B7 ${when.toUpperCase()}`}
                </Text>
            </View>

            <Text style={[styles.headline, { color: palette.text }]}>
                Where are we eating?
            </Text>

            <Text style={[styles.sub, { color: palette.textSecondary }]}>
                {leaderBy ? (
                    <>
                        <Text style={styles.subItalic}>{leaderBy}</Text>
                        {` \u00B7 `}
                    </>
                ) : null}
                {votedCount} of {totalCount} have voted
            </Text>

            <View style={styles.bars}>
                {candidates.slice(0, 3).map((c, i) => (
                    <View key={i} style={styles.barRow}>
                        <View
                            style={[
                                styles.barTrack,
                                { backgroundColor: palette.surfaceJournalHi },
                            ]}
                        >
                            <View
                                style={[
                                    styles.barFill,
                                    {
                                        width: `${Math.max(4, Math.min(100, c.pct))}%`,
                                        backgroundColor: c.leading
                                            ? palette.primary
                                            : palette.secondary,
                                    },
                                ]}
                            />
                        </View>
                        <Text
                            style={[
                                styles.barLabel,
                                {
                                    color: c.leading
                                        ? palette.text
                                        : palette.textSecondary,
                                    fontFamily: c.leading
                                        ? 'Newsreader_600SemiBold_Italic'
                                        : 'Newsreader_400Regular_Italic',
                                },
                            ]}
                            numberOfLines={1}
                        >
                            {c.name}
                        </Text>
                    </View>
                ))}
            </View>

            <Pressable
                onPress={onCastVote}
                style={({ pressed }) => [
                    styles.cta,
                    {
                        backgroundColor: palette.text,
                        opacity: pressed ? 0.88 : 1,
                    },
                ]}
            >
                <Text style={[styles.ctaText, { color: palette.background }]}>
                    CAST YOUR VOTE
                </Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginHorizontal: 22,
        marginBottom: Spacing.lg,
        marginTop: Spacing.xs,
        padding: 18,
        borderRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.03,
        shadowRadius: 30,
        elevation: 2,
    },
    kickerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 10,
    },
    kicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 1.2,
    },
    headline: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 19,
        lineHeight: 23,
        letterSpacing: -0.2,
        marginBottom: 3,
    },
    sub: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 12,
        marginBottom: 12,
    },
    subItalic: {
        fontFamily: 'Newsreader_400Regular_Italic',
    },
    bars: {
        gap: 7,
        marginBottom: 12,
    },
    barRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    barTrack: {
        flex: 1,
        height: 3,
        borderRadius: 99,
        overflow: 'hidden',
    },
    barFill: {
        height: '100%',
    },
    barLabel: {
        minWidth: 72,
        textAlign: 'right',
        fontSize: 12,
    },
    cta: {
        paddingVertical: 10,
        borderRadius: 999,
        alignItems: 'center',
    },
    ctaText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 0.8,
    },
});
