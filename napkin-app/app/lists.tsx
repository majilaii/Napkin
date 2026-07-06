/**
 * Lists screen — the owner's full list of curated lists.
 * Reached from Settings tab ("My Lists" row).
 *
 * Shows all the user's lists (public + private), reverse-chron by updated_at.
 * Empty state has a "Create list" CTA.
 * Header has a "+" button for creating a new list.
 */
import React, { useState } from 'react';
import {
    View,
    Text,
    FlatList,
    Pressable,
    StyleSheet,
    ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useMyLists, type MyList } from '@/hooks/lists/useMyLists';
import { useDeleteList } from '@/hooks/lists/useDeleteList';
import { ListCard, EmptyListsState, CreateListSheet } from '@/components/lists';
import { OwnerActionsSheet } from '@/components/common';
import { useToast } from '@/providers/ToastProvider';

export default function ListsScreen() {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const { data: lists = [], isLoading } = useMyLists(user?.id);
    const [showCreate, setShowCreate] = useState(false);
    // TICKET-111: long-press a list → owner sheet (Edit · Delete).
    const [actionList, setActionList] = useState<MyList | null>(null);
    const deleteList = useDeleteList(user?.id);
    const toast = useToast();

    const handleDeleteList = () => {
        const list = actionList;
        setActionList(null);
        if (!list) return;
        deleteList.mutate(list.id, {
            onSuccess: () => toast.show(`Deleted ${list.title}`),
            onError: () => toast.show('Could not delete that — try again'),
        });
    };

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <View style={[styles.container, { backgroundColor: palette.background }]}>
                {/* Top bar */}
                <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
                    <Pressable onPress={() => router.back()} hitSlop={12}>
                        <Text style={[Type.body, { color: palette.primary }]}>← Back</Text>
                    </Pressable>
                    <Text style={[Type.displaySmall, { color: palette.text }]}>My Lists</Text>
                    <Pressable onPress={() => setShowCreate(true)} hitSlop={12}>
                        <Ionicons name="add" size={28} color={palette.primary} />
                    </Pressable>
                </View>

                {isLoading ? (
                    <View style={styles.loading}>
                        <ActivityIndicator color={palette.primary} />
                    </View>
                ) : lists.length === 0 ? (
                    <EmptyListsState onCreatePress={() => setShowCreate(true)} />
                ) : (
                    <FlatList
                        data={lists}
                        keyExtractor={(item) => item.id}
                        contentContainerStyle={styles.listContent}
                        ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
                        renderItem={({ item }) => (
                            <ListCard
                                list={item}
                                onPress={() => router.push({ pathname: '/list/[id]', params: { id: item.id } })}
                                onLongPress={() => setActionList(item)}
                            />
                        )}
                    />
                )}

                {/* Create list sheet — full-screen flow for zero-state create */}
                <CreateListSheet
                    visible={showCreate}
                    onClose={() => setShowCreate(false)}
                    onCreated={(listId) => {
                        setShowCreate(false);
                        router.push({ pathname: '/list/[id]', params: { id: listId } });
                    }}
                    userId={user?.id}
                />

                {/* TICKET-111: long-press owner sheet — Edit · Delete. */}
                <OwnerActionsSheet
                    visible={actionList !== null}
                    title={actionList?.title ?? 'this list'}
                    actions={[
                        {
                            label: 'Edit list',
                            onPress: () => {
                                const id = actionList?.id;
                                setActionList(null);
                                if (id) router.push({ pathname: '/list/[id]/edit', params: { id } });
                            },
                        },
                        { label: 'Delete list', kind: 'destructive', onPress: handleDeleteList },
                    ]}
                    onCancel={() => setActionList(null)}
                />
            </View>
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    topBar: {
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    loading: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    listContent: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.sm,
        paddingBottom: Spacing.xxl,
    },
});
