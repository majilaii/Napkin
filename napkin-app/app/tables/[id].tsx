/**
 * Table Detail Page - For deep links to specific tables
 */
import React from 'react';
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
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTableDetail } from '@/hooks/tables/useTableDetail';
import { TableHeader } from '@/components/tables';

export default function TableDetailScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];

    const {
        data: tableDetail,
        isLoading,
        error,
        refetch,
    } = useTableDetail(id ?? null);

    const [refreshing, setRefreshing] = React.useState(false);

    const onRefresh = async () => {
        setRefreshing(true);
        await refetch();
        setRefreshing(false);
    };

    if (isLoading) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
                <View style={styles.centerContent}>
                    <ActivityIndicator size="large" color={theme.primary} />
                </View>
            </SafeAreaView>
        );
    }

    if (error || !tableDetail) {
        return (
            <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
                <View style={styles.centerContent}>
                    <Ionicons name="alert-circle-outline" size={48} color={theme.textSecondary} />
                    <Text style={[styles.errorText, { color: theme.text }]}>
                        {error?.message ?? 'Table not found'}
                    </Text>
                </View>
            </SafeAreaView>
        );
    }

    const table = {
        id: tableDetail.id,
        name: tableDetail.name,
        avatar_url: tableDetail.avatar_url,
        owner_id: tableDetail.owner_id,
        created_at: tableDetail.created_at,
        updated_at: tableDetail.updated_at,
    };

    const members = (tableDetail.members ?? []).map(m => ({
        member_id: m.user_id,
        role: m.role,
        joined_at: m.joined_at,
        profiles: {
            display_name: m.profiles.display_name,
            avatar_url: m.profiles.avatar_url ?? undefined,
        },
    }));

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
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
                <TableHeader table={table} members={members} theme={theme} />

                {/* Start Table Night CTA */}
                <TouchableOpacity
                    style={[styles.tableNightButton, { backgroundColor: theme.primary }]}
                    onPress={() => Alert.alert('Table Night', 'Coming in Phase 5!')}
                >
                    <Ionicons name="flash" size={20} color="white" />
                    <Text style={styles.tableNightButtonText}>Start Table Night</Text>
                </TouchableOpacity>

                {/* Placeholder Content */}
                <View style={styles.placeholderContent}>
                    <Text style={[styles.comingSoon, { color: theme.textSecondary }]}>
                        Table activity feed coming soon
                    </Text>
                </View>
            </ScrollView>
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
        gap: 12,
    },
    errorText: {
        fontSize: 16,
        marginTop: 8,
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
    placeholderContent: {
        padding: 40,
        alignItems: 'center',
    },
    comingSoon: {
        fontSize: 14,
        fontStyle: 'italic',
    },
});
