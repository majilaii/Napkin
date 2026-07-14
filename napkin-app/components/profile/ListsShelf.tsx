/**
 * ListsShelf — the profile's Lists presence (TICKET-185).
 *
 * A horizontal rail of cover-plate cards, sitting between the Dining map and the
 * Explore index (it replaces the old text TOC row). Self reads useMyLists (all
 * lists incl. private + Table); a stranger reads the profile payload's public
 * lists. Cards route to the list; the shelf hides entirely for a stranger with
 * no public lists, and shows a single ghost "new list" card when you have none.
 *
 * Doctrine (founder-directed 2026-07-14): list cards carry imagery. cover_photo_url
 * is always ToS-safe (own-bucket Places mirror or a user entry photo); most
 * imported lists have NULL covers, so the deterministic emoji/teardrop plate must
 * read first-class, never degraded. Titles are UPRIGHT Newsreader — the profile
 * typography guard reserves italic serif for ratings/quotes only.
 */
import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useMyLists } from '@/hooks/lists/useMyLists';
import { tintFor } from '@/lib/engraving';
import { PressableScale } from '@/components/ui/napkin/PressableScale';
import type { ProfileListSummary } from '@/hooks/users/useUserProfile';
import { SectionHeader } from './SectionHeader';
import { myListsToShelf, publicListsToShelf, type ShelfList } from './listsShelfUtils';

type Palette = typeof Colors.light;

const CARD_W = 144;
const PLATE_H = Math.round((CARD_W * 5) / 4); // 4:5 cover plate

interface Props {
    isSelf: boolean;
    /** The profile owner's id — drives useMyLists for the self shelf. */
    userId: string;
    /** Stranger data: the profile payload's public lists (empty for self). */
    publicLists: ProfileListSummary[];
}

function ShelfCard({
    item,
    palette,
    onPress,
}: {
    item: ShelfList;
    palette: Palette;
    onPress: () => void;
}) {
    return (
        <PressableScale
            onPress={onPress}
            haptic="selection"
            style={styles.card}
            accessibilityRole="button"
            accessibilityLabel={`Open list ${item.title}, ${item.meta}`}
        >
            <View style={[styles.plate, { backgroundColor: tintFor(item.id, palette) }]}>
                {item.emoji ? (
                    <Text style={styles.emoji}>{item.emoji}</Text>
                ) : (
                    <Ionicons name="location-outline" size={30} color={palette.primary} />
                )}
                {item.coverPhotoUrl ? (
                    <Image
                        source={{ uri: item.coverPhotoUrl }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        transition={180}
                    />
                ) : null}
                <View
                    pointerEvents="none"
                    style={[StyleSheet.absoluteFill, styles.plateOutline, { borderColor: palette.imageOutline }]}
                />
            </View>
            <Text style={[styles.title, { color: palette.text }]} numberOfLines={2}>
                {item.title}
            </Text>
            <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>
                {item.meta}
            </Text>
        </PressableScale>
    );
}

function GhostCard({ palette, onPress }: { palette: Palette; onPress: () => void }) {
    return (
        <PressableScale
            onPress={onPress}
            haptic="selection"
            style={styles.card}
            accessibilityRole="button"
            accessibilityLabel="New list"
        >
            <View style={[styles.plate, styles.ghostPlate, { borderColor: palette.outlineVariant }]}>
                <Ionicons name="add" size={26} color={palette.primary} />
            </View>
            <Text style={[styles.title, { color: palette.primary }]} numberOfLines={1}>
                new list
            </Text>
        </PressableScale>
    );
}

export function ListsShelf({ isSelf, userId, publicLists }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;
    const router = useRouter();
    const { data: myLists } = useMyLists(isSelf ? userId : null);

    const openList = (id: string) =>
        router.push({ pathname: '/list/[id]', params: { id } });

    if (isSelf) {
        // Hold render until own lists resolve — avoids flashing the ghost card.
        if (myLists === undefined) return null;
        const items = myListsToShelf(myLists);
        const hasLists = items.length > 0;
        return (
            <View>
                <SectionHeader
                    title="Lists"
                    rightLabel={hasLists ? 'see all' : undefined}
                    onRightLabelPress={hasLists ? () => router.push('/lists') : undefined}
                />
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.rail}
                >
                    {hasLists ? (
                        items.map((item) => (
                            <ShelfCard
                                key={item.id}
                                item={item}
                                palette={palette}
                                onPress={() => openList(item.id)}
                            />
                        ))
                    ) : (
                        <GhostCard palette={palette} onPress={() => router.push('/list/new')} />
                    )}
                </ScrollView>
            </View>
        );
    }

    const items = publicListsToShelf(publicLists);
    if (items.length === 0) return null;
    return (
        <View>
            <SectionHeader title="Lists" />
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.rail}
            >
                {items.map((item) => (
                    <ShelfCard
                        key={item.id}
                        item={item}
                        palette={palette}
                        onPress={() => openList(item.id)}
                    />
                ))}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    rail: {
        flexDirection: 'row',
        gap: 12,
        paddingHorizontal: 22,
        paddingRight: 30,
        paddingBottom: 4,
    },
    card: {
        width: CARD_W,
        gap: 8,
    },
    plate: {
        width: CARD_W,
        height: PLATE_H,
        borderRadius: Radius.lg,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    plateOutline: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: Radius.lg,
    },
    ghostPlate: {
        borderWidth: 1.5,
        borderStyle: 'dashed',
    },
    emoji: {
        fontSize: 34,
    },
    title: {
        fontFamily: 'Newsreader_600SemiBold',
        fontSize: 16,
        lineHeight: 20,
    },
    meta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        lineHeight: 16,
    },
});
