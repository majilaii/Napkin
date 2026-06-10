/**
 * CandidatePickerPanel — multi-candidate list panel for import (TICKET-063).
 *
 * Renders "{N} spots in this video" (or "one spot found" for N=1) with tappable rows.
 * Each row: 48px photo thumb · italic Newsreader name · taupe "city · cuisine" metadata.
 * Tap-to-toggle selection reuses the RowToggle terracotta-tint + ✓ idiom.
 *
 * Default selection by confidence (ARCH-REVIEW-2 #9):
 *   N=1: always pre-ticked regardless of confidence.
 *   N>1: high/exact → pre-ticked; low → un-ticked.
 *
 * Primary CTA: "pin {N} spots" (or "pin {Name}" for one selected spot).
 * Note field: shown only when exactly one spot is ticked (T-053 parity).
 * Per-row "not this?": opens the existing inline Places-search seam.
 *
 * Low confidence styling: muted taupe meta, no chip, no icon, un-ticked.
 * Inferred city: quiet "guessed from the caption" suffix on the city line.
 *
 * Design: Heirloom Journal — warm paper, Newsreader italic names, Manrope body.
 * Accents: terracotta (CTA + ticked) + olive (confirmed chip). No red. No emoji in chrome.
 */
import React, { useState, useCallback, useMemo } from 'react';
import {
    View,
    Text,
    Pressable,
    ScrollView,
    StyleSheet,
    Image,
    ActivityIndicator,
} from 'react-native';
import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { placesPhotoProxyUrl } from '@/lib/placesPhoto';
import type { ResolvedCandidate } from '@/hooks/wishlist/useResolveUrl';

