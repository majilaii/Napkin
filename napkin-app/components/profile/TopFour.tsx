/**
 * TopFour — the profile's four favourite restaurants, as a Letterboxd-class
 * marquee row (TICKET-025 · TICKET-146 "the engraving system", B — the marquee).
 *
 * Four 2:3 plates in one horizontal row. Each plate draws its mark + tint from
 * the shared engraving registries (MarqueePlate), so the same restaurant reads
 * identically here and on the map. Rank ghosted top-left, rating terracotta
 * italic bottom-right, name italic serif, city letterspaced caps.
 *
 * Auto-derived or curated from `top_four` in the profile payload. Empty slots
 * show a tappable '+' for the owner. Public profile reuses this component.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';

import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SectionHeader } from './SectionHeader';
import { MarqueePlate } from './MarqueePlate';
import type { TopPick } from '@/hooks/users/useUserProfile';

interface Props {
    picks: TopPick[];
    /** When true (own profile), shows an "edit" affordance + tappable empty slots. */
    isOwner?: boolean;
    onEdit?: () => void;
}

export function TopFour({ picks, isOwner = false, onEdit }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    const slots: (TopPick | null)[] = [
        picks[0] ?? null,
        picks[1] ?? null,
        picks[2] ?? null,
        picks[3] ?? null,
    ];

    const openPick = (pick: TopPick) =>
        // Tap a pick with a review → open the review. Gated to the owner so a
        // public-profile viewer can't deep-link into a Table-visibility entry —
        // they get the restaurant page.
        pick.review_entry_id && isOwner
            ? router.push({ pathname: '/entry-detail', params: { entryId: pick.review_entry_id } })
            : router.push(`/restaurant/${pick.restaurant_id}` as any);

    return (
        <View>
            <SectionHeader
                title="Top 4"
                rightLabel={isOwner && onEdit ? 'edit' : undefined}
                onRightLabelPress={onEdit}
            />
            <View style={styles.row}>
                {slots.map((pick, i) =>
                    pick ? (
                        <MarqueePlate
                            key={i}
                            style={styles.plate}
                            restaurantId={pick.restaurant_id}
                            name={pick.name}
                            cuisine={pick.cuisine}
                            listEmoji={null}
                            city={pick.city}
                            rating={pick.max_rating}
                            rank={i + 1}
                            photoUrl={pick.hero_photo_url}
                            onPress={() => openPick(pick)}
                        />
                    ) : (
                        <Pressable
                            key={i}
                            style={[
                                styles.plate,
                                styles.emptyPlate,
                                { borderColor: palette.outlineVariant, backgroundColor: palette.surfaceContainerLow },
                            ]}
                            onPress={isOwner && onEdit ? onEdit : undefined}
                            accessibilityRole={isOwner && onEdit ? 'button' : undefined}
                            accessibilityLabel={isOwner && onEdit ? 'Add to your Top 4' : undefined}
                        >
                            <Text style={[styles.plus, { color: palette.textMuted }]}>+</Text>
                        </Pressable>
                    )
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        paddingHorizontal: Spacing.lg,
        gap: Spacing.sm,
    },
    plate: {
        flex: 1,
    },
    emptyPlate: {
        aspectRatio: 2 / 3,
        borderRadius: Radius.md,
        borderWidth: 1,
        borderStyle: 'dashed',
        alignItems: 'center',
        justifyContent: 'center',
    },
    plus: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 28,
        fontWeight: '300',
    },
});
