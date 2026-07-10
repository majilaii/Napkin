/**
 * ImportActivationHub — the repeatable, Heirloom-voiced import teaching surface
 * (TICKET-122, Surface B). Adapts Rodeo's "Popular apps to start saving from" hub.
 *
 * Two variants:
 *   full    — empty Wishlist / empty imports hub. Source-app row (names + neutral
 *             share glyphs) + the gesture line + the auto-vs-review mode line
 *             (closes gap 8) + optional "your imports" link (closes gap 9).
 *   compact — one standing row that persists post-first-import; taps through to the
 *             imports hub (closes gap 9). Non-interactive when no onOpenHub is given
 *             (e.g. rendered ON the hub itself).
 *   auto    — compact once the user has imported, else full.
 *
 * Copy is exact + cut hard (copy-economy doctrine). Manrope for every label /
 * instruction; NO serif here (no brand moment on a teaching surface). No emoji;
 * Ionicons outline; one accent (terracotta).
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/constants/theme';
import { getDefaultImportMode } from '@/lib/importQueue';
import { ShareGlyph } from './ShareGlyph';
import {
    SOURCE_APPS,
    GLYPH_FOR_SOURCE,
    HUB_COPY,
    COMPACT_LINE,
    resolveHubVariant,
    modeLine,
} from './activationHubUtils';

type Palette = typeof Colors.light;

export interface ImportActivationHubProps {
    palette: Palette;
    variant?: 'full' | 'compact' | 'auto';
    hasImported?: boolean;
    onOpenHub?: () => void;
    showHubLink?: boolean;
}

export function ImportActivationHub({
    palette,
    variant = 'auto',
    hasImported = false,
    onOpenHub,
    showHubLink = false,
}: ImportActivationHubProps) {
    const resolved = resolveHubVariant(variant, hasImported);

    // ── Compact — one standing row → the imports hub (gap 9) ──────────────────
    // Always a Pressable (View has no function-style prop); `disabled` makes it a
    // static teaching row when there's nowhere to route (e.g. rendered ON the hub).
    if (resolved === 'compact') {
        const interactive = !!onOpenHub;
        return (
            <Pressable
                onPress={onOpenHub}
                disabled={!interactive}
                style={({ pressed }) => [
                    styles.compactRow,
                    { backgroundColor: palette.surfaceJournalLow, opacity: pressed ? 0.7 : 1 },
                ]}
                accessibilityRole={interactive ? 'button' : undefined}
                accessibilityLabel={interactive ? 'open your imports' : COMPACT_LINE}
            >
                <Ionicons name="share-outline" size={16} color={palette.textMuted} />
                <Text style={[styles.compactLabel, { color: palette.textSecondary }]} numberOfLines={1}>
                    {COMPACT_LINE}
                </Text>
                {interactive ? (
                    <Ionicons name="chevron-forward" size={15} color={palette.textMuted} />
                ) : null}
            </Pressable>
        );
    }

    // ── Full — the show-don't-tell activation block ───────────────────────────
    const mode = getDefaultImportMode();
    return (
        <View style={styles.fullRoot}>
            <Text style={[styles.kicker, { color: palette.textMuted }]}>{HUB_COPY.kicker}</Text>

            <View style={styles.sourceRow}>
                {SOURCE_APPS.map((source) => (
                    <ShareGlyph
                        key={source}
                        source={source}
                        glyph={GLYPH_FOR_SOURCE[source]}
                        palette={palette}
                    />
                ))}
            </View>

            <Text style={[styles.gesture, { color: palette.textMuted }]}>{HUB_COPY.gesture}</Text>
            <Text style={[styles.mode, { color: palette.textSecondary }]}>{modeLine(mode)}</Text>

            {showHubLink && onOpenHub ? (
                <Pressable
                    onPress={onOpenHub}
                    style={styles.hubLink}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="open your imports"
                >
                    <Text style={[styles.hubLinkText, { color: palette.primary }]}>{HUB_COPY.hubLink}</Text>
                    <Ionicons name="chevron-forward" size={14} color={palette.primary} />
                </Pressable>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    // Full
    fullRoot: {
        alignItems: 'center',
        gap: 12,
        paddingVertical: 4,
    },
    kicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 1.6,
    },
    sourceRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        alignSelf: 'stretch',
        paddingHorizontal: 4,
    },
    gesture: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
        textAlign: 'center',
    },
    mode: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
        textAlign: 'center',
        marginTop: -4,
    },
    hubLink: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        marginTop: 2,
    },
    hubLinkText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
        letterSpacing: 0.2,
    },
    // Compact
    compactRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    compactLabel: {
        flex: 1,
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
    },
});

export default ImportActivationHub;