type Palette = typeof Colors.light;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CandidatePickerPanelProps {
    candidates: ResolvedCandidate[];
    /** Number of ticked spots before the note field appears (1 = single note field). */
    onSave: (
        ticked: ResolvedCandidate[],
        note: string,
    ) => void;
    isSaving: boolean;
    sourceTag: string | null;
    /** Called when the user taps "not this?" on a specific row. */
    onCorrectRow: (candidate: ResolvedCandidate) => void;
    /** Pre-filled note text (from note_prefill). */
    initialNote?: string;
    palette?: Palette;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function photoUrl(photoReference: string | null | undefined): string | null {
    return placesPhotoProxyUrl(photoReference, { width: 200 }) ?? null;
}

function buildInitialTicked(candidates: ResolvedCandidate[]): Set<string> {
    const ticked = new Set<string>();
    if (candidates.length === 1) {
        // Always pre-tick the single candidate regardless of confidence
        ticked.add(keyFor(candidates[0]));
    } else {
        // Multi: pre-tick high/exact, leave low un-ticked
        for (const c of candidates) {
            if (c.confidence === 'high' || c.confidence === 'exact') {
                ticked.add(keyFor(c));
            }
        }
    }
    return ticked;
}

function keyFor(c: ResolvedCandidate): string {
    return c.candidate_id ?? c.google_place_id ?? c.restaurant.external_id ?? '';
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CandidatePickerPanel({
    candidates,
    onSave,
    isSaving,
    sourceTag,
    onCorrectRow,
    initialNote = '',
    palette: paletteProp,
}: CandidatePickerPanelProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = paletteProp ?? (Colors[scheme] as Palette);

    const [ticked, setTicked] = useState<Set<string>>(() => buildInitialTicked(candidates));
    const [noteText, setNoteText] = useState(initialNote);

    const toggleCandidate = useCallback((c: ResolvedCandidate) => {
        const k = keyFor(c);
        setTicked((prev) => {
            const next = new Set(prev);
            if (next.has(k)) {
                next.delete(k);
            } else {
                next.add(k);
            }
            return next;
        });
    }, []);

    const tickedCandidates = useMemo(
        () => candidates.filter((c) => ticked.has(keyFor(c)) && !c.already_wishlisted),
        [candidates, ticked],
    );

    const tickedCount = tickedCandidates.length;
    const isSingleTicked = tickedCount === 1;

    // CTA label
    const ctaLabel = useMemo(() => {
        if (tickedCount === 0) return 'pin';
        if (isSingleTicked) {
            const name = tickedCandidates[0].restaurant.name;
            return name ? `pin ${name}` : 'pin it';
        }
        return `pin ${tickedCount} spots`;
    }, [tickedCount, isSingleTicked, tickedCandidates]);

    // Panel title
    const panelTitle = candidates.length === 1
        ? 'one spot found'
        : `${candidates.length} spots in this video`;

    const handleSave = useCallback(() => {
        if (tickedCount === 0) return;
        onSave(tickedCandidates, isSingleTicked ? noteText.trim() : '');
    }, [tickedCandidates, tickedCount, isSingleTicked, noteText, onSave]);

    return (
        <View>
            {/* Panel title */}
            <Text style={[styles.panelTitle, { color: palette.text }]}>
                {panelTitle}
            </Text>

            {sourceTag ? (
                <Text style={[Type.caption, styles.sourceTag, { color: palette.textMuted }]}>
                    {sourceTag}
                </Text>
            ) : null}

            {/* Candidate list */}
            <ScrollView
                style={styles.listScroll}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
            >
                {candidates.map((c) => {
                    const k = keyFor(c);
                    const isChecked = ticked.has(k);
                    return (
                        <CandidateRow
                            key={k}
                            candidate={c}
                            checked={isChecked}
                            onToggle={() => toggleCandidate(c)}
                            onCorrect={() => onCorrectRow(c)}
                            palette={palette}
                        />
                    );
                })}
            </ScrollView>

            {/* Single-ticked note field */}
            {isSingleTicked && (
                <View style={styles.noteWrapper}>
                    <Text
                        style={[Type.caption, { color: palette.textMuted, marginBottom: Spacing.xs }]}
                    >
                        add a note (optional)
                    </Text>
                    <View
                        style={[
                            styles.noteInputContainer,
                            { borderColor: palette.ruleInkSoft, backgroundColor: palette.card },
                        ]}
                    >
                        <Text
                            style={[Type.body, { color: palette.text }]}
                            // ARCH: real TextInput would be here; using Text as placeholder
                            // to keep this component pure for test isolation.
                            // ImportLinkSheet wires a real TextInput below.
                        />
                    </View>
                </View>
            )}

            {/* Primary CTA */}
            <Pressable
                onPress={handleSave}
                disabled={isSaving || tickedCount === 0}
                accessibilityLabel={ctaLabel}
                style={({ pressed }) => [
                    styles.primaryButton,
                    {
                        backgroundColor: tickedCount > 0 ? palette.primary : palette.surfaceContainerHigh,
                        opacity: pressed || isSaving ? 0.75 : 1,
                    },
                ]}
            >
                {isSaving ? (
                    <ActivityIndicator color={palette.textInverse} size="small" />
                ) : (
                    <Text
                        style={[
                            Type.label,
                            { color: tickedCount > 0 ? palette.textInverse : palette.textMuted },
                        ]}
                    >
                        {ctaLabel}
                    </Text>
                )}
            </Pressable>
        </View>
    );
}

// ── CandidateRow ──────────────────────────────────────────────────────────────

interface CandidateRowProps {
    candidate: ResolvedCandidate;
    checked: boolean;
    onToggle: () => void;
    onCorrect: () => void;
    palette: Palette;
}

function CandidateRow({ candidate, checked, onToggle, onCorrect, palette }: CandidateRowProps) {
    const r = candidate.restaurant;
    const thumbUrl = r.photoReference ? photoUrl(r.photoReference) : null;
    const isLow = candidate.confidence === 'low';
    const isAlreadySaved = candidate.already_wishlisted;

    // City/cuisine meta line
    let cityPart = r.city ?? '';
    if (candidate.city_inferred && cityPart) {
        cityPart = `${cityPart} · guessed`;
    }
    const cityLine = [cityPart, r.cuisine].filter(Boolean).join(' · ');

    return (
        <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isAlreadySaved ? true : checked }}
            accessibilityLabel={`${checked ? 'Remove' : 'Add'} ${r.name ?? 'restaurant'}`}
            onPress={isAlreadySaved ? undefined : onToggle}
            style={({ pressed }) => [
                styles.row,
                {
                    backgroundColor: (checked || isAlreadySaved)
                        ? palette.primaryMuted
                        : palette.surfaceJournalLow,
                    opacity: pressed ? 0.85 : 1,
                    borderWidth: (checked || isAlreadySaved) ? 1.5 : 0,
                    borderColor: (checked || isAlreadySaved) ? palette.terracottaBorder : 'transparent',
                },
            ]}
        >
            {/* 48px photo thumb */}
            {thumbUrl ? (
                <Image
                    source={{ uri: thumbUrl }}
                    style={styles.thumb}
                    accessibilityIgnoresInvertColors
                />
            ) : (
                <View style={[styles.thumb, { backgroundColor: palette.surfaceContainerHigh }]} />
            )}

            {/* Text block */}
            <View style={styles.textBlock}>
                <View style={styles.nameRow}>
                    <Text
                        style={[
                            styles.restaurantName,
                            {
                                color: isLow ? palette.textMuted : palette.text,
                            },
                        ]}
                        numberOfLines={1}
                    >
                        {r.name ?? 'Unknown restaurant'}
                    </Text>
                    {/* Confirmed chip for exact matches */}
                    {candidate.confidence === 'exact' && (
                        <View style={[styles.confirmedChip, { backgroundColor: palette.oliveCream }]}>
                            <Text style={[Type.labelSmall, { color: palette.secondary }]}>confirmed</Text>
                        </View>
                    )}
                    {/* Checkmark for ticked non-exact rows */}
                    {checked && candidate.confidence !== 'exact' && (
                        <Text style={[Type.bodySmall, { color: palette.primary, marginLeft: Spacing.xs }]}>
                            {'✓'}
                        </Text>
                    )}
                </View>

                {/* City · cuisine metadata */}
                {cityLine ? (
                    <Text
                        style={[
                            Type.bodySmall,
                            { color: palette.textMuted },
                            styles.meta,
                        ]}
                        numberOfLines={1}
                    >
                        {cityLine}
                    </Text>
                ) : null}

                {/* Low confidence quiet treatment */}
                {isLow && !isAlreadySaved && (
                    <Text style={[Type.caption, { color: palette.textMuted }, styles.lowConfMeta]}>
                        not certain · tap to check
                    </Text>
                )}

                {/* Already wishlisted */}
                {isAlreadySaved && (
                    <Text style={[Type.caption, { color: palette.primary }, styles.meta]}>
                        pinned
                    </Text>
                )}
            </View>

            {/* Per-row "not this?" */}
            {!isAlreadySaved && (
                <Pressable
                    onPress={onCorrect}
                    hitSlop={8}
                    accessibilityLabel="not this restaurant?"
                    style={styles.correctButton}
                >
                    <Text style={[Type.caption, { color: palette.textMuted }]}>not this?</Text>
                </Pressable>
            )}
        </Pressable>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    panelTitle: {
        ...Type.headlineItalic,
        marginBottom: Spacing.sm,
    } as any,
    sourceTag: {
        marginBottom: Spacing.sm,
    },
    listScroll: {
        maxHeight: 320,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: Spacing.md,
        borderRadius: Radius.md,
        marginBottom: Spacing.sm,
        minHeight: 64,
        ...Shadow.clip,
    },
    thumb: {
        width: 48,
        height: 48,
        borderRadius: Radius.sm,
        marginRight: Spacing.md,
        flexShrink: 0,
    },
    textBlock: {
        flex: 1,
    },
    nameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'nowrap',
        gap: Spacing.xs,
    },
    restaurantName: {
        ...Type.headlineItalic,
        fontSize: 16,
        flex: 1,
    } as any,
    confirmedChip: {
        paddingHorizontal: Spacing.xs,
        paddingVertical: 2,
        borderRadius: Radius.sm,
        flexShrink: 0,
    },
    meta: {
        marginTop: 2,
    },
    lowConfMeta: {
        marginTop: 2,
    },
    noteWrapper: {
        marginTop: Spacing.sm,
        marginBottom: Spacing.xs,
    },
    noteInputContainer: {
        borderWidth: 1,
        borderRadius: Radius.md,
        padding: Spacing.sm,
        minHeight: 52,
    },
    primaryButton: {
        paddingVertical: Spacing.md,
        borderRadius: Radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 48,
        marginTop: Spacing.sm,
    },
    correctButton: {
        paddingLeft: Spacing.xs,
        paddingVertical: Spacing.xs,
        alignSelf: 'flex-start',
        flexShrink: 0,
    },
});
