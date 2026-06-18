/**
 * RecentlyImportedBand — compact "what just landed" surface at the top of the
 * Wishlist tab. Shows the most recent import batches (a video/link that dropped
 * N spots into the wishlist) so a fresh import doesn't vanish into 200 saves.
 *
 * Tertiary by design: only rendered when there ARE recent imports, capped to a
 * couple of rows, with "see all imports" → the full history. Saves stay the hero.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { ImportBatch } from '@/hooks/wishlist/useImportHistory';
import { importSourceLabel, spotCountLabel, previewLine, relativeTime } from './importSourceLabel';

type Palette = typeof Colors.light;

interface Props {
    batches: ImportBatch[];
    onOpenBatch: (jobId: string) => void;
    onSeeAll: () => void;
    /** How many to show inline before "see all". */
    max?: number;
}

export function RecentlyImportedBand({ batches, onOpenBatch, onSeeAll, max = 2 }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;

    if (batches.length === 0) return null;

    const shown = batches.slice(0, max);
    const hasMore = batches.length > max;

    return (
        <View style={styles.wrap}>
            <View style={styles.kickerRow}>
                <Text style={[styles.kicker, { color: palette.textSecondary }]}>RECENTLY IMPORTED</Text>
                {hasMore ? (
                    <Pressable onPress={onSeeAll} hitSlop={8} accessibilityLabel="see all imports">
                        <Text style={[styles.seeAll, { color: palette.primary }]}>see all</Text>
                    </Pressable>
                ) : null}
            </View>

            {shown.map((b) => (
                <Pressable
                    key={b.job_id}
                    onPress={() => onOpenBatch(b.job_id)}
                    style={({ pressed }) => [
                        styles.card,
                        { backgroundColor: palette.card, opacity: pressed ? 0.8 : 1 },
                        Shadow.subtle,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`open import of ${spotCountLabel(b.item_count)}`}
                >
                    <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
                        {previewLine(b.preview_names, b.item_count)}
                    </Text>
                    <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>
                        {`${importSourceLabel(b.source)} · ${spotCountLabel(b.item_count)} · ${relativeTime(b.created_at)}`}
                    </Text>
                </Pressable>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        paddingHorizontal: 22,
        paddingTop: Spacing.md,
    },
    kickerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
    },
    kicker: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
    },
    seeAll: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 1,
        textTransform: 'lowercase',
    },
    card: {
        borderRadius: Radius.md,
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.md,
        marginBottom: Spacing.sm,
        gap: 3,
    },
    title: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 16,
        lineHeight: 20,
    },
    meta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
});
