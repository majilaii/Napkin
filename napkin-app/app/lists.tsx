/**
 * Lists screen — the owner's lists index (reached from the profile Lists shelf's
 * "see all", and from the post-edit redirect).
 *
 * Two segments: My (own lists, public + private + Table, reverse-chron) and Saved
 * (public lists you've bookmarked, showing owner + save count). On-system chrome
 * — circular chevron-back + sans screen title — matching /import-progress.
 */
import React, { useState } from 'react';
import {
    View,
    Text,
    FlatList,
    StyleSheet,
    ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useMyLists, type MyList } from '@/hooks/lists/useMyLists';
import { useSavedLists, type SavedList } from '@/hooks/lists/useSavedLists';
import { useDeleteList } from '@/hooks/lists/useDeleteList';
import { ListCard, EmptyListsState, CreateListSheet } from '@/components/lists';
import { OwnerActionsSheet } from '@/components/common';
import { PressableScale } from '@/components/ui/napkin/PressableScale';
import { useToast } from '@/providers/ToastProvider';

type Segment = 'my' | 'saved';

function savedMetaLine(list: SavedList): string {
    const owner = list.owner_display_name ?? list.owner_username ?? 'someone';
    const saves = `${list.save_count} ${list.save_count === 1 ? 'save' : 'saves'}`;
    return `by ${owner} · ${saves}`;
}

export default function ListsScreen() {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const [segment, setSegment] = useState<Segment>('my');
    const { data: myLists = [], isLoading: myLoading } = useMyLists(user?.id);
    const { data: savedLists = [], isLoading: savedLoading } = useSavedLists(user?.id);
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

    const isMy = segment === 'my';
    const isLoading = isMy ? myLoading : savedLoading;

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <View style={[styles.container, { backgroundColor: palette.background }]}>
                {/* On-system chrome — circular back + sans title + create */}
                <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
                    <PressableScale
                        onPress={() => router.back()}
                        haptic="selection"
                        style={[styles.iconButton, { backgroundColor: palette.surfaceContainerLow }]}
                        accessibilityRole="button"
                        accessibilityLabel="Back"
                    >
                        <Ionicons name="chevron-back" size={21} color={palette.text} style={styles.backIcon} />
                    </PressableScale>
                    <Text style={[Type.screenTitle, { color: palette.text }]}>lists</Text>
                    <PressableScale
                        onPress={() => setShowCreate(true)}
                        haptic="selection"
                        style={[styles.iconButton, { backgroundColor: palette.surfaceContainerLow }]}
                        accessibilityRole="button"
                        accessibilityLabel="New list"
                    >
                        <Ionicons name="add" size={22} color={palette.primary} />
                    </PressableScale>
                </View>

                {/* My | Saved segments */}
                <View style={styles.segmentWrap}>
                    <View style={[styles.segment, { backgroundColor: palette.surfaceContainerLow }]}>
                        {(['my', 'saved'] as const).map((seg) => {
                            const active = segment === seg;
                            return (
                                <PressableScale
                                    key={seg}
                                    onPress={() => setSegment(seg)}
                                    haptic="selection"
                                    style={[
                                        styles.segmentButton,
                                        active ? { ...Shadow.subtle, backgroundColor: palette.card } : {},
                                    ]}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: active }}
                                    accessibilityLabel={seg === 'my' ? 'My lists' : 'Saved lists'}
                                >
                                    <Text
                                        style={[
                                            styles.segmentLabel,
                                            { color: active ? palette.text : palette.textMuted },
                                        ]}
                                    >
                                        {seg === 'my' ? 'My' : 'Saved'}
                                    </Text>
                                </PressableScale>
                            );
                        })}
                    </View>
                </View>

                {isLoading ? (
                    <View style={styles.loading}>
                        <ActivityIndicator color={palette.primary} />
                    </View>
                ) : isMy ? (
                    myLists.length === 0 ? (
                        <EmptyListsState onCreatePress={() => setShowCreate(true)} />
                    ) : (
                        <FlatList
                            data={myLists}
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
                    )
                ) : savedLists.length === 0 ? (
                    <View style={styles.savedEmpty}>
                        <Text style={[Type.bodySmall, { color: palette.textMuted, textAlign: 'center' }]}>
                            No saved lists yet
                        </Text>
                    </View>
                ) : (
                    <FlatList
                        data={savedLists}
                        keyExtractor={(item) => item.id}
                        contentContainerStyle={styles.listContent}
                        ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
                        renderItem={({ item }) => (
                            <ListCard
                                list={item}
                                metaOverride={savedMetaLine(item)}
                                onPress={() => router.push({ pathname: '/list/[id]', params: { id: item.id } })}
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
    header: {
        paddingHorizontal: 18,
        paddingBottom: Spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    iconButton: {
        width: 44,
        height: 44,
        borderRadius: Radius.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
    backIcon: { marginLeft: -2 },
    segmentWrap: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.sm,
        paddingBottom: Spacing.sm,
    },
    segment: {
        flexDirection: 'row',
        borderRadius: Radius.lg,
        padding: 4,
        gap: 4,
    },
    segmentButton: {
        flex: 1,
        minHeight: 40,
        borderRadius: Radius.md,
        alignItems: 'center',
        justifyContent: 'center',
    },
    segmentLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 14,
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
    savedEmpty: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: Spacing.xl,
    },
});
