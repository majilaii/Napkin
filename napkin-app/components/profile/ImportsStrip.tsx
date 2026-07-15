/**
 * ImportsStrip — the profile's Imports presence (TICKET-191), SELF ONLY.
 * Imports are a private workbench, not expression — a stranger never sees this
 * (consistent with wishlist staying off the stranger index).
 *
 * Lives inside CollectionsSection under its one "Collections" header; this
 * strip carries only a subordinate RailSubLabel. Three bodies, every one
 * routing exactly to /import-progress (hierarchical back-nav is sacred —
 * never deep-link past the hub):
 *
 *   1. active/attention (slot non-null) — one full-width status card; accent
 *      comes from slot.accent, never re-derived here.
 *   2. idle with history — a horizontal rail of recent batch cards (cap 6).
 *      Source glyph plates render ONLY for the plateGlyphFor allowlist
 *      (tiktok / instagram / google_maps); everything else is pure type.
 *   3. never imported — one quiet ghost line, ONLY after the history query
 *      resolves empty. While history is loading or errored, render nothing —
 *      never flash the first-timer ghost at a veteran importer.
 */
import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useImportSlot } from '@/hooks/imports/useImportSlot';
import { useRecentImports } from '@/hooks/wishlist/useRecentImports';
import {
    importSourceLabel,
    relativeTime,
    spotCountLabel,
} from '@/components/wishlist/importSourceLabel';
import { PressableScale } from '@/components/ui/napkin/PressableScale';
import { RailSubLabel } from './RailSubLabel';
import { plateGlyphFor } from './importsStripUtils';

type Palette = typeof Colors.light;

/** Batches shown on the idle rail — the full history lives in the hub. */
const STRIP_HISTORY_CAP = 6;

interface Props {
    /** The profile owner's id (always the viewer — the strip is self-only). */
    userId: string;
}

export function ImportsStrip({ userId }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;
    const router = useRouter();

    // Both read the same canonical importJobs cache → one request, no race.
    const slot = useImportSlot(userId);
    const { data: history } = useRecentImports(userId);

    const openHub = () => router.push('/import-progress');

    // 1 — active/attention: the live slot card.
    if (slot) {
        const attention = slot.accent === 'attention';
        return (
            <View>
                <RailSubLabel title="Imports" />
                <PressableScale
                    onPress={openHub}
                    haptic="selection"
                    // Action-owed states carry a terracotta edge; calm states stay flat
                    // (founder-approved design pass, 2026-07-15).
                    style={
                        attention
                            ? [
                                  styles.slotCard,
                                  { backgroundColor: palette.surfaceJournalLow },
                                  { borderLeftWidth: 3, borderLeftColor: palette.primary },
                              ]
                            : [styles.slotCard, { backgroundColor: palette.surfaceJournalLow }]
                    }
                    accessibilityRole="button"
                    accessibilityLabel={slot.title}
                >
                    <View
                        style={[
                            styles.slotTile,
                            { backgroundColor: attention ? palette.primaryMuted : palette.surfaceJournalHi },
                        ]}
                    >
                        <Ionicons
                            name={slot.icon}
                            size={20}
                            color={attention ? palette.primary : palette.textSecondary}
                        />
                    </View>
                    <View style={styles.slotBody}>
                        <Text style={[styles.slotTitle, { color: palette.text }]} numberOfLines={1}>
                            {slot.title}
                        </Text>
                        <Text style={[styles.slotSublabel, { color: palette.textMuted }]} numberOfLines={1}>
                            {slot.sublabel}
                        </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={14} color={palette.textMuted} />
                </PressableScale>
            </View>
        );
    }

    // Strict resolved-only gate: loading/errored history renders NOTHING.
    if (history === undefined) return null;

    // 3 — never imported: one quiet ghost line (history resolved empty).
    if (history.length === 0) {
        return (
            <View>
                <RailSubLabel title="Imports" />
                <PressableScale
                    onPress={openHub}
                    haptic="selection"
                    style={[styles.ghostCard, { borderColor: palette.outlineVariant }]}
                    accessibilityRole="button"
                    accessibilityLabel="add from TikTok, IG or Maps"
                >
                    <Ionicons name="add" size={18} color={palette.primary} />
                    <Text style={[styles.ghostLabel, { color: palette.primary }]} numberOfLines={1}>
                        add from TikTok, IG or Maps
                    </Text>
                </PressableScale>
            </View>
        );
    }

    // 2 — idle with history: recent batch cards, capped.
    return (
        <View>
            <RailSubLabel title="Imports" />
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.rail}
            >
                {history.slice(0, STRIP_HISTORY_CAP).map((batch) => {
                    const glyph = plateGlyphFor(batch.source);
                    const sourceLabel = importSourceLabel(batch.source);
                    return (
                        <PressableScale
                            key={batch.job_id}
                            onPress={openHub}
                            haptic="selection"
                            style={[styles.batchCard, { backgroundColor: palette.surfaceJournalLow }]}
                            accessibilityRole="button"
                            accessibilityLabel={`${spotCountLabel(batch.item_count)} ${sourceLabel}`}
                        >
                            {glyph ? (
                                <View style={[styles.batchPlate, { backgroundColor: palette.surfaceJournalHi }]}>
                                    <Ionicons name={glyph} size={16} color={palette.textSecondary} />
                                </View>
                            ) : null}
                            <Text style={[styles.batchSource, { color: palette.text }]} numberOfLines={1}>
                                {sourceLabel}
                            </Text>
                            <Text style={[styles.batchMeta, { color: palette.textMuted }]} numberOfLines={1}>
                                {`${spotCountLabel(batch.item_count)} · ${relativeTime(batch.created_at)}`}
                            </Text>
                        </PressableScale>
                    );
                })}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    slotCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 13,
        marginHorizontal: 22,
        borderRadius: Radius.lg,
        paddingHorizontal: 15,
        paddingVertical: 13,
    },
    slotTile: {
        width: 40,
        height: 40,
        borderRadius: Radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    slotBody: {
        flex: 1,
        minWidth: 0,
    },
    slotTitle: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 14,
    },
    slotSublabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        marginTop: 2,
    },
    ghostCard: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        marginHorizontal: 22,
        borderRadius: Radius.lg,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        paddingVertical: 14,
        paddingHorizontal: 15,
    },
    ghostLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
    },
    rail: {
        flexDirection: 'row',
        gap: 12,
        paddingHorizontal: 22,
        paddingRight: 30,
        paddingBottom: 4,
    },
    batchCard: {
        width: 148,
        borderRadius: Radius.lg,
        padding: 12,
        gap: 6,
    },
    batchPlate: {
        width: 28,
        height: 28,
        borderRadius: Radius.sm,
        alignItems: 'center',
        justifyContent: 'center',
    },
    batchSource: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
    },
    batchMeta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
});
