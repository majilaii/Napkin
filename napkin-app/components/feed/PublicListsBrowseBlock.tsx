/**
 * PublicListsBrowseBlock — the authored-collection lead in For You.
 *
 * A public list is not automatically an editorial feature. The first list only
 * earns a large treatment when it has a real cover photo and at least three
 * places; otherwise every list stays in the smaller rail. That protects the
 * screen from presenting a newly generated or thin list as something Napkin
 * itself has endorsed.
 *
 * Covers (TICKET-189, public-safe chain only): `cover_photo_url` arrives from
 * the server ALREADY gated — the author's own cover, or the list's first
 * restaurant's mirrored Places hero (`attribution_html` rides along for the
 * source-aware image gate) — else null → emoji/tint plate. NO member/entry-photo
 * lookup happens here, ever: a user/table hero
 * as a derived cover on the public feed is banned (the server returns null
 * for those; this component must never re-derive one). The client repeats the
 * gate so a malformed or stale attribution can never leave an uncredited image.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';

import { Colors, Shadow } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    resolveSourcedPhoto,
    type ResolvedSourcedPhoto,
} from '@/components/ui/PlacesCredit';
import type { PublicListResult } from '@/hooks/lists/useSearchPublicLists';
import { PressableScale } from '@/components/ui/napkin/PressableScale';
import { SectionKicker } from './SectionKicker';
import { chipTint } from './GlyphChip';
import { arrangePublicLists } from './listPresentation';

type Palette = typeof Colors.light;

function authorName(list: PublicListResult) {
    return list.owner_display_name ?? list.owner_username ?? 'someone';
}

function spotLabel(list: PublicListResult) {
    return `${list.entry_count} ${list.entry_count === 1 ? 'spot' : 'spots'}`;
}

function resolveCover(list: PublicListResult) {
    return resolveSourcedPhoto({
        url: list.cover_photo_url,
        // Public-feed covers are Places-only by contract. Do not widen this to
        // user/Table restaurant heroes even though the shared resolver can
        // display those sources on private/owned surfaces.
        photoSource: list.photo_source === 'places' ? 'places' : null,
        attributionHtml: list.attribution_html,
        restaurantName: list.cover_restaurant_name,
    });
}

function ListFeature({
    list,
    palette,
    onPress,
    cover,
    onCoverError,
}: {
    list: PublicListResult;
    palette: Palette;
    onPress: (list: PublicListResult) => void;
    cover: ResolvedSourcedPhoto;
    onCoverError: () => void;
}) {
    const hasCover = !!cover.url;

    return (
        <PressableScale
            onPress={() => onPress(list)}
            style={[
                styles.featurePressable,
                { backgroundColor: chipTint(list.id, palette) },
                Shadow.ambient,
            ]}
            haptic="light"
            accessibilityRole="button"
            accessibilityLabel={`Open ${list.title}`}
            testID="public-list-feature"
        >
            <View
                style={[
                    styles.featureClip,
                    { backgroundColor: chipTint(list.id, palette) },
                    hasCover && {
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: palette.imageOutline,
                    },
                ]}
            >
                {hasCover && (
                    <Image
                        source={{ uri: cover.url! }}
                        style={StyleSheet.absoluteFillObject}
                        contentFit="cover"
                        transition={180}
                        onError={onCoverError}
                    />
                )}
                {hasCover && (
                    <LinearGradient
                        colors={['rgba(28, 28, 25, 0.02)', 'rgba(28, 28, 25, 0.78)']}
                        locations={[0.22, 1]}
                        style={StyleSheet.absoluteFillObject}
                    />
                )}
                <View style={styles.featureCopy}>
                    <Text
                        style={[styles.featureTitle, { color: hasCover ? palette.textOnImage : palette.text }]}
                        numberOfLines={2}
                        testID="public-list-title"
                    >
                        {list.title}
                    </Text>
                    <Text
                        style={[
                            styles.featureMeta,
                            { color: hasCover ? palette.textOnImage : palette.textMuted },
                        ]}
                        numberOfLines={1}
                    >
                        {spotLabel(list)} · by {authorName(list)}
                    </Text>
                </View>
            </View>
        </PressableScale>
    );
}

function ListRailCard({
    list,
    palette,
    onPress,
    cover,
    onCoverError,
}: {
    list: PublicListResult;
    palette: Palette;
    onPress: (list: PublicListResult) => void;
    cover: ResolvedSourcedPhoto;
    onCoverError: () => void;
}) {
    const hasCover = !!cover.url;

    return (
        <PressableScale
            onPress={() => onPress(list)}
            style={[styles.railCard, { backgroundColor: palette.card }, Shadow.ambient]}
            haptic="light"
            accessibilityRole="button"
            accessibilityLabel={`Open ${list.title}`}
            testID="public-list-rail-card"
        >
            <View style={[styles.railCardSurface, { backgroundColor: palette.card }]}>
                <View
                    style={[
                        styles.railImage,
                        { backgroundColor: chipTint(list.id, palette) },
                        hasCover && {
                            borderWidth: StyleSheet.hairlineWidth,
                            borderColor: palette.imageOutline,
                        },
                    ]}
                >
                    {hasCover ? (
                        <Image
                            source={{ uri: cover.url! }}
                            style={StyleSheet.absoluteFillObject}
                            contentFit="cover"
                            transition={180}
                            onError={onCoverError}
                        />
                    ) : list.emoji ? (
                        <Text style={styles.emoji}>{list.emoji}</Text>
                    ) : null}
                </View>
                <View style={styles.railCopy}>
                    <Text
                        style={[styles.railTitle, { color: palette.text }]}
                        numberOfLines={2}
                        testID="public-list-title"
                    >
                        {list.title}
                    </Text>
                    <Text style={[styles.railMeta, { color: palette.textMuted }]} numberOfLines={1}>
                        {spotLabel(list)} · by {authorName(list)}
                    </Text>
                </View>
            </View>
        </PressableScale>
    );
}

export function PublicListsBrowseBlock({ lists }: { lists: PublicListResult[] }) {
    const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
    const palette = Colors[scheme] as Palette;
    const router = useRouter();

    const handlePress = useCallback(
        (list: PublicListResult) => {
            router.push({ pathname: '/list/[id]', params: { id: list.id } });
        },
        [router],
    );

    const { showcase, rail } = useMemo(() => arrangePublicLists(lists), [lists]);
    const presentedLists = useMemo(
        () => showcase ? [showcase, ...rail] : rail,
        [rail, showcase],
    );
    const coverSignature = presentedLists
        .map((list) => `${list.id}:${list.cover_photo_url ?? ''}:${list.attribution_html ?? ''}`)
        .join('|');
    const [failedCoverKeys, setFailedCoverKeys] = useState<Set<string>>(() => new Set());
    useEffect(() => setFailedCoverKeys(new Set()), [coverSignature]);
    const coversById = new Map(presentedLists.map((list) => {
        const cover = resolveCover(list);
        const key = `${list.id}:${cover.url ?? ''}`;
        return [list.id, failedCoverKeys.has(key)
            ? { ...cover, url: null, credit: null }
            : cover] as const;
    }));
    if (!showcase && rail.length === 0) return null;

    return (
        <View>
            <SectionKicker>new lists</SectionKicker>
            {showcase && (
                <ListFeature
                    list={showcase}
                    palette={palette}
                    onPress={handlePress}
                    cover={coversById.get(showcase.id)!}
                    onCoverError={() => {
                        const url = coversById.get(showcase.id)?.url;
                        if (url) setFailedCoverKeys((current) => new Set(current).add(`${showcase.id}:${url}`));
                    }}
                />
            )}
            {rail.length > 0 && (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={[styles.railContent, showcase ? styles.railAfterFeature : null]}
                >
                    {rail.map((list) => (
                        <ListRailCard
                            key={list.id}
                            list={list}
                            palette={palette}
                            onPress={handlePress}
                            cover={coversById.get(list.id)!}
                            onCoverError={() => {
                                const url = coversById.get(list.id)?.url;
                                if (url) setFailedCoverKeys((current) => new Set(current).add(`${list.id}:${url}`));
                            }}
                        />
                    ))}
                </ScrollView>
            )}
            <PressableScale
                onPress={() => router.push({ pathname: '/(tabs)/places', params: { mode: 'lists' } })}
                style={styles.browseAll}
                accessibilityRole="button"
                accessibilityLabel="Search public lists"
            >
                <Text style={[styles.browseAllText, { color: palette.primary }]}>search lists</Text>
            </PressableScale>
        </View>
    );
}

const styles = StyleSheet.create({
    featurePressable: {
        height: 200,
        marginHorizontal: 20,
        borderRadius: 18,
    },
    featureClip: {
        height: 200,
        overflow: 'hidden',
        borderRadius: 18,
        paddingHorizontal: 18,
        paddingVertical: 16,
    },
    featureCopy: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    featureMeta: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 13,
        lineHeight: 18,
        marginTop: 3,
    },
    featureTitle: {
        fontFamily: 'Newsreader_500Medium',
        fontSize: 21,
        fontWeight: '500',
        lineHeight: 25,
    },
    railContent: {
        paddingHorizontal: 20,
        gap: 12,
    },
    railAfterFeature: {
        paddingTop: 12,
    },
    railCard: {
        width: 172,
        height: 165,
        borderRadius: 16,
    },
    railCardSurface: {
        width: 172,
        height: 165,
        borderRadius: 16,
        overflow: 'hidden',
    },
    railImage: {
        height: 84,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    emoji: {
        fontSize: 30,
    },
    railCopy: {
        paddingHorizontal: 12,
        paddingTop: 10,
        paddingBottom: 12,
    },
    railTitle: {
        fontFamily: 'Newsreader_500Medium',
        fontSize: 15,
        fontWeight: '500',
        lineHeight: 19,
        height: 38,
    },
    railMeta: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 13,
        lineHeight: 18,
        marginTop: 3,
    },
    browseAll: {
        alignSelf: 'stretch',
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 4,
    },
    browseAllText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
        fontWeight: '700',
        lineHeight: 18,
        letterSpacing: 0.26,
    },
});
