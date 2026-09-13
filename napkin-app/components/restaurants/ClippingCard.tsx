/**
 * A source note, complete without an image: platform, creator, saved attribution,
 * and an explicit link to the original. Only the server's durable clip-thumbs
 * projection may decorate it. A missing image never looks like missing content.
 * Local video files remain informational; there is no durable playback URL.
 */
import React, { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { Colors, IconSize, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { isInstagramSource } from '@/components/wishlist/importSourceLabel';

export interface ClippingCardData {
    saver: { user_id: string; display_name: string; avatar_url: string | null };
    relationship: 'self' | 'tablemate' | 'following' | 'stranger' | string;
    source: { type: string | null; url: string | null; author_handle: string | null };
    thumb_url: string | null;
    also_count: number;
    created_at: string;
}

type Glyph = React.ComponentProps<typeof Ionicons>['name'];

function hostGlyph(source: ClippingCardData['source']): Glyph {
    if (source.type === 'tiktok') return 'logo-tiktok';
    if (source.type === 'web' && isInstagramSource(source as any)) return 'logo-instagram';
    if (source.type === 'video') return 'videocam-outline';
    return 'link-outline';
}

function platformLabel(source: ClippingCardData['source']): string {
    if (source.type === 'tiktok') return 'TikTok';
    if (isInstagramSource(source)) return 'Instagram';
    if (source.type === 'video') return 'Imported video';
    return 'Original source';
}

/** Only public web links can be opened. A video-file source never has a link. */
function clipUrl(source: ClippingCardData['source']): string | null {
    if (source.type === 'video' || !source.url?.trim()) return null;
    try {
        const parsed = new URL(source.url.trim());
        return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
    } catch {
        return null;
    }
}

/**
 * Lowercase relative month for the attribution row. Grammar, relative to `now`:
 *   - same month        → `this september`
 *   - previous month    → `last august`   (crosses the year boundary: jan → `last december`)
 *   - earlier this year → `june`
 *   - any other year    → `march 2025`
 * `now` is injectable so tests stay hermetic (never calendar-dependent).
 */
export function clipDateLabel(dateStr: string, now: Date = new Date()): string {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '';
    const month = d.toLocaleDateString('en-US', { month: 'long' }).toLowerCase();
    const monthsAgo = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
    if (monthsAgo === 0) return `this ${month}`;
    if (monthsAgo === 1) return `last ${month}`;
    if (d.getFullYear() === now.getFullYear()) return month;
    return `${month} ${d.getFullYear()}`;
}

interface Props {
    clip: ClippingCardData;
}

export function ClippingCard({ clip }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const [failedThumbUrl, setFailedThumbUrl] = useState<string | null>(null);

    const { saver, relationship, source, thumb_url, also_count } = clip;

    const isVideoType = source.type === 'video';
    // Record the failed URL, so a later replacement gets a fresh image attempt.
    const showPhoto = !!thumb_url && !isVideoType && failedThumbUrl !== thumb_url;

    const isSelf = relationship === 'self';
    const firstName = (saver.display_name ?? 'someone').trim().split(/\s+/)[0] || 'someone';
    const who = isSelf ? 'you' : firstName;

    // @handle row: only when a creator handle exists AND this isn't a video-type.
    const handle = !isVideoType ? source.author_handle?.trim().replace(/^@+/, '') || null : null;

    const dateLabel = clipDateLabel(clip.created_at);
    const glyph = hostGlyph(source);
    const platform = platformLabel(source);
    const title = handle ? `@${handle}` : platform;

    const url = clipUrl(source);
    const tappable = !!url;

    // One composed a11y label: creator + attribution + action.
    const alsoText = also_count > 0 ? `, and ${also_count} ${also_count === 1 ? 'other' : 'others'}` : '';
    const a11yParts = [
        platform,
        handle ? `@${handle}` : null,
        `clipped by ${who}${alsoText}${dateLabel ? `, ${dateLabel}` : ''}`,
        tappable ? 'opens the original' : isVideoType ? 'no original link' : 'link unavailable',
    ].filter(Boolean) as string[];
    const accessibilityLabel = a11yParts.join('. ');

    const handlePress = async () => {
        if (!url) return;
        try {
            await Linking.openURL(url);
        } catch (err) {
            console.error('[ClippingCard] Linking.openURL failed', err);
            Alert.alert("Couldn't open this clip", 'Try opening it again in a moment.');
        }
    };

    const body = (
        <>
            <View style={[styles.artwork, { backgroundColor: palette.surfaceJournalHi }]}>
                {showPhoto ? (
                    <ExpoImage
                        source={{ uri: thumb_url as string }}
                        testID="clipping-thumbnail"
                        style={StyleSheet.absoluteFillObject}
                        contentFit="cover"
                        recyclingKey={thumb_url}
                        transition={120}
                        onError={() => setFailedThumbUrl(thumb_url)}
                    />
                ) : (
                    <Ionicons name={glyph} size={IconSize.lg} color={palette.textSecondary} />
                )}
            </View>

            <View style={styles.caption}>
                {handle ? (
                    <Text style={[Type.sectionKicker, { color: palette.textMuted }]}>{platform}</Text>
                ) : null}
                <Text style={[Type.editorialBody, { color: palette.text }]} numberOfLines={1}>
                    {title}
                </Text>
                <Text style={[Type.metadata, { color: palette.textMuted }]} numberOfLines={2}>
                    clipped by {who}
                    {also_count > 0 ? ` +${also_count}` : ''}
                    {dateLabel ? ` · ${dateLabel}` : ''}
                </Text>
                <Text style={[Type.restaurantDetailAction, { color: tappable ? palette.primary : palette.textMuted }]}>
                    {tappable ? 'Open original' : isVideoType ? 'No original link' : 'Link unavailable'}
                </Text>
            </View>
            {tappable ? <Ionicons name="open-outline" size={IconSize.sm} color={palette.primary} /> : null}
        </>
    );

    if (!tappable) {
        return (
            <View
                style={[styles.card, { backgroundColor: palette.surfaceJournalLow }]}
                accessible
                accessibilityRole="text"
                accessibilityLabel={accessibilityLabel}
            >
                {body}
            </View>
        );
    }

    return (
        <Pressable
            onPress={handlePress}
            accessibilityRole="link"
            accessibilityLabel={accessibilityLabel}
            style={({ pressed }) => [
                styles.card,
                { backgroundColor: palette.surfaceJournalLow, opacity: pressed ? 0.8 : 1 },
            ]}
        >
            {body}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.restaurant.listChipHorizontal,
        padding: Spacing.restaurant.cardHorizontal,
        borderRadius: Radius.lg,
        overflow: 'hidden',
    },
    artwork: {
        width: Spacing.restaurant.clippingArtworkSize,
        height: Spacing.restaurant.clippingArtworkSize,
        borderRadius: Radius.compact,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    caption: {
        flex: 1,
        gap: Spacing.xs,
    },
});
