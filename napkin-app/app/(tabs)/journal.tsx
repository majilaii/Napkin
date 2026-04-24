/**
 * Journal tab — viewer's own feed-only solo entries, rendered as memory cards.
 *
 * Scope (TICKET-032): the memory-object JournalNoteCard lives here; other
 * surfaces (Tables tab, feed tab) keep their existing card treatments.
 */
import React from 'react';
import { View, Text, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useMySoloEntries } from '@/hooks/entries';
import { JournalNoteCard } from '@/components/feed/JournalNoteCard';

export default function JournalScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const { user } = useAuth();

    const { data: entries, isLoading, isRefetching, refetch } = useMySoloEntries(user?.id);

    const header = (
        <View style={{ paddingTop: insets.top + Spacing.xxl, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md }}>
            <Text style={[Type.displaySmall, { color: palette.text }]}>Journal</Text>
            <Text style={[Type.body, { color: palette.textSecondary, marginTop: Spacing.sm }]}>
                your private meal log.
            </Text>
        </View>
    );

    if (isLoading) {
        return (
            <View style={{ flex: 1, backgroundColor: palette.background }}>
                {header}
                <ActivityIndicator style={{ marginTop: Spacing.xl }} color={palette.primary} />
            </View>
        );
    }

    return (
        <View style={{ flex: 1, backgroundColor: palette.background }}>
            <FlatList
                data={entries ?? []}
                keyExtractor={item => item.id}
                ListHeaderComponent={header}
                renderItem={({ item }) => (
                    <JournalNoteCard item={item} palette={palette} />
                )}
                ListEmptyComponent={
                    <View style={{ paddingHorizontal: Spacing.lg, paddingTop: Spacing.xl }}>
                        <Text style={[Type.body, { color: palette.textSecondary }]}>
                            nothing logged yet. tap + to write your first entry.
                        </Text>
                    </View>
                }
                refreshControl={
                    <RefreshControl
                        refreshing={isRefetching}
                        onRefresh={refetch}
                        tintColor={palette.primary}
                    />
                }
                contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
            />
        </View>
    );
}
