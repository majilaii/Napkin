/**
 * TableShareFooter — quiet olive footer strip for sharing to a Table.
 * Only renders when the user has ≥1 Table (caller is responsible for this gate).
 *
 * Default: toggle OFF (Q9 decision — solo-is-default posture).
 * Single Table: shows "also share to [Table name]" toggle.
 * Multiple Tables: same, but table name is tappable to open bottom sheet picker.
 *
 * Wireframe A2: share-footer grammar — olive bg, italic serif label.
 */
import React from 'react';
import { View, Text, Pressable, Switch, StyleSheet } from 'react-native';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Table {
    id: string;
    name: string;
}

interface Props {
    tables: Table[];
    selectedTableId: string | null;
    shareEnabled: boolean;
    onToggleShare: (enabled: boolean) => void;
    onSelectTable?: (tableId: string) => void;
}

export function TableShareFooter({
    tables,
    selectedTableId,
    shareEnabled,
    onToggleShare,
    onSelectTable,
}: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    if (tables.length === 0) return null;

    const selectedTable = tables.find(t => t.id === selectedTableId) ?? tables[0];
    const hasMultipleTables = tables.length > 1;

    return (
        <View style={[styles.footer, { backgroundColor: 'rgba(107,124,58,0.08)' }]}>
            <View style={styles.left}>
                <Text style={[styles.label, { color: palette.secondary }]}>
                    {'also share to '}
                </Text>
                {hasMultipleTables && onSelectTable ? (
                    <Pressable onPress={() => onSelectTable(selectedTable.id)}>
                        <Text style={[styles.tableName, { color: palette.secondary }]}>
                            {selectedTable.name}
                        </Text>
                    </Pressable>
                ) : (
                    <Text style={[styles.tableName, { color: palette.secondary }]}>
                        {selectedTable.name}
                    </Text>
                )}
            </View>
            <Switch
                value={shareEnabled}
                onValueChange={onToggleShare}
                trackColor={{ false: 'rgba(92,97,77,0.2)', true: 'rgba(92,97,77,0.5)' }}
                thumbColor={shareEnabled ? palette.secondary : palette.textMuted}
                ios_backgroundColor="rgba(92,97,77,0.2)"
            />
        </View>
    );
}

const styles = StyleSheet.create({
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm + 2,
        borderRadius: Radius.md,
        marginTop: Spacing.md,
    },
    left: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        flexWrap: 'wrap',
    },
    label: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
    },
    tableName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
        textDecorationLine: 'underline',
    },
});
