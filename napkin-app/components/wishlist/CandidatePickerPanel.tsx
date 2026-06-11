/**
 * CandidatePickerPanel — multi-candidate list panel for import (TICKET-063).
 *
 * TICKET-069 phase 2: restyled to canvas "import spot-picker" anatomy.
 *
 * Canvas anatomy:
 *   kicker "FROM TIKTOK · @{handle}"
 *   italic serif 23 title + quiet close × (onDismiss)
 *   flat rows: 48px r12 initial-tile · italic serif 16 name · italic serif 13 murmur + terracotta "fix"
 *              26px ✓ circle toggle · un-ticked at opacity 0.45
 *   footer murmur italic serif 13
 *   PIN pill (full width, terracotta)
 *
 * All TICKET-063 logic (ticked/unticked, controlled props, partial-failure, save handler,
 * share-to-table, note field, already_wishlisted) is preserved unchanged.
 *
 * Rows with candidate.confidence === 'low' are un-ticked by default and shown at
 * reduced opacity. The "fix" affordance replaces the former "not this?" label.
 */
import React, { useCallback, useMemo } from 'react';
import {
    View,
    Text,
    TextInput,
    Pressable,
    ScrollView,
    StyleSheet,
    ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
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
    /** Called when the user taps "fix" on a specific row (replaces "not this?"). */
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
     */
    onShareToTable?: () => void;
    /**
     * The table chosen via the DestinationPicker (if any).
     * When set, shows "sharing to {name}" + × instead of "share to a table".
     */
    chosenTable?: { id: string; name: string } | null;
    /** Clears the chosen table when the user taps ×. */
    onClearTable?: () => void;
    /** TICKET-069: dismiss button (×) for the panel header. */
    onDismiss?: () => void;
    // ── TICKET-072: handoff receive props (all optional, default to import behavior) ──
    /**
     * Override the kicker text. When set, replaces the `sourceTag` display.
     * Receive screen passes `{SHARER_NAME}'S NAPKIN` (uppercase).
     */
    kickerOverride?: string;
    /**
     * Override the panel title (italic serif 23).
     * Receive screen passes `{N} spots`.
     */
    titleOverride?: string;
    /**
     * When true, hides the terracotta "fix" affordance on each row.
     * Receive screen sets this — "fix" is meaningless on a frozen snapshot.
     */
    hideCorrect?: boolean;
    /**
     * When true, hides the single-ticked note input field.
     * Receive screen sets this — notes are privacy-gated on handoffs.
     */
    hideNote?: boolean;
    /**
     * Custom murmur per row — appended after city · cuisine.
     * Return null/empty string to show no custom murmur.
     * Receive screen passes: `(c) => c.sharer_rating != null ? \`their ${c.sharer_rating}\` : null`
     */
    rowMurmur?: (candidate: ResolvedCandidate) => string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Get the initial letter for the 48px initial-tile. */
function initialChar(name: string | null | undefined): string {
    if (!name) return '?';
    return name.trim()[0]?.toUpperCase() ?? '?';
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
    onDismiss,
    kickerOverride,
    titleOverride,
    hideCorrect,
    hideNote,
    rowMurmur,
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
    const hasResolvedTicked = useMemo(
        () => tickedCandidates.some((c) => isResolved(c)),
        [tickedCandidates],
    );
    const hasGhostTicked = useMemo(
        () => !!chosenTable && tickedCandidates.some((c) => !isResolved(c)),
        [tickedCandidates, chosenTable],
    );

    // CTA label — canvas says "PIN" uppercase pill
    const ctaLabel = 'PIN';

    // Panel title — italic serif 23. Override takes precedence for handoff receives.
    const panelTitle = titleOverride ?? (candidates.length === 1
        ? 'one spot found'
        : `${candidates.length} spots in this video`);

    // Kicker text — override takes precedence for handoff receives.
    const kickerText = kickerOverride ?? sourceTag;

    const handleSave = useCallback(() => {
        if (tickedCount === 0) return;
        onSave(tickedCandidates, isSingleTicked ? noteText.trim() : '');
    }, [tickedCandidates, tickedCount, isSingleTicked, noteText, onSave]);

    return (
        <View>
            {/* Kicker + title + close row */}
            <View style={styles.header}>
                <View style={styles.headerText}>
                    {kickerText ? (
                        <Text style={[styles.kicker, { color: palette.textSecondary }]}>
                            {kickerText.toUpperCase()}
                        </Text>
                    ) : null}
                    <Text style={[styles.title, { color: palette.text }]}>
                        {panelTitle}
                    </Text>
                </View>
                {onDismiss ? (
                    <Pressable
                        onPress={onDismiss}
                        hitSlop={12}
                        accessibilityLabel="close"
                        style={styles.closeBtn}
                    >
                        <Ionicons name="close" size={20} color={palette.textMuted} />
                    </Pressable>
                ) : null}
            </View>

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
                            hideCorrect={hideCorrect}
                            extraMurmur={rowMurmur ? rowMurmur(c) : null}
                        />
                    );
                })}
            </ScrollView>

            {/* Footer murmur */}
            <Text style={[styles.footerMurmur, { color: palette.textMuted }]}>
                {tickedCount === 0
                    ? 'tap a spot to select it'
                    : tickedCount === 1
                    ? `1 spot selected`
                    : `${tickedCount} spots selected`}
            </Text>

            {/* Single-ticked note field — hidden when hideNote is true (e.g. handoff receive) */}
            {isSingleTicked && !hideNote && (
                <View style={styles.noteWrapper}>
                    <Text
                        style={[Type.caption, { color: palette.textMuted, marginBottom: Spacing.xs }]}
                    >
                        add a note (optional)
                    </Text>
                    <View
                        style={[
                            styles.noteInputContainer,
                            { borderColor: palette.ruleInkSoft },
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

            {/* PIN pill */}
            <Pressable
                onPress={handleSave}
                disabled={isSaving || tickedCount === 0}
                accessibilityLabel={tickedCount === 0 ? 'pin' : `pin ${tickedCount} spot${tickedCount > 1 ? 's' : ''}`}
                style={({ pressed }) => [
                    styles.pinBtn,
                    {
                        backgroundColor: tickedCount > 0 ? palette.primary : palette.surfaceContainerHigh,
                        opacity: pressed || isSaving ? 0.75 : 1,
                    },
                ]}
            >
                {isSaving ? (
                    <ActivityIndicator color="#fffdf8" size="small" />
                ) : (
                    <Text style={[styles.pinBtnLabel, { color: tickedCount > 0 ? '#fffdf8' : palette.textMuted }]}>
                        {ctaLabel}
                    </Text>
                )}
            </Pressable>

            {/* ── TICKET-063b: share-to-table secondary affordance ─────────────── */}
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
    hasFailed: boolean;
    onToggle: () => void;
    onCorrect: () => void;
    onOpenRestaurant?: (restaurantId: string) => void;
    palette: Palette;
    /** TICKET-072: when true, suppresses the terracotta "fix" affordance. */
    hideCorrect?: boolean;
    /**
     * TICKET-072: extra murmur appended after city · cuisine.
     * e.g. "their 4.5" for handoff receive rows.
     */
    extraMurmur?: string | null;
}

function CandidateRow({
    candidate,
    checked,
    hasFailed,
    onToggle,
    onCorrect,
    onOpenRestaurant,
    palette,
    hideCorrect,
    extraMurmur,
}: CandidateRowProps) {
    const r = candidate.restaurant;
    const isLow = candidate.confidence === 'low';
    const isAlreadySaved = candidate.already_wishlisted;

    // City/cuisine murmur — append extraMurmur (e.g. sharer rating) when present
    let cityPart = r.city ?? '';
    if (candidate.city_inferred && cityPart) {
        cityPart = `${cityPart} · guessed`;
    }
    const murmur = [
        cityPart,
        r.cuisine,
        isLow && !isAlreadySaved ? 'uncertain' : null,
        extraMurmur || null,
    ].filter(Boolean).join(' · ');

    return (
        <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isAlreadySaved ? true : checked }}
            accessibilityLabel={`${checked ? 'Remove' : 'Add'} ${r.name ?? 'restaurant'}`}
            onPress={isAlreadySaved ? undefined : onToggle}
            style={[
                styles.row,
                { opacity: (checked || isAlreadySaved) ? 1 : 0.45 },
            ]}
        >
            {/* 48px r12 initial-tile */}
            <View style={[styles.tile, { backgroundColor: palette.surfaceContainerHigh }]}>
                <Text style={[styles.tileInitial, { color: palette.textSecondary }]}>
                    {initialChar(r.name)}
                </Text>
            </View>

            {/* Text block */}
            <View style={styles.textBlock}>
                <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                    {r.name ?? 'Unknown restaurant'}
                </Text>
                {(murmur || hasFailed) ? (
                    <View style={styles.murmurRow}>
                        {murmur ? (
                            <Text style={[styles.murmurText, { color: palette.textMuted }]} numberOfLines={1}>
                                {murmur}
                            </Text>
                        ) : null}
                        {/* Terracotta "fix" replaces "not this?" — hidden for handoff rows */}
                        {!isAlreadySaved && !hideCorrect && (
                            <Pressable
                                onPress={onCorrect}
                                hitSlop={8}
                                accessibilityLabel="fix restaurant match"
                            >
                                <Text style={[styles.fixLabel, { color: palette.primary }]}>
                                    fix
                                </Text>
                            </Pressable>
                        )}
                        {hasFailed && !murmur ? (
                            <Text style={[styles.murmurText, { color: palette.textMuted }]}>
                                {"couldn't pin · tap to retry"}
                            </Text>
                        ) : null}
                    </View>
                ) : null}
                {isAlreadySaved && (
                    <View style={styles.alreadySavedRow}>
                        <Text style={[Type.caption, { color: palette.primary }]}>pinned</Text>
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

            {/* 26px ✓ circle toggle */}
            {!isAlreadySaved && (
                <View
                    style={[
                        styles.toggle,
                        {
                            borderColor: checked ? palette.primary : 'rgba(138,114,108,0.3)',
                            backgroundColor: checked ? palette.primary : 'transparent',
                        },
                    ]}
                >
                    {checked && (
                        <Text style={styles.toggleCheck}>✓</Text>
                    )}
                </View>
            )}
        </Pressable>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    // Header
    header: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: Spacing.sm,
        marginBottom: 12,
    },
    headerText: {
        flex: 1,
        gap: 4,
    },
    kicker: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1.4,
    },
    title: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 23,
        lineHeight: 28,
    },
    closeBtn: {
        paddingTop: 4,
    },
    // Row list
    listScroll: {
        maxHeight: 320,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 10,
    },
    tile: {
        width: 48,
        height: 48,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    tileInitial: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 22,
        lineHeight: 26,
    },
    textBlock: {
        flex: 1,
        gap: 2,
    },
    name: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 16,
        lineHeight: 20,
    },
    murmurRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'nowrap',
    },
    murmurText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
        lineHeight: 17,
        flex: 1,
    },
    fixLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11,
        letterSpacing: 0.3,
    },
    alreadySavedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 2,
    },
    // Toggle circle
    toggle: {
        width: 26,
        height: 26,
        borderRadius: 13,
        borderWidth: 1.5,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    toggleCheck: {
        fontSize: 13,
        color: '#fffdf8',
        lineHeight: 16,
    },
    // Footer murmur
    footerMurmur: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
        lineHeight: 18,
        textAlign: 'center',
        paddingVertical: 8,
    },
    // Note field
    noteWrapper: {
        marginBottom: Spacing.xs,
    },
    noteInputContainer: {
        borderWidth: 1,
        borderRadius: Radius.md,
        padding: Spacing.sm,
        minHeight: 52,
    },
    // PIN pill
    pinBtn: {
        paddingVertical: 14,
        borderRadius: Radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 48,
        marginTop: Spacing.sm,
    },
    pinBtnLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 1.6,
        textTransform: 'uppercase',
    },
    // Share-to-table
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
