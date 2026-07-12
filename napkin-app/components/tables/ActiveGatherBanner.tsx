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
import { Colors, Shadow, Spacing, Type } from '@/constants/theme';
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
                Shadow.note,
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
                        <Text>{leaderBy}</Text>
                        {` \u00B7 `}
                    </>
                ) : null}
                {votedCount} of {totalCount} have voted
            </Text>

            <View style={styles.bars}>
                {candidates.slice(0, 3).map((c, i) => (
                    <View key={i} style={styles.barRow}>
                        <Text
                            style={[
                                styles.barLabel,
                                {
                                    color: c.leading
                                        ? palette.text
                                        : palette.textSecondary,
                                    fontFamily: c.leading
                                        ? 'Newsreader_600SemiBold'
                                        : 'Newsreader_400Regular',
                                },
                            ]}
                        >
                            {c.name}
                        </Text>
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
                accessibilityRole="button"
                accessibilityLabel="Cast your vote"
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
    },
    kickerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 10,
    },
    kicker: {
        ...Type.sectionKicker,
    },
    headline: {
        ...Type.sectionTitle,
        marginBottom: 3,
    },
    sub: {
        ...Type.metadata,
        marginBottom: 12,
    },
    bars: {
        gap: 7,
        marginBottom: 12,
    },
    barRow: {
        gap: 4,
    },
    barTrack: {
        width: '100%',
        height: 4,
        borderRadius: 99,
        overflow: 'hidden',
    },
    barFill: {
        height: '100%',
    },
    barLabel: {
        ...Type.editorialBody,
    },
    cta: {
        minHeight: 44,
        paddingVertical: Spacing.sm,
        paddingHorizontal: Spacing.md,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
    },
    ctaText: {
        ...Type.label,
    },
});
