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
import React, { useCallback, useMemo } from 'react';
import {
    View,
    Text,
    TextInput,
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
import { keyFor, buildInitialTicked, isResolved } from './candidatePickerUtils';

// Re-export for external consumers (ImportLinkSheet + tests) without requiring
// them to import from the utils file separately.
export { keyFor, buildInitialTicked, isResolved };

type Palette = typeof Colors.light;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CandidatePickerPanelProps {
    candidates: ResolvedCandidate[];
    onSave: (
        ticked: ResolvedCandidate[],
        note: string,
    ) => void;
    isSaving: boolean;
    sourceTag: string | null;
    /** Called when the user taps "not this?" on a specific row. */
    onCorrectRow: (candidate: ResolvedCandidate) => void;
    /** Called when the user taps "open restaurant" on an already_pinned row. */
    onOpenRestaurant?: (restaurantId: string) => void;
    /** Set of candidate keys that failed on last save attempt (shown as "couldn't pin · tap to retry"). */
    failedCandidateKeys?: Set<string>;
    palette?: Palette;
    // ── Controlled ticked + note (fix-pass-2 item 5) ──────────────────────────
    /**
     * Controlled ticked set — owned by ImportLinkSheet so it survives
     * picking ↔ editing-match transitions.
     */
    ticked: Set<string>;
    /**
     * Called when the user toggles a row. ImportLinkSheet updates tickedKeys state.
     */
    onToggleTicked: (key: string) => void;
    /**
     * Note text value — owned by ImportLinkSheet so it survives
     * picking ↔ editing-match transitions.
     */
    noteText: string;
    /** Called when the user changes the note TextInput. */
    onNoteChange: (text: string) => void;
    // ── TICKET-063b: share-to-table affordance ─────────────────────────────────
    /**
     * When set, shows a quiet "share to a table" secondary affordance below the
     * primary CTA. Visible only when ≥1 ticked spot is Places-resolved.
     * Opens the DestinationPicker in singleTableOnly mode.
     */
    onShareToTable?: () => void;
    /**
     * The table chosen via the DestinationPicker (if any).
     * When set, shows "sharing to {name}" + × instead of "share to a table".
     */
    chosenTable?: { id: string; name: string } | null;
    /** Clears the chosen table when the user taps ×. */
    onClearTable?: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function photoUrl(photoReference: string | null | undefined): string | null {
    return placesPhotoProxyUrl(photoReference, { width: 200 }) ?? null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CandidatePickerPanel({
    candidates,
    onSave,
    isSaving,
    sourceTag,
    onCorrectRow,
    onOpenRestaurant,
    failedCandidateKeys,
    palette: paletteProp,
    ticked,
    onToggleTicked,
    noteText,
    onNoteChange,
    onShareToTable,
    chosenTable,
    onClearTable,
}: CandidatePickerPanelProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = paletteProp ?? (Colors[scheme] as Palette);

    const toggleCandidate = useCallback((c: ResolvedCandidate) => {
        onToggleTicked(keyFor(c));
    }, [onToggleTicked]);

    const tickedCandidates = useMemo(
        () => candidates.filter((c) => ticked.has(keyFor(c)) && !c.already_wishlisted),
        [candidates, ticked],
    );

    const tickedCount = tickedCandidates.length;
    const isSingleTicked = tickedCount === 1;

    // ── TICKET-063b: share-to-table eligibility ───────────────────────────────
    // "share to a table" appears only when ≥1 ticked spot has a confirmed Places
    // identity (restaurant_id OR external_id).  Ghosts save wishlist-only.
    const hasResolvedTicked = useMemo(
        () => tickedCandidates.some((c) => isResolved(c)),
        [tickedCandidates],
    );
    // True when a table is chosen AND some ticked spots are still ghosts — shows
    // "confirm it first · pinned to your wishlist only" quietly.
    const hasGhostTicked = useMemo(
        () => !!chosenTable && tickedCandidates.some((c) => !isResolved(c)),
        [tickedCandidates, chosenTable],
    );

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
                    const hasFailed = failedCandidateKeys?.has(k) ?? false;
                    return (
                        <CandidateRow
                            key={k}
                            candidate={c}
                            checked={isChecked}
                            hasFailed={hasFailed}
                            onToggle={() => toggleCandidate(c)}
                            onCorrect={() => onCorrectRow(c)}
                            onOpenRestaurant={onOpenRestaurant}
                            palette={palette}
                        />
                    );
                })}
            </ScrollView>

            {/* Single-ticked note field — real TextInput (fix-pass-1 item 10) */}
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
                        <TextInput
                            value={noteText}
                            onChangeText={onNoteChange}
                            placeholder="what made it memorable…"
                            placeholderTextColor={palette.textMuted}
                            multiline
                            style={[Type.body, { color: palette.text, minHeight: 36 }]}
                            accessibilityLabel="add a note"
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

            {/* ── TICKET-063b: share-to-table secondary affordance ─────────────── */}
            {/* Visible only when ≥1 ticked spot is Places-resolved. */}
            {onShareToTable && hasResolvedTicked && (
                <View style={styles.shareTableBlock}>
                    <View style={styles.shareTableRow}>
                        {chosenTable ? (
                            <>
                                <Text style={[Type.caption, { color: palette.textMuted }]}>
                                    {'sharing to '}
                                    <Text style={{ fontFamily: 'Newsreader_400Regular_Italic' }}>
                                        {chosenTable.name}
                                    </Text>
                                </Text>
                                <Pressable
                                    onPress={onClearTable}
                                    hitSlop={8}
                                    accessibilityLabel="remove table selection"
                                    style={styles.clearTableButton}
                                >
                                    <Text style={[Type.caption, { color: palette.textMuted }]}>
                                        {'×'}
                                    </Text>
                                </Pressable>
                            </>
                        ) : (
                            <Pressable
                                onPress={onShareToTable}
                                hitSlop={8}
                                accessibilityLabel="share to a table"
                            >
                                <Text style={[Type.caption, { color: palette.textMuted }]}>
                                    share to a table
                                </Text>
                            </Pressable>
                        )}
                    </View>
                    {/* Ghost note: ticked spots that are unresolved save wishlist-only */}
                    {hasGhostTicked && (
                        <Text style={[Type.caption, styles.ghostNote, { color: palette.textMuted }]}>
                            {'confirm it first · pinned to your wishlist only'}
                        </Text>
                    )}
                </View>
            )}
        </View>
    );
}

