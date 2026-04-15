/**
 * Table Night Detail — full breakdown of a revealed/closed Table Night.
 * Shows per-person overall + category scores (vibe/flavor/service/value).
 */
import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Pressable,
    ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';

import { Colors, Spacing, Radius, Shadow, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    useTableNightStatus,
    type TableNightParticipant,
} from '@/hooks/tables/useTableNight';

type Palette = typeof Colors.light;

const CATEGORY_LABELS = [
    { key: 'vibe_rating' as const, label: 'Vibe', short: 'V' },
    { key: 'flavor_rating' as const, label: 'Flavor', short: 'F' },
    { key: 'service_rating' as const, label: 'Service', short: 'S' },
    { key: 'value_rating' as const, label: 'Value', short: '$' },
];

// ── Screen ─────────────────────────────────────────────────────────────────

export default function TableNightDetailScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();

    const { nightId } = useLocalSearchParams<{ nightId: string }>();
    const { data: nightStatus, isLoading } = useTableNightStatus(nightId);

    if (isLoading || !nightStatus) {
        return (
            <>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={[styles.center, { backgroundColor: palette.background }]}>
                    <ActivityIndicator color={palette.primary} />
                </View>
            </>
        );
    }

    // Overall average from star ratings
    const overallRatings = nightStatus.participants
        .filter((p) => p.rating != null)
        .map((p) => p.rating as number);
    const overallAvg =
        overallRatings.length > 0
            ? overallRatings.reduce((a, b) => a + b, 0) / overallRatings.length
            : null;

    // Category averages
    const categoryAvgs = CATEGORY_LABELS.map(({ key, label }) => {
        const vals = nightStatus.participants
            .filter((p) => p[key] != null)
            .map((p) => p[key] as number);
        return {
            label,
            avg: vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
        };
    });

    const date = new Date(
        nightStatus.revealed_at ?? nightStatus.created_at
    ).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <View style={{ flex: 1, backgroundColor: palette.background }}>
                <ScrollView
                    contentContainerStyle={{
                        paddingBottom: insets.bottom + 40,
                        paddingTop: insets.top + Spacing.md,
                    }}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Top bar */}
                    <View style={styles.topBar}>
                        <Pressable onPress={() => router.back()}>
                            <Text style={[Type.body, { color: palette.primary }]}>← Back</Text>
                        </Pressable>
                    </View>

                    {/* Header */}
                    <View style={styles.headerSection}>
                        <Text style={[Type.labelSmall, { color: palette.textMuted, letterSpacing: 1.5 }]}>
                            Round · {date}
                        </Text>
                        <Text
                            style={[
                                Type.displayLarge,
                                {
                                    color: palette.text,
                                    fontFamily: 'Newsreader_400Regular_Italic',
                                    fontSize: 38,
                                    lineHeight: 42,
                                    marginTop: Spacing.xs,
                                },
                            ]}
                        >
                            {nightStatus.restaurants?.name ?? 'Round'}
                        </Text>
                    </View>

                    {/* Overall Rating + Summary Sentence */}
                    {overallAvg != null && (
                        <View style={{ alignItems: 'center', marginTop: Spacing.lg }}>
                            <View
                                style={[
                                    styles.overallBubble,
                                    { backgroundColor: palette.tertiaryFixed },
                                    Shadow.ambient,
                                ]}
                            >
                                <Text
                                    style={[
                                        Type.ratingLarge,
                                        { color: palette.tertiary, fontSize: 36, lineHeight: 40 },
                                    ]}
                                >
                                    {overallAvg.toFixed(1)}
                                </Text>
                                <Text style={[Type.labelSmall, { color: palette.tertiary, opacity: 0.7 }]}>
                                    Final Average
                                </Text>
                            </View>
                            <SummarySentence overallAvg={overallAvg} categoryAvgs={categoryAvgs} palette={palette} />
                        </View>
                    )}

                    {/* Category Breakdown — table-wide averages */}
                    {categoryAvgs.some((c) => c.avg != null) && (
                        <View style={styles.section}>
                            <SectionLabel palette={palette}>Breakdown</SectionLabel>
                            <View style={styles.breakdownGrid}>
                                {categoryAvgs.map(
                                    ({ label, avg }) =>
                                        avg != null && (
                                            <View
                                                key={label}
                                                style={[
                                                    styles.breakdownCell,
                                                    { backgroundColor: palette.surfaceContainerLow },
                                                ]}
                                            >
                                                <Text
                                                    style={[Type.rating, { color: palette.tertiary, fontSize: 22 }]}
                                                >
                                                    {avg.toFixed(1)}
                                                </Text>
                                                <Text
                                                    style={[Type.labelSmall, { color: palette.textMuted, marginTop: 4 }]}
                                                >
                                                    {label}
                                                </Text>
                                            </View>
                                        )
                                )}
                            </View>
                        </View>
                    )}

                    {/* Who Said What — per-person scores with category breakdown */}
                    <View style={styles.section}>
                        <SectionLabel palette={palette}>Who Said What</SectionLabel>
                        <View style={{ gap: Spacing.md }}>
                            {nightStatus.participants.map((p) => (
                                <ParticipantRow key={p.user_id} participant={p} nightId={nightId!} palette={palette} />
                            ))}
                        </View>
                    </View>

                    {/* Footer */}
                    <View style={styles.section}>
                        <Text
                            style={[
                                Type.bodySmall,
                                { color: palette.textMuted, textAlign: 'center', fontStyle: 'italic' },
                            ]}
                        >
                            {nightStatus.participants.length} people at the table
                        </Text>
                    </View>
                </ScrollView>
            </View>
        </>
    );
}

