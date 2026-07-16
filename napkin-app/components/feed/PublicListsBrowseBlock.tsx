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
 * restaurant's mirrored Places hero (in which case `attribution_html` rides
 * along and one quiet credit line renders below the image) — else null → emoji/tint
 * plate. NO member/entry-photo lookup happens here, ever: a user/table hero
 * as a derived cover on the public feed is banned (the server returns null
 * for those; this component must never re-derive one). The client repeats the
 * gate so a malformed or stale attribution can never leave an uncredited image.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    PlacesCredit,
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

function imageOutline(scheme: 'light' | 'dark') {
    return scheme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
}

function ListFeature({
    list,
    palette,
    scheme,
    onPress,
    cover,
    onCoverError,
}: {
    list: PublicListResult;
    palette: Palette;
    scheme: 'light' | 'dark';
    onPress: (list: PublicListResult) => void;
    cover: ResolvedSourcedPhoto;
    onCoverError: () => void;
}) {
    const hasCover = !!cover.url;

    return (
        <PressableScale
            onPress={() => onPress(list)}
            style={styles.featurePressable}
            haptic="light"
            accessibilityRole="button"
            accessibilityLabel={`Open ${list.title}`}
        >
            <View
                style={[
                    styles.featureClip,
                    { backgroundColor: chipTint(list.id, palette) },
                    hasCover && { borderWidth: StyleSheet.hairlineWidth, borderColor: imageOutline(scheme) },
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
                    <Text style={[styles.featureMeta, { color: hasCover ? palette.textOnImage : palette.textMuted }]}>
                        {spotLabel(list)} · {authorName(list)}
                    </Text>
                    <Text
                        style={[styles.featureTitle, { color: hasCover ? palette.textOnImage : palette.text }]}
                        numberOfLines={2}
                    >
                        {list.title}
                    </Text>
                    {!!list.description && (
                        <Text
                            style={[styles.featureDescription, { color: hasCover ? palette.textOnImage : palette.textSecondary }]}
                            numberOfLines={2}
                        >
                            — {list.description}
                        </Text>
                    )}
                </View>
            </View>
        </PressableScale>
    );
}

function ListRailCard({
    list,
    palette,
    scheme,
    onPress,
    cover,
    onCoverError,
}: {
    list: PublicListResult;
    palette: Palette;
    scheme: 'light' | 'dark';
    onPress: (list: PublicListResult) => void;
    cover: ResolvedSourcedPhoto;
    onCoverError: () => void;
}) {
    const hasCover = !!cover.url;

    return (
        <PressableScale
            onPress={() => onPress(list)}
            style={[styles.railCard, { backgroundColor: palette.card }, Shadow.note]}
            haptic="light"
            accessibilityRole="button"
            accessibilityLabel={`Open ${list.title}`}
        >
            <View
                style={[
                    styles.railImage,
                    { backgroundColor: chipTint(list.id, palette) },
                    hasCover && { borderWidth: StyleSheet.hairlineWidth, borderColor: imageOutline(scheme) },
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
                <Text style={[styles.railTitle, { color: palette.text }]} numberOfLines={2}>
                    {list.title}
                </Text>
                <Text style={[styles.railMeta, { color: palette.textMuted }]} numberOfLines={1}>
                    {spotLabel(list)} · {authorName(list)}
                </Text>
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
    const renderedPlacesCovers = presentedLists
        .map((list) => coversById.get(list.id)!)
        .filter((cover) => !!cover.url && !!cover.credit);

    if (!showcase && rail.length === 0) return null;

    return (
        <View>
            <SectionKicker>new lists</SectionKicker>
            {showcase && (
                <ListFeature
                    list={showcase}
                    palette={palette}
                    scheme={scheme}
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
                            scheme={scheme}
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
            <PlacesCredit
                credits={renderedPlacesCovers.map((cover) => cover.credit)}
                photoCount={renderedPlacesCovers.length}
                testID="public-lists-places-credit"
                interactive={false}
                style={styles.aggregateCredit}
            />
            <PressableScale
                onPress={() => router.push({ pathname: '/(tabs)/search', params: { mode: 'lists' } })}
                style={styles.browseAll}
                accessibilityRole="button"
                accessibilityLabel="Browse all public lists"
            >
                <Text style={[styles.browseAllText, { color: palette.primary }]}>browse all lists</Text>
                <Ionicons name="arrow-forward" size={16} color={palette.primary} />
            </PressableScale>
        </View>
    );
}

const styles = StyleSheet.create({
    featurePressable: {
        marginHorizontal: Spacing.lg,
        borderRadius: Radius.xxl,
    },
    featureClip: {
        height: 282,
        overflow: 'hidden',
        borderRadius: Radius.xxl,
        padding: Spacing.md,
    },
    featureCopy: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    featureMeta: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10,
        lineHeight: 14,
        marginBottom: 6,
    },
    featureTitle: {
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 29,
        lineHeight: 32,
    },
    featureDescription: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
        lineHeight: 19,
        marginTop: 7,
    },
    aggregateCredit: {
        marginHorizontal: Spacing.lg,
        marginTop: 6,
    },
    railContent: {
        paddingHorizontal: Spacing.lg,
        gap: 12,
    },
    railAfterFeature: {
        paddingTop: 12,
    },
    railCard: {
        width: 186,
        minHeight: 224,
        borderRadius: Radius.xl,
        padding: 6,
    },
    railImage: {
        height: 122,
        overflow: 'hidden',
        borderRadius: Radius.lg,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emoji: {
        fontSize: 30,
    },
    railCopy: {
        paddingHorizontal: 6,
        paddingTop: 9,
        paddingBottom: 4,
    },
    railTitle: {
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 17,
        lineHeight: 21,
    },
    railMeta: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 9.5,
        lineHeight: 14,
        marginTop: 5,
    },
    browseAll: {
        alignSelf: 'flex-start',
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        marginLeft: Spacing.lg,
        marginTop: 5,
        paddingRight: Spacing.sm,
    },
    browseAllText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
    },
});
