/**
 * Tables Tab - Main tables screen with table switcher and content
 */
import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    SafeAreaView,
    ScrollView,
    TouchableOpacity,
    RefreshControl,
    ActivityIndicator,
    Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useTables, Table } from '@/hooks/tables/useTables';
import { useTableDetail } from '@/hooks/tables/useTableDetail';
import { useCreateTable } from '@/hooks/tables/useCreateTable';
import {
    TableHeader,
    TableSwitcher,
    EmptyTableState,
    CreateTableModal,
} from '@/components/tables';

type TabType = 'activity' | 'wishlist' | 'stats' | 'top4';

export default function TablesScreen() {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];

    const { user } = useAuth();
    const userId = user?.id ?? null;

    // Fetch user's tables
    const {
        data: tablesData = [],
        isLoading: tablesLoading,
        refetch: refetchTables,
    } = useTables(userId);

    // Selected table state
    const [selectedTable, setSelectedTable] = useState<Table | null>(null);
    const [activeTab, setActiveTab] = useState<TabType>('activity');
    const [createModalVisible, setCreateModalVisible] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    // Set initial selected table when data loads
    useEffect(() => {
        if (tablesData.length > 0 && !selectedTable) {
            setSelectedTable(tablesData[0].tables);
        }
    }, [tablesData, selectedTable]);

    // Fetch selected table details
    const {
        data: tableDetail,
        isLoading: detailLoading,
        refetch: refetchDetail,
    } = useTableDetail(selectedTable?.id ?? null);

    // Create table mutation
    const createTableMutation = useCreateTable(userId);

    const handleCreateTable = async (name: string) => {
        await createTableMutation.mutateAsync({ name });
        // After creation, the new table will appear via refetch
    };

    const onRefresh = async () => {
        setRefreshing(true);
        await Promise.all([refetchTables(), selectedTable && refetchDetail()]);
        setRefreshing(false);
    };

    const hasNoTables = !tablesLoading && tablesData.length === 0;
    const isLoading = tablesLoading || (selectedTable && detailLoading);
    const members = (tableDetail?.members ?? []).map(m => ({
        member_id: m.user_id,
        role: m.role,
        joined_at: m.joined_at,
        profiles: {
            display_name: m.profiles.display_name,
            avatar_url: m.profiles.avatar_url ?? undefined,
        },
    }));

    const tabs: { key: TabType; label: string; icon: string }[] = [
        { key: 'activity', label: 'Activity', icon: 'newspaper-outline' },
        { key: 'wishlist', label: 'Wishlist', icon: 'bookmark-outline' },
        { key: 'stats', label: 'Stats', icon: 'stats-chart-outline' },
        { key: 'top4', label: 'Top 4', icon: 'trophy-outline' },
    ];

    const renderTabContent = () => {
        switch (activeTab) {
            case 'activity':
                return (
                    <View style={styles.tabContent}>
                        <Text style={[styles.comingSoon, { color: theme.textSecondary }]}>
                            Activity feed coming in Phase 3
                        </Text>
                    </View>
                );
            case 'wishlist':
                return (
                    <View style={styles.tabContent}>
                        <Text style={[styles.comingSoon, { color: theme.textSecondary }]}>
                            Shared wishlist coming soon
                        </Text>
                    </View>
                );
            case 'stats':
                return (
                    <View style={styles.tabContent}>
                        <Text style={[styles.comingSoon, { color: theme.textSecondary }]}>
                            Table stats coming soon
                        </Text>
                    </View>
                );
            case 'top4':
                return (
                    <View style={styles.tabContent}>
                        <Text style={[styles.comingSoon, { color: theme.textSecondary }]}>
                            Table&apos;s Top 4 restaurants coming soon
                        </Text>
                    </View>
                );
        }
    };

    // Empty state
    if (hasNoTables) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
                <View style={styles.emptyHeader}>
                    <Text style={[styles.headerTitle, { color: theme.text }]}>Tables</Text>
                </View>
                <EmptyTableState onCreateTable={() => setCreateModalVisible(true)} theme={theme} />
                <CreateTableModal
                    visible={createModalVisible}
                    onClose={() => setCreateModalVisible(false)}
                    onSubmit={handleCreateTable}
                    isSubmitting={createTableMutation.isPending}
                    theme={theme}
                />
            </SafeAreaView>
        );
    }

    // Loading state
    if (isLoading && !selectedTable) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
                <View style={styles.centerContent}>
                    <ActivityIndicator size="large" color={theme.primary} />
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            {/* Header with Table Switcher */}
            <View style={[styles.header, { borderBottomColor: theme.border }]}>
                <TableSwitcher
                    tables={tablesData}
                    selectedTable={selectedTable}
                    onSelectTable={setSelectedTable}
                    onCreateTable={() => setCreateModalVisible(true)}
                    theme={theme}
                />
                <TouchableOpacity
                    style={styles.settingsButton}
                    onPress={() => Alert.alert('Settings', 'Table settings coming soon')}
                >
                    <Ionicons name="settings-outline" size={22} color={theme.textSecondary} />
                </TouchableOpacity>
            </View>

            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContent}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        tintColor={theme.primary}
                    />
                }
            >
                {/* Table Header */}
                {selectedTable && (
                    <TableHeader table={selectedTable} members={members} theme={theme} />
                )}

                {/* Start Table Night CTA */}
                <TouchableOpacity
                    style={[styles.tableNightButton, { backgroundColor: theme.primary }]}
                    onPress={() => Alert.alert('Table Night', 'Coming in Phase 5!')}
                >
                    <Ionicons name="flash" size={20} color="white" />
                    <Text style={styles.tableNightButtonText}>Start Table Night</Text>
                </TouchableOpacity>

                {/* Tab Bar */}
                <View style={[styles.tabBar, { borderBottomColor: theme.border }]}>
                    {tabs.map((tab) => (
                        <TouchableOpacity
                            key={tab.key}
                            style={[
                                styles.tabItem,
                                activeTab === tab.key && {
                                    borderBottomColor: theme.primary,
                                    borderBottomWidth: 2,
                                },
                            ]}
                            onPress={() => setActiveTab(tab.key)}
                        >
                            <Ionicons
                                name={tab.icon as keyof typeof Ionicons.glyphMap}
                                size={18}
                                color={activeTab === tab.key ? theme.primary : theme.textSecondary}
                            />
                            <Text
                                style={[
                                    styles.tabLabel,
                                    {
                                        color:
                                            activeTab === tab.key ? theme.primary : theme.textSecondary,
                                    },
                                ]}
                            >
                                {tab.label}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>

                {/* Tab Content */}
                {renderTabContent()}
            </ScrollView>

            {/* Create Table Modal */}
            <CreateTableModal
                visible={createModalVisible}
                onClose={() => setCreateModalVisible(false)}
                onSubmit={handleCreateTable}
                isSubmitting={createTableMutation.isPending}
                theme={theme}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    centerContent: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyHeader: {
        paddingHorizontal: 20,
        paddingVertical: 16,
    },
    headerTitle: {
        fontSize: 28,
        fontWeight: 'bold',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    settingsButton: {
        padding: 8,
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        paddingBottom: 40,
    },
    tableNightButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginHorizontal: 20,
        marginBottom: 20,
        paddingVertical: 14,
        borderRadius: 30,
        gap: 8,
    },
    tableNightButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '600',
    },
    tabBar: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        marginHorizontal: 16,
    },
    tabItem: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        gap: 6,
    },
    tabLabel: {
        fontSize: 13,
        fontWeight: '500',
    },
    tabContent: {
        padding: 40,
        alignItems: 'center',
    },
    comingSoon: {
        fontSize: 14,
        fontStyle: 'italic',
    },
});