// ── Components ─────────────────────────────────────────────────────────────

function SectionLabel({ palette, children }: { palette: Palette; children: string }) {
    return (
        <Text style={[Type.label, { color: palette.textSecondary, marginBottom: Spacing.md }]}>
            {children}
        </Text>
    );
}

function SummarySentence({
    overallAvg,
    categoryAvgs,
    palette,
}: {
    overallAvg: number;
    categoryAvgs: { label: string; avg: number | null }[];
    palette: Palette;
}) {
    const withData = categoryAvgs.filter((c) => c.avg != null) as { label: string; avg: number }[];
    if (withData.length === 0) return null;

    const highest = withData.reduce((best, c) => (c.avg > best.avg ? c : best), withData[0]);

    // Check if all categories are within 0.1 of each other (consensus)
    const allTied = withData.every((c) => Math.abs(c.avg - highest.avg) <= 0.1);

    const sentence = allTied
        ? `The table gave this a ${overallAvg.toFixed(1)} across the board.`
        : `The table gave this a ${overallAvg.toFixed(1)}. ${highest.label} was the standout at ${highest.avg.toFixed(1)}.`;

    return (
        <Text
            style={[
                Type.bodySmall,
                {
                    color: palette.textMuted,
                    fontStyle: 'italic',
                    textAlign: 'center',
                    marginTop: Spacing.sm,
                    paddingHorizontal: Spacing.xl,
                },
            ]}
        >
            {sentence}
        </Text>
    );
}

