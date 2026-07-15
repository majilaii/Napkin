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
 * along and the credit renders over the image) — else null → emoji/tint
 * plate. NO member/entry-photo lookup happens here, ever: a user/table hero
 * as a derived cover on the public feed is banned (the server returns null
 * for those; this component must never re-derive one).
 */
import React, { useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { parsePlacesAttribution } from '@/lib/parsePlacesAttribution';
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

/** Places credit label when the cover is an attributed Places hero. */
function coverCredit(list: PublicListResult): string | null {
    if (!list.cover_photo_url || list.photo_source !== 'places') return null;
    return parsePlacesAttribution(list.attribution_html)?.label ?? null;
}

function imageOutline(scheme: 'light' | 'dark') {
    return scheme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
}

function ListFeature({
    list,
    palette,
    scheme,
    onPress,
}: {
    list: PublicListResult;
    palette: Palette;
    scheme: 'light' | 'dark';
    onPress: (list: PublicListResult) => void;
}) {
    const hasCover = !!list.cover_photo_url;
    const credit = coverCredit(list);

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
                        source={{ uri: list.cover_photo_url! }}
                        style={StyleSheet.absoluteFillObject}
                        contentFit="cover"
                        transition={180}
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
                    {!!credit && (
                        <Text
                            style={[styles.coverCredit, { color: palette.textOnImage }]}
                            numberOfLines={1}
                        >
                            {credit}
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
}: {
    list: PublicListResult;
    palette: Palette;
    scheme: 'light' | 'dark';
    onPress: (list: PublicListResult) => void;
}) {
    const hasCover = !!list.cover_photo_url;
    const credit = coverCredit(list);

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
                        source={{ uri: list.cover_photo_url! }}
                        style={StyleSheet.absoluteFillObject}
                        contentFit="cover"
                        transition={180}
                    />
                ) : list.emoji ? (
                    <Text style={styles.emoji}>{list.emoji}</Text>
                ) : null}
                {hasCover && !!credit && (
                    <>
                        <LinearGradient
                            colors={['rgba(28, 28, 25, 0)', 'rgba(28, 28, 25, 0.55)']}
                            locations={[0.55, 1]}
                            style={StyleSheet.absoluteFillObject}
                        />
                        <Text
                            style={[styles.railCredit, { color: palette.textOnImage }]}
                            numberOfLines={1}
                        >
                            {credit}
                        </Text>
                    </>
                )}
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

    if (!showcase && rail.length === 0) return null;

    return (
        <View>
            <SectionKicker>new lists</SectionKicker>
            {showcase && (
                <ListFeature list={showcase} palette={palette} scheme={scheme} onPress={handlePress} />
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
                        />
                    ))}
                </ScrollView>
            )}
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
        height: 282,
        marginHorizontal: Spacing.lg,
        borderRadius: Radius.xxl,
    },
    featureClip: {
        flex: 1,
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
    coverCredit: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        lineHeight: 14,
        marginTop: 7,
        opacity: 0.85,
    },
    railCredit: {
        position: 'absolute',
        bottom: 4,
        left: 8,
        right: 8,
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        lineHeight: 14,
        opacity: 0.9,
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
