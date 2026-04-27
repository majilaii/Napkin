/**
 * ClaimNudgeCard — owner-only warm prompt for unclaimed cities.
 *
 * Overline: "READY WHEN YOU ARE"
 * Body (italic Newsreader): "You've logged {n} places in {city}."
 * Sub-copy: private until claimed
 * Buttons: [Claim {city}] (filled terracotta) / [Not yet] (text-only)
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { TopFourNudge } from '@/hooks/top-fours/useTopFours';

interface Props {
    nudge: TopFourNudge;
    onClaim: (city: string) => void;
    onDismiss: (city: string) => void;
}

export function ClaimNudgeCard({ nudge, onClaim, onDismiss }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View
            style={[
                styles.card,
                {
                    backgroundColor: palette.terracottaScrim,
                    borderColor: palette.terracottaBorder,
                    ...Shadow.subtle,
                },
            ]}
        >
            {/* Overline */}
            <Text style={[Type.labelSmall, { color: palette.primary, marginBottom: Spacing.xs }]}>
                READY WHEN YOU ARE
            </Text>

            {/* Body */}
            <Text
                style={[
                    Type.headlineItalic,
                    {
                        fontFamily: 'Newsreader_400Regular_Italic',
                        fontSize: 16,
                        color: palette.text,
                        marginBottom: Spacing.xs,
                    },
                ]}
            >
                {`You've logged ${nudge.distinct_restaurant_count} ${nudge.distinct_restaurant_count === 1 ? 'place' : 'places'} in ${nudge.city}.`}
            </Text>

            {/* Sub-copy */}
            <Text style={[Type.bodySmall, { color: palette.textMuted, marginBottom: Spacing.md }]}>
                Enough to name a Top 4. No pressure — this only appears here, not on your profile until you claim it.
            </Text>

            {/* Buttons */}
            <View style={styles.buttons}>
                <Pressable
                    onPress={() => onClaim(nudge.city)}
                    style={({ pressed }) => [
                        styles.claimBtn,
                        {
                            backgroundColor: pressed ? palette.terracottaDeep : palette.primary,
                            borderRadius: Radius.sm,
                        },
                    ]}
                    accessibilityLabel={`Claim ${nudge.city}`}
                    accessibilityRole="button"
                >
                    <Text style={[Type.caption, { color: palette.textInverse, fontSize: 12 }]}>
                        {`Claim ${nudge.city}`}
                    </Text>
                </Pressable>

                <Pressable
                    onPress={() => onDismiss(nudge.city)}
                    hitSlop={8}
                    accessibilityLabel="Not yet"
                    accessibilityRole="button"
                >
                    <Text style={[Type.bodySmall, { color: palette.textMuted }]}>
                        Not yet
                    </Text>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        marginHorizontal: 22,
        marginBottom: Spacing.md,
        padding: Spacing.md,
        borderRadius: Radius.md,
        borderWidth: 1,
    },
    buttons: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
    },
    claimBtn: {
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
    },
});
