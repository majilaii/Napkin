/**
 * SignalStrip — four-cell signal row for the restaurant page v3.
 *
 * Cells: You · Your table · Napkin · Google
 * Ghost vertical rules between cells (no boxes).
 * Active cell gets a terracotta underline.
 * Google cell is always inert (no histogram data).
 * Cells with no data render ghosted (— / muted sub).
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type SignalTier = 'you' | 'your_table' | 'napkin';

export interface SignalCellData {
    label: string;
    value: number | null;  // the average rating
    sub: string;           // e.g. "3 visits" or "5 of you" or "47 folks"
    hasData: boolean;
    inert?: boolean;       // Google cell — no histogram
}

interface Props {
    you: SignalCellData;
    yourTable: SignalCellData;
    napkin: SignalCellData;
    google: SignalCellData;
    activeTier: SignalTier;
    onTierChange: (tier: SignalTier) => void;
    /**
     * When true, only cells with `hasData` are rendered (ghost/cold arrival).
     * The four-cell strip renders when ≥2 siblings are populated; otherwise collapse.
     * Doctrine: omitting empty siblings ≠ merging tiers.
     */
    collapsed?: boolean;
    /**
     * TICKET-069: "letterpress" variant — surface-journal-low pill, amber numbers,
     * no sub-label, no active underline. Matches the take-B canvas signal strip.
     */
    letterpress?: boolean;
}

type Palette = typeof Colors.light;

