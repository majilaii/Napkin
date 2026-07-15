/**
 * ImportAttentionCard — the one imports card the profile BODY ever shows
 * (TICKET-191 rev 2). Renders directly under the header stats, above Top Four,
 * ONLY for attention-bearing slot states (review / failed / kickoff /
 * digest-with-needsLook). Calm states (running / digest-clean / recent) and
 * idle render nothing — the header tray affordance is the standing door, and
 * the hub owns history.
 *
 * The render is the founder-approved slot card: icon tile · title · sublabel ·
 * chevron, with the terracotta left edge (action-owed treatment, 2026-07-15).
 * Tap → /import-progress, never past the hub.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { ImportSlot } from '@/hooks/imports/importSlotUtils';
import { PressableScale } from '@/components/ui/napkin/PressableScale';

interface Props {
    /** Live import slot; anything but an attention accent renders null. */
    slot: ImportSlot | null;
}

export function ImportAttentionCard({ slot }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    if (!slot || slot.accent !== 'attention') return null;

    return (
        <PressableScale
            onPress={() => router.push('/import-progress')}
            haptic="selection"
            style={[
                styles.card,
                {
                    backgroundColor: palette.surfaceJournalLow,
                    borderLeftColor: palette.primary,
                },
            ]}
            accessibilityRole="button"
            accessibilityLabel={slot.title}
        >
            <View style={[styles.tile, { backgroundColor: palette.primaryMuted }]}>
                <Ionicons name={slot.icon} size={20} color={palette.primary} />
            </View>
            <View style={styles.body}>
                <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
                    {slot.title}
                </Text>
                <Text style={[styles.sublabel, { color: palette.textMuted }]} numberOfLines={1}>
                    {slot.sublabel}
                </Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color={palette.textMuted} />
        </PressableScale>
    );
}

const styles = StyleSheet.create({
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 13,
        marginHorizontal: 22,
        marginTop: 2,
        marginBottom: Spacing.xs,
        borderRadius: Radius.lg,
        paddingHorizontal: 15,
        paddingVertical: 13,
        // Terracotta edge — action-owed states only, and this card ONLY
        // renders action-owed states.
        borderLeftWidth: 3,
    },
    tile: {
        width: 40,
        height: 40,
        borderRadius: Radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    body: {
        flex: 1,
        minWidth: 0,
    },
    title: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 14,
    },
    sublabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        marginTop: 2,
    },
});
