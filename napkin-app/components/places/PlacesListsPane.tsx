import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { ErrorState, InlineErrorState } from '@/components/ErrorState';
import { ListRow } from '@/components/search/ListRow';
import { TierHeader } from '@/components/search/TierHeader';
import type { SnapSheetContentContext } from '@/components/sheets/SnapSheet';
import { Colors, IconSize, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { MyList } from '@/hooks/lists/useMyLists';
import type { SavedList } from '@/hooks/lists/useSavedLists';
import type { PlacesListsBranch } from './placesPresentation';

type PaneItem =
    | { type: 'header'; key: string; label: 'Your lists' | 'Saved lists'; empty?: boolean }
    | { type: 'mine'; key: string; list: MyList }
    | { type: 'new'; key: string }
    | { type: 'saved'; key: string; list: SavedList };

interface Props {
    branch: PlacesListsBranch;
    myLists: readonly MyList[];
    savedLists: readonly SavedList[];
    myError: boolean;
    savedError: boolean;
    scrollEnabled: boolean;
    onScroll: SnapSheetContentContext['onScroll'];
    onOpenList: (id: string) => void;
    onNewList: () => void;
    onRetryMyLists: () => void;
    onRetrySavedLists: () => void;
    bottomPadding: number;
}

export function PlacesListsPane({
    branch,
    myLists,
    savedLists,
    myError,
    savedError,
    scrollEnabled,
    onScroll,
    onOpenList,
    onNewList,
    onRetryMyLists,
    onRetrySavedLists,
    bottomPadding,
}: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const items = useMemo<PaneItem[]>(() => {
        if (branch === 'loading' || branch === 'error') return [];
        return [
            { type: 'header', key: 'your-header', label: 'Your lists', empty: branch === 'empty' },
            ...myLists.map((list) => ({ type: 'mine' as const, key: `mine:${list.id}`, list })),
            { type: 'new', key: 'new-list' },
            ...(savedLists.length > 0
                ? [
                    { type: 'header' as const, key: 'saved-header', label: 'Saved lists' as const },
                    ...savedLists.map((list) => ({
                        type: 'saved' as const,
                        key: `saved:${list.id}`,
                        list,
                    })),
                ]
                : []),
        ];
    }, [branch, myLists, savedLists]);

    return (
        <Animated.FlatList
            testID="places-lists-pane"
            data={items}
            keyExtractor={(item) => item.key}
            scrollEnabled={scrollEnabled}
            onScroll={onScroll}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
            renderItem={({ item }) => {
                if (item.type === 'header') {
                    return (
                        <View>
                            <TierHeader label={item.label} />
                            {item.empty ? (
                                <Text style={[styles.empty, { color: palette.textMuted }]}>no lists yet</Text>
                            ) : null}
                        </View>
                    );
                }
                if (item.type === 'new') {
                    return (
                        <Pressable
                            onPress={onNewList}
                            style={({ pressed }) => [styles.newRow, pressed && { opacity: 0.64 }]}
                            accessibilityRole="button"
                            accessibilityLabel="new list"
                        >
                            <Ionicons name="add" size={IconSize.sm} color={palette.primary} />
                            <Text style={[styles.newLabel, { color: palette.primary }]}>new list</Text>
                        </Pressable>
                    );
                }
                if (item.type === 'mine') {
                    return <ListRow list={item.list} onPress={() => onOpenList(item.list.id)} />;
                }
                const owner = item.list.owner_display_name ?? `@${item.list.owner_username ?? ''}`;
                const count = `${item.list.entry_count} ${item.list.entry_count === 1 ? 'spot' : 'spots'}`;
                return (
                    <ListRow
                        list={item.list}
                        meta={`${count} · by ${owner}`}
                        onPress={() => onOpenList(item.list.id)}
                    />
                );
            }}
            ListHeaderComponent={branch === 'rows' && myError
                ? <InlineErrorState onRetry={onRetryMyLists} />
                : null}
            ListEmptyComponent={branch === 'loading'
                ? <ActivityIndicator style={styles.loader} color={palette.primary} />
                : branch === 'error'
                  ? <ErrorState onRetry={onRetryMyLists} />
                  : null}
            ListFooterComponent={branch === 'rows' && savedError
                ? <InlineErrorState onRetry={onRetrySavedLists} />
                : null}
        />
    );
}

const styles = StyleSheet.create({
    content: {
        flexGrow: 1,
        paddingHorizontal: Spacing.sm,
    },
    empty: {
        ...Type.metadata,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
    },
    newRow: {
        minHeight: Spacing.xxl,
        paddingHorizontal: Spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    newLabel: {
        ...Type.body,
        fontFamily: 'Manrope_600SemiBold',
    },
    loader: {
        marginTop: Spacing.xl,
    },
});
