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
}

type Palette = typeof Colors.light;

export function SignalStrip({
    you,
    yourTable,
    napkin,
    google,
    activeTier,
    onTierChange,
}: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;

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

                {/* Terracotta underline on active cell */}
                {active ? (
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
});