function ParticipantRow({
    participant,
    nightId,
    palette,
}: {
    participant: TableNightParticipant;
    nightId: string;
    palette: Palette;
}) {
    const router = useRouter();
    const name = participant.profiles.display_name;
    const initials = name.split(' ').map((n) => n[0]).join('').slice(0, 2);

    // Waiting state: participant hasn't submitted yet
    const isWaiting = participant.rating === null && !participant.ready;

    const hasCategoryRatings =
        participant.vibe_rating != null ||
        participant.flavor_rating != null ||
        participant.service_rating != null ||
        participant.value_rating != null;

    if (isWaiting) {
        return (
            <View
                style={[
                    styles.participantCard,
                    { backgroundColor: palette.card, opacity: 0.5 },
                    Shadow.subtle,
                ]}
            >
                <View style={styles.participantTop}>
                    <View
                        style={[styles.participantAvatar, { backgroundColor: palette.surfaceContainerHigh }]}
                    >
                        <Text style={{ fontSize: 12, fontFamily: 'Manrope_700Bold', color: palette.textMuted }}>
                            {initials}
                        </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={[Type.titleSmall, { color: palette.textMuted }]}>{name}</Text>
                        <Text
                            style={[
                                Type.bodySmall,
                                { color: palette.textMuted, fontStyle: 'italic', marginTop: 2 },
                            ]}
                        >
                            hasn&apos;t submitted yet
                        </Text>
                    </View>
                </View>
            </View>
        );
    }

    return (
        <Pressable
            onPress={() =>
                router.push({
                    pathname: '/entry-detail',
                    params: { nightId, userId: participant.user_id },
                })
            }
            style={({ pressed }) => [
                styles.participantCard,
                { backgroundColor: palette.card, opacity: pressed ? 0.8 : 1 },
                Shadow.subtle,
            ]}
        >
            {/* Top row: avatar + name + overall score */}
            <View style={styles.participantTop}>
                <View
                    style={[styles.participantAvatar, { backgroundColor: palette.secondaryContainer }]}
                >
                    <Text style={{ fontSize: 12, fontFamily: 'Manrope_700Bold', color: palette.text }}>
                        {initials}
                    </Text>
                </View>
                <View style={{ flex: 1, gap: Spacing.xs }}>
                    <Text style={[Type.titleSmall, { color: palette.text }]}>{name}</Text>
                    {/* Dish chip */}
                    {participant.dish_description ? (
                        <View
                            style={[
                                styles.dishChip,
                                { backgroundColor: palette.tertiaryFixed },
                            ]}
                        >
                            <Text style={[Type.bodySmall, { color: palette.tertiary }]}>
                                {participant.dish_description}
                            </Text>
                        </View>
                    ) : null}
                    {participant.notes ? (
                        <Text
                            style={[
                                Type.bodySmall,
                                { color: palette.textMuted, fontStyle: 'italic' },
                            ]}
                        >
                            &ldquo;{participant.notes}&rdquo;
                        </Text>
                    ) : null}
                </View>
                {participant.rating != null && (
                    <Text style={[Type.rating, { color: palette.tertiary, fontSize: 20 }]}>
                        {participant.rating.toFixed(1)}
                    </Text>
                )}
            </View>

            {/* Category breakdown chips */}
            {hasCategoryRatings && (
                <View style={styles.categoryChips}>
                    {CATEGORY_LABELS.map(({ key, label }) => {
                        const val = participant[key];
                        if (val == null) return null;
                        return (
                            <View
                                key={key}
                                style={[styles.categoryChip, { backgroundColor: palette.surfaceContainerLow }]}
                            >
                                <Text style={[Type.labelSmall, { color: palette.textMuted, fontSize: 9 }]}>
                                    {label}
                                </Text>
                                <Text
                                    style={{
                                        fontSize: 13,
                                        fontFamily: 'Newsreader_400Regular_Italic',
                                        color: palette.tertiary,
                                    }}
                                >
                                    {val.toFixed(1)}
                                </Text>
                            </View>
                        );
                    })}
                </View>
            )}
        </Pressable>
    );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    topBar: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
    headerSection: { paddingHorizontal: Spacing.lg },
    overallBubble: {
        alignItems: 'center',
        paddingHorizontal: Spacing.xl,
        paddingVertical: Spacing.md,
        borderRadius: Radius.xl,
    },
    section: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.xl },

    breakdownGrid: { flexDirection: 'row', gap: Spacing.sm },
    breakdownCell: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: Spacing.md,
        borderRadius: Radius.lg,
    },

    participantCard: {
        padding: Spacing.md,
        borderRadius: Radius.lg,
    },
    participantTop: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
    },
    participantAvatar: {
        width: 44, height: 44, borderRadius: 22,
        alignItems: 'center', justifyContent: 'center',
    },
    categoryChips: {
        flexDirection: 'row',
        gap: Spacing.sm,
        marginTop: Spacing.sm,
        marginLeft: 44 + Spacing.md, // offset past avatar
    },
    categoryChip: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 6,
        borderRadius: Radius.sm,
        gap: 2,
    },
    dishChip: {
        paddingHorizontal: Spacing.sm,
        paddingVertical: 3,
        borderRadius: Radius.sm,
        alignSelf: 'flex-start',
    },
});
