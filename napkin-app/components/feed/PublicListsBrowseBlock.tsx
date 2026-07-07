/**
 * PublicListsBrowseBlock — the For You feed's public-lists block (TICKET-125 +
 * TICKET-130 "Gazette mix" re-dress: vertical rows → horizontal POSTER RAIL).
 *
 *   lists worth reading
 *   ┌ tinted poster ┐ ┌ tinted poster ┐
 *   │ 🍜            │ │ 📓            │
 *   │ best late-    │ │ everywhere    │  → horizontal scroll
 *   │ night ramen   │ │ in Lisbon     │
 *   │ 12 spots · by │ │ 8 spots · by  │
 *   └───────────────┘ └───────────────┘
 *   see more →                            ← hands off to search's Lists segment
 *
 * Pictureless per locked doctrine (TICKET-084 / decision 4): NO thumbnails, no
 * photo covers — the poster is emoji + type on a tinted paper plate (tint
 * seeded per list id from the same three tokens as GlyphChip). The first card
 * is the lead purely by recency order (no editorial treatment — decision 5).
 *
 * Cards tap out to /list/[id] (viewer mode). "see more" routes to the search
 * tab with the Lists segment active (hierarchical: For You → the search Lists
 * hub). Self-hides when there are no rows.
 */
import React, { useCallback } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { PublicListResult } from '@/hooks/lists/useSearchPublicLists';
import { SectionKicker } from './SectionKicker';
import { chipTint } from './GlyphChip';

type Palette = typeof Colors.light;

interface Props {
    lists: PublicListResult[];
}

function ListPosterCard({
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
            style={({ pressed }) => [
                styles.poster,
                { backgroundColor: chipTint(list.id, palette) },
                pressed && { opacity: 0.8 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={list.title}
        >
            {list.emoji ? <Text style={styles.emoji}>{list.emoji}</Text> : null}
            <Text style={[styles.title, { color: palette.text }]} numberOfLines={2}>
                {list.title}
            </Text>
            <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>
                {meta}
            </Text>
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
        <View>
            <SectionKicker>lists worth reading</SectionKicker>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.railContent}
            >
                {lists.map((list) => (
                    <ListPosterCard
                        key={list.id}
                        list={list}
                        palette={palette}
                        onPress={handlePress}
                    />
                ))}
            </ScrollView>
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
    railContent: {
        paddingHorizontal: Spacing.lg,
        gap: 10,
    },
    poster: {
        minWidth: 150,
        maxWidth: 172,
        borderRadius: 16,
        padding: 13,
    },
    emoji: {
        fontSize: 24,
        marginBottom: 10,
    },
    title: {
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 15,
        lineHeight: 19,
    },
    meta: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 10,
        marginTop: 4,
    },
    seeMore: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        marginTop: 12,
        paddingHorizontal: Spacing.lg,
        alignSelf: 'flex-start',
    },
    seeMoreText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
    },
});
