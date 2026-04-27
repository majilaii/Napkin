/**
 * /admin/critics — Operator critic review management surface.
 * TICKET-033
 *
 * FlatList of CriticAdminRow ordered by scraped_at desc.
 * Load more on scroll end via fetchNextPage (useCursorPagedQuery).
 * Enabled only after isAdmin resolves (P1-2 ARCH-REVIEW).
 *
 * No nav entry — operator types or bookmarks the route.
 */

import React from 'react';
import {
    FlatList,
    View,
    Text,
    ActivityIndicator,
    StyleSheet,
    Pressable,
    RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/theme';
import { useIsAdmin } from '@/hooks/admin/useIsAdmin';
import { useCriticsAdminList, flattenCriticsAdminList } from '@/hooks/admin/useCriticsAdminList';
import { CriticAdminRow } from '@/components/admin';
import type { CriticAdminRow as CriticAdminRowType } from '@/types/admin';

export default function CriticsAdminScreen() {
    const { isAdmin } = useIsAdmin();
    const c = Colors.light;
    const insets = useSafeAreaInsets();

    const {
        data,
        isLoading,
        isFetchingNextPage,
        hasNextPage,
        fetchNextPage,
        refetch,
        isRefetching,
    } = useCriticsAdminList({ enabled: isAdmin === true });

    const rows = flattenCriticsAdminList(data);

    function renderItem({ item }: { item: CriticAdminRowType }) {
        return <CriticAdminRow row={item} />;
    }

    function renderFooter() {
        if (isFetchingNextPage) {
            return (
                <View style={styles.footer}>
                    <ActivityIndicator color={c.primary} />
                </View>
            );
        }
        if (!hasNextPage && rows.length > 0) {
            return (
                <Text style={[styles.footerText, { color: c.textMuted }]}>
                    All {rows.length} rows loaded
                </Text>
            );
        }
        return null;
    }

    if (isLoading) {
        return (
            <View style={[styles.center, { backgroundColor: c.background }]}>
                <ActivityIndicator color={c.primary} />
            </View>
        );
    }

    if (rows.length === 0) {
        return (
            <View style={[styles.center, { backgroundColor: c.background }]}>
                <Text style={[styles.emptyText, { color: c.textMuted }]}>
                    No critic reviews ingested yet.
                </Text>
                <Pressable onPress={() => refetch()} style={styles.retryBtn}>
                    <Text style={[styles.retryText, { color: c.primary }]}>Refresh</Text>
                </Pressable>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: c.background }]}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
                <Text style={[styles.title, { color: c.text }]}>Critics admin</Text>
                <Text style={[styles.subtitle, { color: c.textMuted }]}>
                    {rows.length} rows · tap a row to suppress/unsuppress
                </Text>
            </View>

            <FlatList
                data={rows}
                keyExtractor={(item) => item.id}
                renderItem={renderItem}
                onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
                onEndReachedThreshold={0.3}
                ListFooterComponent={renderFooter}
                contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingTop: 8 }}
                refreshControl={
                    <RefreshControl
                        refreshing={isRefetching}
                        onRefresh={refetch}
                        tintColor={c.primary}
                    />
                }
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        paddingHorizontal: 20,
        paddingBottom: 12,
    },
    title: {
        fontSize: 22,
        fontWeight: '700',
    },
    subtitle: {
        fontSize: 13,
        marginTop: 2,
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 12,
    },
    emptyText: {
        fontSize: 15,
    },
    retryBtn: {
        paddingHorizontal: 20,
        paddingVertical: 10,
    },
    retryText: {
        fontSize: 15,
        fontWeight: '500',
    },
    footer: {
        paddingVertical: 20,
        alignItems: 'center',
    },
    footerText: {
        textAlign: 'center',
        fontSize: 13,
        paddingVertical: 16,
    },
});
