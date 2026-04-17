/**
 * OnTheTableList — "On the Table" menu-card section for Round detail.
 *
 * Renders a ranked list of dishes ordered by each participant (rating desc,
 * tiebreak by user_id lexicographic — see ARCHITECT-REVIEW comment below).
 * Only renders when at least one participant has a dish_description.
 * Returns null otherwise (the section disappears entirely).
 *
 * Winner marker rules (all three required):
 *   1. >= 3 participants logged a dish
 *   2. Top rating strictly > second-highest (no tie at top)
 *   3. Gap >= 0.5 between top and second-highest
 *
 * Reveal-gating lives at the parent (table-night-detail.tsx); this component
 * renders unconditionally when mounted.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Type } from '@/constants/theme';
import { type TableNightParticipant } from '@/hooks/tables/useTableNight';
import DishRow from './DishRow';

type Palette = typeof Colors.light;

interface OnTheTableListProps {
    participants: TableNightParticipant[];
    nightId: string;
    palette: Palette;
}

export default function OnTheTableList({ participants, nightId, palette }: OnTheTableListProps) {
    const router = useRouter();

    // Filter to only participants who have a dish and a rating
    const withDish = participants.filter(
        (p): p is TableNightParticipant & { dish_description: string; rating: number } =>
            p.dish_description != null && p.dish_description.trim().length > 0 && p.rating != null
    );

    if (withDish.length === 0) return null;

    // Sort: rating descending, tiebreak by user_id lexicographic (stable proxy
    // when created_at is unavailable on TableNightParticipant — noted in build log)
    const sorted = [...withDish].sort((a, b) => {
        if (b.rating !== a.rating) return b.rating - a.rating;
        // Tiebreak: stable by user_id lexicographic (see ARCHITECT-REVIEW below)
        return a.user_id < b.user_id ? -1 : 1;
    });

    // Compute winner marker eligibility
    const topRating = sorted[0].rating;
    const secondRating = sorted.length > 1 ? sorted[1].rating : null;

    const showWinner =
        withDish.length >= 3 &&
        secondRating !== null &&
        topRating > secondRating &&
        topRating - secondRating >= 0.5;

    return (
        <View>
            {/* Section header — matches SectionLabel in table-night-detail.tsx */}
            <Text style={[Type.label, { color: palette.textSecondary, marginBottom: Spacing.md }]}>
                On the Table
            </Text>

            {sorted.map((participant, index) => {
                const isWinner = showWinner && participant.rating === topRating;
                const isLast = index === sorted.length - 1;

                return (
                    <View key={participant.user_id}>
                        <DishRow
                            participant={participant}
                            isWinner={isWinner}
                            palette={palette}
                            onPress={() =>
                                router.push({
                                    pathname: '/entry-detail',
                                    params: { nightId, userId: participant.user_id },
                                })
                            }
                        />
                        {/* Ghost divider between rows — not after the last row */}
                        {!isLast && (
                            <View style={[styles.divider, { backgroundColor: palette.divider }]} />
                        )}
                    </View>
                );
            })}
        </View>
    );
}

// ARCHITECT-REVIEW: TableNightParticipant does not have created_at in its type
// (confirmed in hooks/tables/useTableNight.ts). The spec calls for tiebreak by
// entry created_at ascending. Using user_id lexicographic as a stable fallback
// instead. To implement the spec exactly, created_at would need to be added to
// the edge function's participant select + the TableNightParticipant type.
// Deviation is cosmetic — it only affects ordering of ties.

const styles = StyleSheet.create({
    divider: {
        height: 1,
        marginVertical: Spacing.md,
    },
});
