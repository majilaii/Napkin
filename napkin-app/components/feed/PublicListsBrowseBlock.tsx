/**
 * PublicListsBrowseBlock — the For You feed's public-lists block (TICKET-125).
 *
 *   Lists worth reading
 *   🍜  best late-night ramen        ← lead (RPC recency order)
 *       12 spots · by Clara
 *   📓  everywhere in Lisbon
 *       8 spots · by Thomas
 *   see more →                        ← hands off to search's Lists segment
 *
 * Typographic per locked doctrine (TICKET-084 / decision 4): NO thumbnails, no
 * photo covers. Row presentation is cloned from ListsSearchPane.ResultRow —
 * emoji · italic-serif title · "N spots · by {author}". The first row is the
 * lead purely by recency order (no editorial/featured treatment — decision 5).
 *
 * Rows tap out to /list/[id] (viewer mode). "see more" routes to the search tab
 * with the Lists segment active (hierarchical: For You → the search Lists hub).
 * Self-hides when there are no rows.
 */
import React, { useCallback } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { PublicListResult } from '@/hooks/lists/useSearchPublicLists';

type Palette = typeof Colors.light;

interface Props {
    lists: PublicListResult[];
}

function ListBrowseRow({
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
            accessibilityRole="button"
            accessibilityLabel={list.title}
        >
            {list.emoji ? <Text style={styles.emoji}>{list.emoji}</Text> : null}
            <View style={styles.rowText}>
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

export function PublicListsBrowseBlock({ lists }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;
    const router = useRouter();

    const handlePress = useCallback(
        (list: PublicListResult) => {
            router.push({ pathname: '/list/[id]', params: { id: list.id } });
        },
        [router],
    );

    const handleSeeMore = useCallback(() => {
        router.push({ pathname: '/(tabs)/search', params: { mode: 'lists' } });
    }, [router]);

    // Self-guard: an empty block never paints a dangling heading.
    if (lists.length === 0) return null;

    return (
        <View style={styles.wrap}>
            <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>
                Lists worth reading
            </Text>
            <View style={styles.rows}>
                {lists.map((list) => (
                    <ListBrowseRow
                        key={list.id}
                        list={list}
                        palette={palette}
                        onPress={handlePress}
                    />
                ))}
            </View>
            <Pressable
                onPress={handleSeeMore}
                style={({ pressed }) => [styles.seeMore, pressed && { opacity: 0.7 }]}
                accessibilityRole="button"
                accessibilityLabel="See more public lists"
            >
                <Text style={[styles.seeMoreText, { color: palette.primary }]}>see more</Text>
                <Ionicons name="chevron-forward" size={13} color={palette.primary} />
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        paddingHorizontal: Spacing.lg,
    },
    sectionLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
        marginBottom: Spacing.md,
    },
    rows: {
        gap: 18,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    emoji: {
        fontSize: 20,
    },
    rowText: {
        flex: 1,
        minWidth: 0,
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
    seeMore: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        marginTop: 16,
    },
    seeMoreText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
    },
});
