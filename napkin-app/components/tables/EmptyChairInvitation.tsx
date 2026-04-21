/**
 * EmptyChairInvitation — solo swerve slab for the Tables tab.
 *
 * Rendered when the user's only table is their personal journal.
 * Canvas: WF1 "AN INVITATION" hero block.
 *
 * CTA destination is a prop so tables.tsx can pass an Alert stub.
 * Never adds navigation or data logic here — presentational only.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors, Spacing, Radius, Type, Shadow } from '@/constants/theme';

type Palette = typeof Colors.light;

interface EmptyChairInvitationProps {
    onGatherPress: () => void;
    onDismiss: () => void;
    palette: Palette;
}

export function EmptyChairInvitation({
    onGatherPress,
    onDismiss,
    palette,
}: EmptyChairInvitationProps) {
    return (
        <View
            style={[
                styles.slab,
                {
                    backgroundColor: palette.surfaceContainer,
                    borderColor: palette.outlineVariant,
                },
                Shadow.ambient,
            ]}
        >
            {/* Kicker — terracotta (ceremonial) */}
            <Text style={[styles.kicker, { color: palette.primary }]}>
                AN INVITATION
            </Text>

            {/* Headline */}
            <Text style={[styles.headline, { color: palette.text }]}>
                The table tastes better with others.
            </Text>

            {/* Body */}
            <Text style={[styles.body, { color: palette.textSecondary }]}>
                Gather a small group — three to eight people you actually eat with.
                Your logs compound into something no algorithm can fake: a shared
                palate built from real meals.
            </Text>

            {/* CTAs */}
            <View style={styles.ctaRow}>
                <Pressable
                    onPress={onGatherPress}
                    style={({ pressed }) => [
                        styles.primaryCta,
                        { backgroundColor: palette.primary, opacity: pressed ? 0.88 : 1 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Gather a table"
                >
                    <Text style={[Type.label, styles.primaryCtaText]}>
                        Gather a table
                    </Text>
                </Pressable>

                <Pressable
                    onPress={onDismiss}
                    style={({ pressed }) => [styles.ghostCta, { opacity: pressed ? 0.6 : 1 }]}
                    accessibilityRole="button"
                    accessibilityLabel="Not now"
                >
                    <Text style={[Type.label, { color: palette.textMuted, fontSize: 10 }]}>
                        not now
                    </Text>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    slab: {
        marginHorizontal: Spacing.lg,
        marginVertical: Spacing.lg,
        borderRadius: Radius.xl,
        borderWidth: StyleSheet.hairlineWidth,
        padding: Spacing.xl,
    },
    kicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        marginBottom: Spacing.sm,
    },
    headline: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 22,
        lineHeight: 28,
        marginBottom: Spacing.md,
    },
    body: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 14,
        lineHeight: 21,
        marginBottom: Spacing.xl,
    },
    ctaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.lg,
    },
    primaryCta: {
        paddingHorizontal: Spacing.xl,
        paddingVertical: 12,
        borderRadius: 9999,
        alignItems: 'center',
        justifyContent: 'center',
    },
    primaryCtaText: {
        color: Colors.light.textInverse,
        letterSpacing: 1,
        fontSize: 11,
    },
    ghostCta: {
        paddingVertical: 14,
        paddingHorizontal: 12,
        minHeight: 44,
        justifyContent: 'center',
    },
});
