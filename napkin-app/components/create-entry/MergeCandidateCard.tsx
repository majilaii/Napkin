/**
 * MergeCandidateCard — in-flow "same visit?" card for Trigger B.
 *
 * Shown inside the compose sheet when another Table member has logged
 * the same restaurant on the same day (±18h window). TICKET-044.
 *
 * Layout:
 *   [Avatar 36px] [Italic serif "Name logged this last night · 4.8★"]
 *   [Manrope body] "Same visit? Two voices become a round."
 *   [merge] (terracotta primary)   [separate] (muted text)
 *
 * Design rules (Heirloom Journal):
 *   - Warm-paper background (#faf0e0 = surfaceJournalLow)
 *   - Ghosted warm rule top (not 1px solid border)
 *   - Italic Newsreader for name + rating line
 *   - Manrope for body + CTA labels
 *   - Terracotta for primary CTA only
 *   - No emoji in chrome
 *   - Copy: lowercase past-tense verbs ("logged", "merge", "separate")
 *   - Relative time ("last night", "2 days ago") from candidate's visited_at
 */
import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    Pressable,
    Image,
} from 'react-native';
import { Colors } from '@/constants/theme';
import type { MergeCandidate } from '@/hooks/rounds/useMergeCandidate';

// ── Relative time helpers ──────────────────────────────────────────────────────

/**
 * Returns a human-readable relative time string from a candidate's `visited_at`.
 * Examples: "just now", "this morning", "last night", "yesterday", "2 days ago".
 * Never returns an absolute date — always relative.
 */
function relativeVisitTime(visitedAt: string): string {
    const now = new Date();
    const then = new Date(visitedAt);
    const diffMs = now.getTime() - then.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffHours < 1) return 'just now';
    if (diffHours < 4) return `${Math.floor(diffHours)} hour${Math.floor(diffHours) === 1 ? '' : 's'} ago`;

    // Same calendar day
    if (
        then.getFullYear() === now.getFullYear() &&
        then.getMonth() === now.getMonth() &&
        then.getDate() === now.getDate()
    ) {
        const hour = then.getHours();
        if (hour < 12) return 'this morning';
        if (hour < 17) return 'this afternoon';
        return 'this evening';
    }

    const yesterdayStart = new Date(now);
    yesterdayStart.setDate(now.getDate() - 1);
    yesterdayStart.setHours(0, 0, 0, 0);
    const yesterdayEnd = new Date(now);
    yesterdayEnd.setDate(now.getDate() - 1);
    yesterdayEnd.setHours(23, 59, 59, 999);

    if (then >= yesterdayStart && then <= yesterdayEnd) {
        const hour = then.getHours();
        return hour >= 18 ? 'last night' : 'yesterday';
    }

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) === 1 ? '' : 's'} ago`;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
    candidate: MergeCandidate;
    /** Called when user taps the primary [merge] action. */
    onMerge: () => void;
    /** Called when user taps the secondary [separate] action. */
    onSeparate: () => void;
    /** Disable both CTAs while a mutation is in-flight. */
    loading?: boolean;
    palette?: typeof Colors.light;
}

export function MergeCandidateCard({
    candidate,
    onMerge,
    onSeparate,
    loading = false,
    palette = Colors.light,
}: Props) {
    const relativeTime = relativeVisitTime(candidate.visited_at);
    const ratingDisplay = candidate.rating != null ? `${candidate.rating.toFixed(1)}` : null;

    // Build the italic name + rating + relative time line.
    // e.g. "Clara logged this last night · 4.8★"
    // No emoji; middle dot separates metadata per brand.
    const nameLine = [
        `${candidate.display_name} logged this ${relativeTime}`,
        ratingDisplay ? `${ratingDisplay}★` : null,
    ]
        .filter(Boolean)
        .join(' · ');

    return (
        <View style={[styles.container, { backgroundColor: palette.surfaceJournalLow }]}>
            {/* Ghosted warm rule top — NOT a 1px solid border. */}
            <View style={[styles.ruleTop, { backgroundColor: palette.divider }]} />

            {/* Header row: avatar + name/time line */}
            <View style={styles.headerRow}>
                {candidate.avatar_url ? (
                    <Image
                        source={{ uri: candidate.avatar_url }}
                        style={styles.avatar}
                    />
                ) : (
                    <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: palette.surfaceContainerHigh }]}>
                        <Text style={[styles.avatarInitial, { color: palette.textMuted }]}>
                            {candidate.display_name.charAt(0).toUpperCase()}
                        </Text>
                    </View>
                )}

                {/* Italic Newsreader for name + rating line — brand voice. */}
                <Text
                    style={[styles.nameLine, { color: palette.text }]}
                    numberOfLines={2}
                >
                    {nameLine}
                </Text>
            </View>

            {/* Body copy — Manrope, not italic. */}
            <Text style={[styles.body, { color: palette.textMuted }]}>
                Same visit? Two voices become a round.
            </Text>

            {/* CTAs: terracotta primary [merge] + muted text [separate] */}
            <View style={styles.ctaRow}>
                <Pressable
                    onPress={onMerge}
                    disabled={loading}
                    style={({ pressed }) => [
                        styles.ctaPrimary,
                        { backgroundColor: palette.primary, opacity: (loading || pressed) ? 0.6 : 1 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="merge into a round"
                >
                    <Text style={styles.ctaPrimaryLabel}>merge</Text>
                </Pressable>

                <Pressable
                    onPress={onSeparate}
                    disabled={loading}
                    style={({ pressed }) => [
                        styles.ctaSecondary,
                        { opacity: (loading || pressed) ? 0.5 : 1 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="save as a separate entry"
                >
                    <Text style={[styles.ctaSecondaryLabel, { color: palette.textMuted }]}>
                        separate
                    </Text>
                </Pressable>
            </View>
        </View>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: {
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingBottom: 16,
        overflow: 'hidden',
        // Ambient shadow only — no hard drop shadow.
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.06,
        shadowRadius: 30,
        elevation: 2,
    },
    ruleTop: {
        height: 1,
        marginBottom: 14,
        // Ghosted warm rule — background color at divider opacity does the job.
        // Not a border: we use a thin View with divider color instead.
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        marginBottom: 6,
    },
    avatar: {
        width: 36,
        height: 36,
        borderRadius: 18,
        flexShrink: 0,
        marginTop: 2,
    },
    avatarFallback: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarInitial: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 14,
    },
    nameLine: {
        flex: 1,
        // Italic Newsreader — brand voice for member names and ratings.
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
        lineHeight: 20,
        letterSpacing: -0.1,
    },
    body: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 13,
        lineHeight: 18,
        marginBottom: 14,
    },
    ctaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    ctaPrimary: {
        paddingHorizontal: 20,
        paddingVertical: 9,
        borderRadius: 9999,
    },
    ctaPrimaryLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
        letterSpacing: 0.2,
        color: '#fdf6ec',   // warm cream on terracotta
    },
    ctaSecondary: {
        paddingHorizontal: 8,
        paddingVertical: 9,
    },
    ctaSecondaryLabel: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 13,
        letterSpacing: 0.1,
    },
});
