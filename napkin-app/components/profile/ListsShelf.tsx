/**
 * ListsShelf — the profile's Lists presence (TICKET-185).
 *
 * A horizontal rail of cover-plate cards — the profile's "Lists" section,
 * owning its single SectionHeader ("Lists" + self-only "see all"). TICKET-191
 * rev 2 un-merged the short-lived Collections wrapper: imports moved up to the
 * header affordance + attention card, so the shelf is a plain section again.
 * Self reads useMyLists (all lists incl. private + Table); a stranger reads
 * the profile payload's public lists. Cards route to the list; the shelf hides
 * entirely for a stranger with no public lists, and shows a single ghost
 * "new list" card when you have none.
 *
 * Doctrine (founder-directed 2026-07-14): list cards carry imagery. A derived
 * cover only renders when its source metadata proves it is a user/Table photo,
 * or an attributed Places mirror; stale/unattributed payloads fail closed to
 * the deterministic emoji/teardrop plate. Titles are UPRIGHT Newsreader — the
 * profile typography guard reserves italic serif for ratings/quotes only.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useMyLists } from '@/hooks/lists/useMyLists';
import { tintFor } from '@/lib/engraving';
import { parsePlacesAttribution } from '@/lib/parsePlacesAttribution';
import { PressableScale } from '@/components/ui/napkin/PressableScale';
import type { ProfileListSummary } from '@/hooks/users/useUserProfile';
import { SectionHeader } from './SectionHeader';
import { myListsToShelf, publicListsToShelf, type ShelfList } from './listsShelfUtils';

type Palette = typeof Colors.light;

const CARD_W = 144;
const PLATE_H = Math.round((CARD_W * 5) / 4); // 4:5 cover plate
const MAX_SHELF_CARDS = 12;

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
    // Bind failures to the URI that emitted them. A stale failure from the old
    // first restaurant must not suppress a newly derived cover on this card.
    const [failedCover, setFailedCover] = useState<string | null>(null);
    useEffect(() => setFailedCover(null), [item.coverPhotoUrl]);

    const showCoverImage = !!item.coverPhotoUrl && failedCover !== item.coverPhotoUrl;
    const placesAttribution = showCoverImage && item.coverPhotoSource === 'places'
        ? parsePlacesAttribution(item.coverAttributionHtml)
        : null;

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
                {showCoverImage ? (
                    <Image
                        key={item.coverPhotoUrl}
                        source={{ uri: item.coverPhotoUrl! }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        recyclingKey={item.coverPhotoUrl!}
                        transition={180}
                        onError={() => setFailedCover(item.coverPhotoUrl!)}
                    />
                ) : null}
                {placesAttribution ? (
                    <View
                        pointerEvents="none"
                        style={[styles.creditScrim, { backgroundColor: palette.scrimDark }]}
                    >
                        <Text
                            testID="list-cover-attribution"
                            style={[styles.coverCredit, { color: palette.textOnImage }]}
                            numberOfLines={1}
                        >
                            {placesAttribution.label}
                        </Text>
                    </View>
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
        // Eager horizontal rail — cap mounts; the full set lives behind "see all".
        const items = myListsToShelf(myLists).slice(0, MAX_SHELF_CARDS);
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

    const items = publicListsToShelf(publicLists).slice(0, MAX_SHELF_CARDS);
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
    creditScrim: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: Spacing.sm,
        paddingVertical: Spacing.xs,
    },
    coverCredit: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        lineHeight: 14,
        opacity: 0.9,
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
