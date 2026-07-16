import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { PressableScale } from '@/components/ui/napkin/PressableScale';
import { resolveSourcedPhoto } from '@/components/ui/PlacesCredit';
import type { SavedList } from '@/hooks/lists/useSavedLists';

interface Props {
    list: SavedList;
    palette: typeof Colors.light;
    scheme: 'light' | 'dark';
    onPress: () => void;
    failedCoverKeys?: ReadonlySet<string>;
    onCoverError?: (failureKey: string) => void;
}

function relativeSavedAt(iso: string): string {
    const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
    if (days === 0) return 'saved today';
    if (days === 1) return 'saved yesterday';
    if (days < 7) return `saved ${days}d ago`;
    return `saved ${Math.floor(days / 7)}w ago`;
}

export function SavedListCardFull({
    list,
    palette,
    scheme,
    onPress,
    failedCoverKeys = new Set(),
    onCoverError,
}: Props) {
    const owner = list.owner_display_name ?? list.owner_username ?? 'someone';
    const cover = resolveSourcedPhoto({
        url: list.cover_photo_url,
        photoSource: list.cover_photo_source,
        attributionHtml: list.cover_attribution_html,
        restaurantName: list.cover_restaurant_name,
    });
    const coverFailureKey = cover.url ? `${list.id}:${cover.url}` : null;
    const coverUrl = coverFailureKey && failedCoverKeys.has(coverFailureKey)
        ? null
        : cover.url;

    return (
        <PressableScale
            onPress={onPress}
            haptic="light"
            style={[styles.card, Shadow.note, { backgroundColor: palette.surfaceNote }]}
            accessibilityRole="button"
            accessibilityLabel={`Open saved list ${list.title}`}
        >
            <View
                style={[
                    styles.cover,
                    { backgroundColor: palette.secondaryContainer },
                    coverUrl && {
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: scheme === 'dark'
                            ? 'rgba(255, 255, 255, 0.1)'
                            : 'rgba(0, 0, 0, 0.1)',
                    },
                ]}
            >
                {coverUrl ? (
                    <Image
                        source={{ uri: coverUrl }}
                        style={StyleSheet.absoluteFillObject}
                        contentFit="cover"
                        transition={180}
                        onError={() => coverFailureKey && onCoverError?.(coverFailureKey)}
                    />
                ) : list.emoji ? (
                    <Text style={styles.emoji}>{list.emoji}</Text>
                ) : (
                    <Ionicons name="map-outline" size={25} color={palette.primary} />
                )}
            </View>

            <View style={styles.copy}>
                <View style={styles.eyebrowRow}>
                    <Text style={[styles.eyebrow, { color: palette.primary }]} numberOfLines={1}>
                        by {owner}
                    </Text>
                    <Ionicons name="bookmark" size={14} color={palette.primary} />
                </View>
                <Text style={[styles.title, { color: palette.text }]} numberOfLines={2}>{list.title}</Text>
                {list.description ? (
                    <Text style={[styles.description, { color: palette.textSecondary }]} numberOfLines={2}>
                        {list.description}
                    </Text>
                ) : null}
                <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>
                    {list.entry_count} {list.entry_count === 1 ? 'place' : 'places'} · {list.save_count} saves · {relativeSavedAt(list.saved_at)}
                </Text>
            </View>
        </PressableScale>
    );
}

const styles = StyleSheet.create({
    card: {
        minHeight: 128,
        borderRadius: Radius.xl,
        padding: 12,
        flexDirection: 'row',
        gap: 14,
        marginBottom: 14,
    },
    cover: {
        width: 92,
        minHeight: 104,
        borderRadius: Radius.md,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    emoji: { fontSize: 28 },
    copy: {
        flex: 1,
        minWidth: 0,
        paddingVertical: 2,
    },
    eyebrowRow: {
        minHeight: 20,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: Spacing.sm,
    },
    eyebrow: {
        flex: 1,
        ...Type.labelSmall,
    },
    title: {
        fontFamily: 'Newsreader_700Bold',
        fontSize: 21,
        lineHeight: 24,
        letterSpacing: -0.25,
        marginTop: 2,
    },
    description: {
        ...Type.caption,
        marginTop: 4,
    },
    meta: {
        ...Type.metadata,
        fontVariant: ['tabular-nums'],
        marginTop: 'auto',
        paddingTop: 7,
    },
});
