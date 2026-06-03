/**
 * WishlistGrid — two-column Pinterest-style grid of WishlistCards.
 *
 * Modes:
 *   personal — infinite-scroll paginated feed via useMyWishlist
 *   table    — static ranked list via useTableWishlist (not paginated in v1)
 *
 * Implemented with FlatList numColumns={2} (FlashList not installed).
 * Variable card heights driven by photo aspect ratio; rows align horizontally.
 * estimatedItemSize fallback: intentional — see Technical Design risk notes.
 */
import React, { useCallback } from 'react';
import {
    View,
    Text,
    FlatList,
    RefreshControl,
    ActivityIndicator,
    StyleSheet,
} from 'react-native';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useMyWishlist, type PersonalWishlistItem } from '@/hooks/wishlist/useMyWishlist';
import { useTableWishlist, type TableWishlistItem } from '@/hooks/wishlist/useTableWishlist';
import { WishlistCard } from './WishlistCard';

// ── Empty States ──────────────────────────────────────────────────────────────

function PersonalEmptyState({ palette }: { palette: typeof Colors.light }) {
    return (
        <View style={styles.emptyContainer}>
            <Text style={[Type.headlineMedium, { color: palette.text, textAlign: 'center' }]}>
                Your wishlist is empty.
            </Text>
            <Text style={[Type.body, { color: palette.textSecondary, textAlign: 'center', marginTop: Spacing.sm }]}>
                Tap the heart on any restaurant to start saving.
            </Text>
        </View>
    );
}

function TableEmptyState({ palette }: { palette: typeof Colors.light }) {
    return (
        <View style={styles.emptyContainer}>
            <Text style={[Type.headlineMedium, { color: palette.text, textAlign: 'center' }]}>
                Nothing saved yet
            </Text>
            <Text style={[Type.body, { color: palette.textSecondary, textAlign: 'center', marginTop: Spacing.sm }]}>
                Start hearting restaurants and they&apos;ll show up here for your Table.
            </Text>
        </View>
    );
}

// ── Personal Grid ─────────────────────────────────────────────────────────────

interface PersonalGridProps {
    userId: string;
}

function PersonalGrid({ userId }: PersonalGridProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const {
        data,
        isLoading,
        isFetchingNextPage,
        hasNextPage,
        fetchNextPage,
        refetch,
        isRefetching,
    } = useMyWishlist(userId);

    const items: PersonalWishlistItem[] = data?.pages.flatMap(
        (p) => p.data,
    ) ?? [];

    const renderItem = useCallback(({ item }: { item: PersonalWishlistItem }) => (
        <View style={styles.itemWrapper}>
            {/* TICKET-060: skip pending rows (restaurant null until extraction resolves) */}
            {item.restaurant ? (
                <WishlistCard
                    mode="personal"
                    id={item.id}
                    note={item.note}
                    created_at={item.created_at}
                    restaurant={item.restaurant}
                    source={item.source}
                />
            ) : null}
        </View>
    ), []);

    const keyExtractor = useCallback((item: PersonalWishlistItem) => item.id, []);

    const onEndReached = useCallback(() => {
        if (hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
        }
    }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

    if (isLoading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator color={palette.primary} />
            </View>
        );
    }

    if (items.length === 0) {
        return <PersonalEmptyState palette={palette} />;
    }

    return (
        <FlatList
            data={items}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            numColumns={2}
            columnWrapperStyle={styles.row}
            contentContainerStyle={styles.listContent}
            refreshControl={
                <RefreshControl
                    refreshing={isRefetching}
                    onRefresh={refetch}
                    tintColor={palette.primary}
                />
            }
            onEndReached={onEndReached}
            onEndReachedThreshold={0.5}
            ListFooterComponent={
                isFetchingNextPage ? (
                    <ActivityIndicator color={palette.primary} style={{ marginVertical: Spacing.lg }} />
                ) : null
            }
            showsVerticalScrollIndicator={false}
        />
    );
}

// ── Table Grid ────────────────────────────────────────────────────────────────

interface TableGridProps {
    tableId: string;
}

function TableGrid({ tableId }: TableGridProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const { data, isLoading, refetch, isRefetching } = useTableWishlist(tableId);
    const items: TableWishlistItem[] = data ?? [];

    const renderItem = useCallback(({ item }: { item: TableWishlistItem }) => (
        <View style={styles.itemWrapper}>
            <WishlistCard
                mode="table"
                restaurant={item.restaurant}
                count={item.count}
                members={item.members}
            />
        </View>
    ), []);

    const keyExtractor = useCallback((item: TableWishlistItem) => item.restaurant.id, []);

    if (isLoading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator color={palette.primary} />
            </View>
        );
    }

    if (items.length === 0) {
        return <TableEmptyState palette={palette} />;
    }

    return (
        <FlatList
            data={items}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            numColumns={2}
            columnWrapperStyle={styles.row}
            contentContainerStyle={styles.listContent}
            refreshControl={
                <RefreshControl
                    refreshing={isRefetching}
                    onRefresh={refetch}
                    tintColor={palette.primary}
                />
            }
            showsVerticalScrollIndicator={false}
        />
    );
}

// ── Exported WishlistGrid ─────────────────────────────────────────────────────

interface WishlistGridPersonalProps {
    mode: 'personal';
}

interface WishlistGridTableProps {
    mode: 'table';
    tableId: string;
}

type WishlistGridProps = WishlistGridPersonalProps | WishlistGridTableProps;

export function WishlistGrid(props: WishlistGridProps) {
    const { user } = useAuth();

    if (props.mode === 'personal') {
        if (!user) return null;
        return <PersonalGrid userId={user.id} />;
    }

    return <TableGrid tableId={props.tableId} />;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    listContent: {
        paddingHorizontal: Spacing.md,
        paddingTop: Spacing.md,
        paddingBottom: 100,
    },
    row: {
        gap: Spacing.sm,
        marginBottom: Spacing.sm,
        alignItems: 'flex-start', // allows variable card heights
    },
    itemWrapper: {
        flex: 1,
    },
    emptyContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: Spacing.xl,
        paddingTop: Spacing.xxl * 2,
    },
    loadingContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: Spacing.xxl,
    },
});
