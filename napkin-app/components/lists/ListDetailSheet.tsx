import React, { useMemo } from 'react';
import { FlatList, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import DraggableFlatList, { type RenderItemParams } from 'react-native-draggable-flatlist';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { ListEntry } from '@/hooks/lists/useList';
import {
    FULL,
    HALF,
    SnapSheet,
    type Snap,
    type SnapSheetHandle,
} from '@/components/sheets';
import { ListDetailHeader, type ListDetailHeaderProps } from './ListDetailHeader';

export type ListDetailSheetHandle = SnapSheetHandle;

export interface ListDetailSheetProps {
    headerProps: ListDetailHeaderProps;
    description: string | null;
    entries: ListEntry[];
    renderRow: (entry: ListEntry, index: number, drag?: () => void) => React.ReactElement | null;
    editing: boolean;
    reorder: boolean;
    onDragEnd: (params: { data: ListEntry[]; from: number; to: number }) => void;
    onSnapSettle: (snap: Snap) => void;
    onPanStart?: () => void;
    emptyComponent: React.ReactElement | null;
    sheetRef: React.Ref<ListDetailSheetHandle>;
    H: number;
}

export function ListDetailSheet({
    headerProps,
    description,
    entries,
    renderRow,
    editing,
    reorder,
    onDragEnd,
    onSnapSettle,
    onPanStart,
    emptyComponent,
    sheetRef,
    H,
}: ListDetailSheetProps) {
    const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const listHeader = useMemo(
        () => description ? (
            <Text
                style={[
                    Type.editorialBody,
                    {
                        color: palette.textSecondary,
                        paddingHorizontal: Spacing.md,
                        paddingTop: 4,
                        paddingBottom: Spacing.sm,
                    },
                ]}
            >
                {description}
            </Text>
        ) : null,
        [description, palette.textSecondary],
    );
    const contentPad = { paddingBottom: insets.bottom + Spacing.xxl };

    return (
        <SnapSheet
            H={H}
            initialSnap={HALF}
            locked={editing}
            lockedSnap={FULL}
            unlockedSnap={HALF}
            sheetRef={sheetRef}
            onSettle={(snap) => onSnapSettle(snap)}
            onPanStart={onPanStart}
            backgroundColor={palette.background}
            handleColor={palette.ruleWarmNib}
            renderHeader={() => <ListDetailHeader {...headerProps} />}
            renderContent={({ onScroll, scrollEnabled }) => editing ? (
                reorder ? (
                    <DraggableFlatList
                        data={entries}
                        keyExtractor={(item) => item.id}
                        onDragEnd={onDragEnd}
                        ListHeaderComponent={listHeader}
                        ListEmptyComponent={emptyComponent}
                        renderItem={({ item, getIndex, drag }: RenderItemParams<ListEntry>) =>
                            renderRow(item, getIndex() ?? 0, drag)}
                        contentContainerStyle={contentPad}
                        showsVerticalScrollIndicator={false}
                    />
                ) : (
                    <FlatList
                        data={entries}
                        keyExtractor={(item) => item.id}
                        ListHeaderComponent={listHeader}
                        ListEmptyComponent={emptyComponent}
                        renderItem={({ item, index }) => renderRow(item, index)}
                        contentContainerStyle={contentPad}
                        showsVerticalScrollIndicator={false}
                    />
                )
            ) : (
                <Animated.FlatList
                    data={entries}
                    keyExtractor={(item: ListEntry) => item.id}
                    onScroll={onScroll}
                    scrollEventThrottle={16}
                    scrollEnabled={scrollEnabled}
                    bounces={false}
                    overScrollMode="never"
                    ListHeaderComponent={listHeader}
                    ListEmptyComponent={emptyComponent}
                    renderItem={({ item, index }: { item: ListEntry; index: number }) =>
                        renderRow(item, index)}
                    contentContainerStyle={contentPad}
                    showsVerticalScrollIndicator={false}
                />
            )}
        />
    );
}
