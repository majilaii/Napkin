/**
 * TableListsBlock — TICKET-115 "Table lists".
 *
 * The Table's shared collaborative lists, surfaced on the Table's Lists tab.
 * Reuses ListCard (one grammar — no new list surface). A "+ new list" row
 * routes to the create screen with the Table context so the new list is
 * shared + forced private.
 *
 * Data comes from useMyLists (which now includes the caller's Tables' lists);
 * we filter to this Table by table_id. Empty → a single quiet invitation line.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useMyLists } from '@/hooks/lists/useMyLists';
import { ListCard } from '@/components/lists';

type Palette = typeof Colors.light;

interface Props {
    tableId: string;
    tableName: string | null | undefined;
    /** The section label is redundant when the block IS the Lists tab. */
    hideLabel?: boolean;
}

export function TableListsBlock({ tableId, tableName, hideLabel }: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;
    const router = useRouter();
    const { user } = useAuth();

    const { data: allLists } = useMyLists(user?.id);
    const tableLists = React.useMemo(
        () => (allLists ?? []).filter((l) => l.table_id === tableId),
        [allLists, tableId],
    );

    const handleNewList = () => {
        router.push({
            pathname: '/list/new',
            params: { tableId, ...(tableName ? { tableName } : {}) },
        });
    };

    return (
        <View style={styles.container}>
            <View style={[styles.headerRow, hideLabel && { justifyContent: 'flex-end' }]}>
                {!hideLabel && (
                    <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>Lists</Text>
                )}
                <Pressable onPress={handleNewList} hitSlop={8} style={styles.newBtn}>
                    <Ionicons name="add" size={16} color={palette.primary} />
                    <Text style={[Type.bodySmall, { color: palette.primary }]}>new list</Text>
                </Pressable>
            </View>

            {tableLists.length === 0 ? (
                <Text style={[Type.bodySmall, { color: palette.textMuted, marginTop: Spacing.xs }]}>
                    — start a shared list anyone at the table can add to
                </Text>
            ) : (
                <View style={{ gap: Spacing.sm, marginTop: Spacing.sm }}>
                    {tableLists.map((list) => (
                        <ListCard
                            key={list.id}
                            list={list}
                            onPress={() =>
                                router.push({ pathname: '/list/[id]', params: { id: list.id } })
                            }
                        />
                    ))}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.md,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    sectionLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
    },
    newBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
    },
});