// ── CandidateRow ──────────────────────────────────────────────────────────────

interface CandidateRowProps {
    candidate: ResolvedCandidate;
    checked: boolean;
    /** True when this spot failed on the last save attempt. */
    hasFailed: boolean;
    onToggle: () => void;
    onCorrect: () => void;
    onOpenRestaurant?: (restaurantId: string) => void;
    palette: Palette;
}

function CandidateRow({
    candidate,
    checked,
    hasFailed,
    onToggle,
    onCorrect,
    onOpenRestaurant,
    palette,
}: CandidateRowProps) {
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
                {isLow && !isAlreadySaved && !hasFailed && (
                    <Text style={[Type.caption, { color: palette.textMuted }, styles.lowConfMeta]}>
                        not certain · tap to check
                    </Text>
                )}

                {/* Partial-failure: "couldn't pin · tap to retry" (fix-pass-1 item 8) */}
                {hasFailed && (
                    <Text style={[Type.caption, { color: palette.textMuted }, styles.lowConfMeta]}>
                        {"couldn't pin · tap to retry"}
                    </Text>
                )}

                {/* Already wishlisted + "open restaurant" affordance (fix-pass-1 item 11) */}
                {isAlreadySaved && (
                    <View style={styles.alreadySavedRow}>
                        <Text style={[Type.caption, { color: palette.primary }]}>
                            pinned
                        </Text>
                        {candidate.restaurant_id && onOpenRestaurant && (
                            <Pressable
                                onPress={() => onOpenRestaurant(candidate.restaurant_id!)}
                                hitSlop={8}
                                accessibilityLabel="open restaurant page"
                            >
                                <Text style={[Type.caption, { color: palette.textMuted, marginLeft: Spacing.xs }]}>
                                    · open restaurant
                                </Text>
                            </Pressable>
                        )}
                    </View>
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
    alreadySavedRow: {
        flexDirection: 'row',
        alignItems: 'center',
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
    shareTableBlock: {
        marginTop: Spacing.sm,
        alignItems: 'center',
    },
    shareTableRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xs,
    },
    clearTableButton: {
        paddingHorizontal: Spacing.xs,
    },
    ghostNote: {
        marginTop: Spacing.xs,
        textAlign: 'center',
        opacity: 0.7,
    },
});
