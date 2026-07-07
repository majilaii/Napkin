/**
 * ListsSearchPane — TICKET-106.
 *
 * The Lists tab in Search. Queries all publicly available lists (triple-gated
 * server-side) and renders typographic result rows — NO thumbnails (lists
 * doctrine): emoji · italic-serif title · "{n} spots · by {name}" Manrope meta.
 * Min 2 chars → a single quiet line. Tap → /list/[id] (viewer mode).
 */
import React, { useCallback } from 'react';
import {
    View,
    Text,
    FlatList,
    Pressable,
    StyleSheet,
    ActivityIndicator,
    Keyboard,
} from 'react-native';
import { useRouter } from 'expo-router';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    useSearchPublicLists,
    flattenPublicLists,
    type PublicListResult,
} from '@/hooks/lists/useSearchPublicLists';

type Palette = typeof Colors.light;

interface Props {
    /** Immediate (responsive) query — drives the min-2-char gate copy. */
    query: string;
    /** Debounced query — drives the actual search. */
    debouncedQuery: string;
}

function ResultRow({
    list,
    palette,
    onPress,
}: {
    list: PublicListResult;
    palette: Palette;
    onPress: (list: PublicListResult) => void;
}) {
    const author = list.owner_display_name ?? list.owner_username ?? 'someone';
    const meta = `${list.entry_count} ${list.entry_count === 1 ? 'spot' : 'spots'} · by ${author}`;
    return (
        <Pressable
            onPress={() => onPress(list)}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
        >
            {list.emoji ? (
                <Text style={styles.emoji}>{list.emoji}</Text>
            ) : null}
            <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
                    {list.title}
                </Text>
                <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>
                    {meta}
                </Text>
            </View>
        </Pressable>
    );
}

export function ListsSearchPane({ query, debouncedQuery }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;
    const router = useRouter();

    const {
        data,
        isLoading,
        isFetching,
        hasNextPage,
        fetchNextPage,
        isFetchingNextPage,
    } = useSearchPublicLists(debouncedQuery);

    const results = flattenPublicLists(data);

    const handlePress = useCallback(
        (list: PublicListResult) => {
            router.push({ pathname: '/list/[id]', params: { id: list.id } });
        },
        [router],
    );

    // Min-2-char gate — a single quiet line (copy economy).
    if (query.trim().length < 2) {
        return (
            <Pressable style={styles.centered} onPress={Keyboard.dismiss} accessible={false}>
                <Text style={[Type.body, { color: palette.textMuted }]}>
                    Search public lists
                </Text>
            </Pressable>
        );
    }

    if (isLoading && results.length === 0) {
        return (
            <Pressable style={styles.centered} onPress={Keyboard.dismiss} accessible={false}>
                <ActivityIndicator color={palette.primary} />
            </Pressable>
        );
    }

    return (
        <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            renderItem={({ item }) => (
                <ResultRow list={item} palette={palette} onPress={handlePress} />
            )}
            onEndReachedThreshold={0.4}
            onEndReached={() => {
                if (hasNextPage && !isFetchingNextPage) fetchNextPage();
            }}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
                !isFetching ? (
                    <View style={styles.centered}>
                        <Text style={[Type.body, { color: palette.textMuted }]}>
                            {`No public lists for "${debouncedQuery.trim()}"`}
                        </Text>
                    </View>
                ) : null
            }
            ListFooterComponent={
                isFetchingNextPage ? (
                    <ActivityIndicator
                        color={palette.primary}
                        style={{ marginVertical: Spacing.md }}
                    />
                ) : null
            }
        />
    );
}

const styles = StyleSheet.create({
    listContent: {
        flexGrow: 1,
        paddingTop: Spacing.xs,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.md,
    },
    emoji: {
        fontSize: 20,
    },
    title: {
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 18,
        lineHeight: 22,
    },
    meta: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 12,
        marginTop: 2,
    },
    centered: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: Spacing.xxl,
    },
});
