/**
 * TableTopFourPlaceholder — dashed waiting state for a Table's Top 4.
 *
 * From `early-states.jsx::TableEarlyPhone`:
 *   "THE TABLE'S TOP 4" / four dashed empty poster slots /
 *   italic-serif "Four places. Anywhere in the world." /
 *   "Pick these together — or wait until you've eaten somewhere worth defending." /
 *   outlined "Start the Top 4" pill.
 *
 * Top 4 isn't yet a wired feature; this component renders the empty case
 * so brand-new tables don't feel hollow. Once Top 4 picks land in
 * `useTableDetail`, swap the placeholder for the real grid and reuse this
 * for the "fewer than four picks" interim.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { Colors, Spacing, Radius } from '@/constants/theme';

type Palette = typeof Colors.light;

interface Props {
    palette: Palette;
    onStart?: () => void;
}

export function TableTopFourPlaceholder({ palette, onStart }: Props) {
    return (
        <View
            style={[
                styles.container,
                {
                    backgroundColor: palette.surfaceJournalLow,
                    borderColor: palette.terracottaBorder,
                },
            ]}
        >
            <Text style={[styles.kicker, { color: palette.textMuted }]}>
                THE TABLE&rsquo;S TOP 4
            </Text>
            <View style={styles.grid}>
                {[0, 1, 2, 3].map((i) => (
                    <View
                        key={i}
                        style={[
                            styles.slot,
                            {
                                backgroundColor: palette.terracottaScrim,
                                borderColor: palette.dividerSoft,
                            },
                        ]}
                    />
                ))}
            </View>
            <Text style={[styles.headline, { color: palette.text }]}>
                Four places. Anywhere in the world.
            </Text>
            <Text style={[styles.body, { color: palette.textMuted }]}>
                Pick these together — or wait until you&rsquo;ve eaten
                somewhere worth defending.
            </Text>
            {onStart ? (
                <Pressable
                    onPress={onStart}
                    style={({ pressed }) => [
                        styles.cta,
                        {
                            borderColor: palette.text,
                            opacity: pressed ? 0.65 : 1,
                        },
                    ]}
                >
                    <Text style={[styles.ctaText, { color: palette.text }]}>
                        Start the Top 4
                    </Text>
                </Pressable>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        marginHorizontal: 22,
        padding: 20,
        borderRadius: 12,
        borderWidth: 1,
        borderStyle: 'dashed',
    },
    kicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 1.6,
    },
    grid: {
        marginTop: Spacing.sm,
        flexDirection: 'row',
        gap: 8,
    },
    slot: {
        flex: 1,
        aspectRatio: 3 / 4,
        borderRadius: Radius.sm,
        borderWidth: 1,
        borderStyle: 'dashed',
    },
    headline: {
        marginTop: 12,
        fontFamily: 'Newsreader_400Regular_Italic',
        fontStyle: 'italic',
        fontSize: 16,
        lineHeight: 22,
        fontWeight: '500',
    },
    body: {
        marginTop: 4,
        fontFamily: 'Manrope_400Regular',
        fontSize: 12,
        lineHeight: 18,
    },
    cta: {
        marginTop: 12,
        alignSelf: 'flex-start',
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 9999,
        borderWidth: 1,
    },
    ctaText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11,
        letterSpacing: 0.3,
    },
});
