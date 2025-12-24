/**
 * TableSwitcher - Dropdown to switch between tables
 */
import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Modal,
    FlatList,
    SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Table, TableMembership } from '@/hooks/tables/useTables';

interface TableSwitcherProps {
    tables: TableMembership[];
    selectedTable: Table | null;
    onSelectTable: (table: Table) => void;
    onCreateTable: () => void;
    theme: {
        text: string;
        textSecondary: string;
        background: string;
        card: string;
        primary: string;
        border: string;
    };
}

export function TableSwitcher({
    tables,
    selectedTable,
    onSelectTable,
    onCreateTable,
    theme,
}: TableSwitcherProps) {
    const [isOpen, setIsOpen] = useState(false);

    const handleSelect = (table: Table) => {
        onSelectTable(table);
        setIsOpen(false);
    };

    return (
        <>
            {/* Trigger Button */}
            <TouchableOpacity
                style={[styles.trigger, { backgroundColor: theme.card }]}
                onPress={() => setIsOpen(true)}
            >
                <Text style={[styles.triggerText, { color: theme.text }]} numberOfLines={1}>
                    {selectedTable?.name ?? 'Select a Table'}
                </Text>
                <Ionicons name="chevron-down" size={20} color={theme.textSecondary} />
            </TouchableOpacity>

            {/* Dropdown Modal */}
            <Modal
                visible={isOpen}
                animationType="slide"
                presentationStyle="pageSheet"
                onRequestClose={() => setIsOpen(false)}
            >
                <SafeAreaView style={[styles.modalContainer, { backgroundColor: theme.background }]}>
                    {/* Header */}
                    <View style={[styles.modalHeader, { borderBottomColor: theme.border }]}>
                        <Text style={[styles.modalTitle, { color: theme.text }]}>Your Tables</Text>
                        <TouchableOpacity onPress={() => setIsOpen(false)}>
                            <Ionicons name="close" size={24} color={theme.text} />
                        </TouchableOpacity>
                    </View>

                    {/* Table List */}
                    <FlatList
                        data={tables}
                        keyExtractor={(item) => item.tables.id}
                        contentContainerStyle={styles.listContent}
                        renderItem={({ item }) => (
                            <TouchableOpacity
                                style={[
                                    styles.tableItem,
                                    { borderBottomColor: theme.border },
                                    selectedTable?.id === item.tables.id && {
                                        backgroundColor: theme.primary + '15',
                                    },
                                ]}
                                onPress={() => handleSelect(item.tables)}
                            >
                                <View style={styles.tableItemContent}>
                                    <Text style={[styles.tableItemName, { color: theme.text }]}>
                                        {item.tables.name}
                                    </Text>
                                    <Text style={[styles.tableItemRole, { color: theme.textSecondary }]}>
                                        {item.role === 'admin' ? '👑 Admin' : 'Member'}
                                    </Text>
                                </View>
                                {selectedTable?.id === item.tables.id && (
                                    <Ionicons name="checkmark" size={20} color={theme.primary} />
                                )}
                            </TouchableOpacity>
                        )}
                        ListFooterComponent={
                            <TouchableOpacity
                                style={[styles.createButton, { borderColor: theme.primary }]}
                                onPress={() => {
                                    setIsOpen(false);
                                    onCreateTable();
                                }}
                            >
                                <Ionicons name="add-circle-outline" size={20} color={theme.primary} />
                                <Text style={[styles.createButtonText, { color: theme.primary }]}>
                                    Create New Table
                                </Text>
                            </TouchableOpacity>
                        }
                    />
                </SafeAreaView>
            </Modal>
        </>
    );
}

const styles = StyleSheet.create({
    trigger: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 12,
        minWidth: 180,
        gap: 8,
    },
    triggerText: {
        fontSize: 16,
        fontWeight: '600',
        flex: 1,
    },
    modalContainer: {
        flex: 1,
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 16,
        borderBottomWidth: 1,
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: '600',
    },
    listContent: {
        padding: 16,
    },
    tableItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 16,
        paddingHorizontal: 12,
        borderBottomWidth: 1,
        borderRadius: 8,
        marginBottom: 8,
    },
    tableItemContent: {
        flex: 1,
    },
    tableItemName: {
        fontSize: 16,
        fontWeight: '500',
        marginBottom: 4,
    },
    tableItemRole: {
        fontSize: 13,
    },
    createButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 14,
        marginTop: 16,
        borderWidth: 2,
        borderRadius: 12,
        borderStyle: 'dashed',
        gap: 8,
    },
    createButtonText: {
        fontSize: 15,
        fontWeight: '600',
    },
});
