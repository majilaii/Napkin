import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Shadow, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { PressableScale } from '@/components/ui/napkin/PressableScale';
import type { MyList } from '@/hooks/lists/useMyLists';

interface Props {
    list: MyList;
    palette: typeof Colors.light;
    onPress: () => void;
}

function formatUpdated(iso: string): string {
    const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
    if (days === 0) return 'updated today';
    if (days === 1) return 'updated yesterday';
    if (days < 7) return `updated ${days}d ago`;
    return `updated ${Math.floor(days / 7)}w ago`;
}

export function WishlistListCardFull({ list, palette, onPress }: Props) {
    const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';

    return (
        <PressableScale
            onPress={onPress}
            haptic="light"
            style={[styles.card, Shadow.note, { backgroundColor: palette.surfaceNote }]}
            accessibilityRole="button"
            accessibilityLabel={`Open list ${list.title}`}
        >
            <View
                style={[
                    styles.cover,
                    { backgroundColor: palette.primaryMuted },
                    list.cover_photo_url && {
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: scheme === 'dark'
                            ? 'rgba(255, 255, 255, 0.1)'
                            : 'rgba(0, 0, 0, 0.1)',
                    },
                ]}
            >
                {list.cover_photo_url ? (
                    <Image
                        source={{ uri: list.cover_photo_url }}
                        style={StyleSheet.absoluteFillObject}
                        contentFit="cover"
                        transition={180}
                    />
                ) : list.emoji ? (
                    <Text style={styles.emoji}>{list.emoji}</Text>
                ) : (
                    <Ionicons name="map-outline" size={25} color={palette.primary} />
                )}
            </View>

            <View style={styles.copy}>
                <View style={styles.eyebrowRow}>
                    <Text style={[styles.eyebrow, { color: palette.primary }]}>
                        {list.table_name ? `Shared · ${list.table_name}` : list.privacy === 'private' ? 'Private list' : 'Your list'}
                    </Text>
                    <Ionicons name="chevron-forward" size={15} color={palette.textMuted} />
                </View>
                <Text style={[styles.title, { color: palette.text }]} numberOfLines={2}>
                    {list.title}
                </Text>
                {list.description ? (
                    <Text style={[styles.description, { color: palette.textSecondary }]} numberOfLines={2}>
                        {list.description}
                    </Text>
                ) : null}
                <Text style={[styles.meta, { color: palette.textMuted }]}>
                    {list.entry_count} {list.entry_count === 1 ? 'place' : 'places'} · {formatUpdated(list.updated_at)}
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
        gap: 8,
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
