/**
 * SupperTable — "the night, gathered" accordion below the centerpiece entry
 * (TICKET-082). Lists every roster member EXCEPT the centerpiece author; each
 * is a one-open-at-a-time accordion row that expands in place to their full take.
 *
 * Header: uppercase Manrope kicker "{N} at the table" + a small amber group-
 * average chip (avg of takes' ratings, 1 decimal) — a sibling signal, never a
 * cross-Table aggregate.
 *
 * Heirloom: warm paper, amber + terracotta accents only, ghosted warm rule
 * between rows (no 1px solid sectioning borders). Italic Newsreader for names.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/theme';
import type { SupperDetail } from '@/hooks/suppers';
import { TableTakeRow } from './TableTakeRow';
import { buildSupperTableModel } from './supperTableUtils';

type Palette = typeof Colors.light;

interface SupperTableProps {
    detail: SupperDetail;
    /** The centerpiece entry's author — excluded from the accordion (they're the hero above). */
    centerpieceUserId: string;
    palette: Palette;
}

export function SupperTable({ detail, centerpieceUserId, palette }: SupperTableProps) {
    const [openId, setOpenId] = useState<string | null>(null);

    const { rows: others, headCount, groupAverage: groupAvg } = buildSupperTableModel(
        detail,
        centerpieceUserId,
    );
    if (others.length === 0) return null;

    return (
        <View style={styles.wrap}>
            {/* Header — kicker + group-average chip */}
            <View style={styles.header}>
                <Text style={[styles.kicker, { color: palette.textMuted }]}>
                    {headCount} at the table
                </Text>
                {groupAvg != null ? (
                    <View style={[styles.avgChip, { backgroundColor: palette.tertiaryFixed }]}>
                        <Text style={[styles.avgLabel, { color: palette.tertiary }]}>avg</Text>
                        <Text style={[styles.avgNum, { color: palette.tertiary }]}>
                            {groupAvg.toFixed(1)}
                        </Text>
                    </View>
                ) : null}
            </View>

            {/* Rows */}
            <View>
                {others.map(({ member, take }, i) => (
                    <View key={member.user_id}>
                        {i > 0 ? (
                            <View style={[styles.rule, { backgroundColor: palette.divider }]} />
                        ) : null}
                        <TableTakeRow
                            member={member}
                            take={take}
                            open={openId === member.user_id}
                            onToggle={() =>
                                setOpenId((prev) => (prev === member.user_id ? null : member.user_id))
                            }
                            palette={palette}
                        />
                    </View>
                ))}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        paddingHorizontal: 14,
        paddingTop: 24,
        paddingBottom: 8,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 6,
    },
    kicker: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
    },
    avgChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 9,
        paddingVertical: 3,
        borderRadius: 999,
    },
    avgLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
    },
    avgNum: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
    },
    rule: {
        height: 1,
        marginLeft: 43,
    },
});