export function SignalStrip({
    you,
    yourTable,
    napkin,
    google,
    activeTier,
    onTierChange,
    collapsed = false,
    letterpress = false,
}: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;

    // Letterpress variant (TICKET-069 take-B canvas): pill container, amber numbers, no sub-label.
    // Collapse logic is preserved — only cells with data are shown when collapsed.
    if (letterpress) {
        const cells: Array<{ key: string; data: SignalCellData; tier: SignalTier | null; isYou: boolean }> = [
            { key: 'you', data: you, tier: 'you', isYou: true },
            { key: 'table', data: yourTable, tier: 'your_table', isYou: false },
            { key: 'napkin', data: napkin, tier: 'napkin', isYou: false },
            { key: 'google', data: google, tier: null, isYou: false },
        ];
        const visibleCells = collapsed
            ? cells.filter((c) => c.data.hasData)
            : cells;

        return (
            <View
                style={[
                    lpStyles.strip,
                    { backgroundColor: palette.surfaceJournalLow },
                ]}
            >
                {visibleCells.map((c, i) => {
                    const isEmpty = !c.data.hasData;
                    const isActive = c.tier === activeTier;
                    const ruleColor = 'rgba(138, 114, 108, 0.2)';
                    return (
                        <Pressable
                            key={c.key}
                            onPress={c.tier && !isEmpty ? () => onTierChange(c.tier as SignalTier) : undefined}
                            disabled={!c.tier || isEmpty}
                            hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                            style={[
                                lpStyles.cell,
                                i > 0 && { borderLeftWidth: 1, borderLeftColor: ruleColor },
                            ]}
                        >
                            <Text
                                style={[
                                    lpStyles.cellLabel,
                                    {
                                        color: c.isYou && isActive
                                            ? palette.primary
                                            : c.isYou
                                            ? palette.primary
                                            : palette.textMuted,
                                    },
                                ]}
                            >
                                {c.data.label.toUpperCase()}
                            </Text>
                            <Text
                                style={[
                                    lpStyles.cellNum,
                                    {
                                        color: isEmpty ? palette.textMuted : '#825516',
                                        opacity: isEmpty ? 0.35 : 1,
                                    },
                                ]}
                            >
                                {c.data.value != null ? c.data.value.toFixed(1) : '—'}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
        );
    }

    if (collapsed) {
        // Collapse: only render cells that have data + a quiet "— no napkin reads yet" note.
        // Doctrine: omitting empty siblings ≠ merging tiers; four-cell strip renders when ≥2 populated.
        const visibleCells: Array<{ key: string; data: SignalCellData; tier: SignalTier | null; inert: boolean }> = [];
        if (you.hasData) visibleCells.push({ key: 'you', data: you, tier: 'you', inert: false });
        if (yourTable.hasData) visibleCells.push({ key: 'table', data: yourTable, tier: 'your_table', inert: false });
        if (napkin.hasData) visibleCells.push({ key: 'napkin', data: napkin, tier: 'napkin', inert: false });
        if (google.hasData) visibleCells.push({ key: 'google', data: google, tier: null, inert: true });

        const hasAnyNapkinData = napkin.hasData;

        return (
            <View>
                <View style={[styles.strip, { borderBottomColor: 'transparent' }]}>
                    {visibleCells.map((c, i) => (
                        <SigCell
                            key={c.key}
                            data={c.data}
                            active={c.tier === activeTier}
                            onPress={c.tier ? () => onTierChange(c.tier as SignalTier) : undefined}
                            palette={palette}
                            inert={c.inert}
                            isFirst={i === 0}
                        />
                    ))}
                </View>
                {!hasAnyNapkinData ? (
                    <Text style={[styles.noNapkinNote, { color: palette.textMuted }]}>
                        no napkin reads yet
                    </Text>
                ) : null}
            </View>
        );
    }

    return (
        <View style={[styles.strip, { borderBottomColor: 'transparent' }]}>
            <SigCell
                data={you}
                active={activeTier === 'you'}
                onPress={() => onTierChange('you')}
                palette={palette}
                isFirst
            />
            <SigCell
                data={yourTable}
                active={activeTier === 'your_table'}
                onPress={() => onTierChange('your_table')}
                palette={palette}
            />
            <SigCell
                data={napkin}
                active={activeTier === 'napkin'}
                onPress={() => onTierChange('napkin')}
                palette={palette}
            />
            <SigCell
                data={google}
                active={false}
                onPress={undefined}
                palette={palette}
                inert
            />
        </View>
    );
}

function SigCell({
    data,
    active,
    onPress,
    palette,
    inert = false,
    isFirst = false,
}: {
    data: SignalCellData;
    active: boolean;
    onPress?: () => void;
    palette: Palette;
    inert?: boolean;
    isFirst?: boolean;
}) {
    const isEmpty = !data.hasData;
    const ruleColor = 'rgba(138, 114, 108, 0.3)';

    return (
        <View style={[styles.cellWrapper, !isFirst && { borderLeftWidth: 1, borderLeftColor: ruleColor }]}>
            <Pressable
                onPress={inert || isEmpty ? undefined : onPress}
                disabled={inert || isEmpty}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                style={({ pressed }) => [
                    styles.cell,
                    pressed && !inert && !isEmpty && { opacity: 0.7 },
                ]}
            >
                <Text
                    style={[
                        styles.cellLabel,
                        { color: active ? palette.primary : palette.textMuted },
                    ]}
                >
                    {data.label.toUpperCase()}
                </Text>
                <Text
                    style={[
                        styles.cellNum,
                        {
                            color: isEmpty ? palette.textMuted : palette.text,
                            opacity: isEmpty ? 0.35 : 1,
                        },
                    ]}
                >
                    {data.value != null ? data.value.toFixed(1) : '—'}
                </Text>
                <Text
                    style={[
                        styles.cellSub,
                        {
                            color: palette.textMuted,
                            opacity: isEmpty ? 0.55 : 1,
                        },
                    ]}
                >
                    {data.sub}
                </Text>

                {/* Terracotta underline on active cell — never drawn under a "—" (empty) cell */}
                {active && !isEmpty ? (
                    <View
                        style={[
                            styles.activeUnderline,
                            { backgroundColor: palette.primary },
                        ]}
                    />
                ) : null}
            </Pressable>
        </View>
    );
}

// Letterpress variant styles (TICKET-069)
const lpStyles = StyleSheet.create({
    strip: {
        flexDirection: 'row',
        borderRadius: 16,
        marginHorizontal: 24,
    },
    cell: {
        flex: 1,
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        paddingVertical: 14,
    },
    cellLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
    },
    cellNum: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 22,
        lineHeight: 24,
    },
});

const styles = StyleSheet.create({
    strip: {
        flexDirection: 'row',
        paddingHorizontal: 22,
        paddingTop: 16,
    },
    cellWrapper: {
        flex: 1,
    },
    cell: {
        paddingVertical: 10,
        paddingHorizontal: 6,
        alignItems: 'center',
        position: 'relative',
        minHeight: 44,
        justifyContent: 'center',
    },
    cellLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 8.5,
        letterSpacing: 1.1,
        textTransform: 'uppercase',
        marginBottom: 4,
    },
    cellNum: {
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 24,
        lineHeight: 26,
    },
    cellSub: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 9.5,
        marginTop: 3,
    },
    activeUnderline: {
        position: 'absolute',
        bottom: -8,
        left: '20%',
        right: '20%',
        height: 2,
        borderRadius: 1,
    },
    noNapkinNote: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 11.5,
        paddingHorizontal: 22,
        paddingTop: 8,
        paddingBottom: 4,
        opacity: 0.55,
    },
});
