/**
 * ClippingCard — one compact press-clipping on the restaurant page's ON SOCIALS
 * rail (TICKET-156). A saver's TikTok/Reel, attributed and tapping out to the
 * original video.
 *
 * Heirloom: ~104pt portrait card, cream matte (surfaceJournalLow), ambient shadow
 * only, Radius.md. A 3:4 thumbnail (durable Storage copy ONLY — never the rotting
 * provider CDN link) with a typographic fallback at the IDENTICAL footprint, so a
 * late thumbnail never reflows the rail.
 *
 * Rules (AC):
 *   - `video`-type is ALWAYS typographic + non-tappable (no creator, no URL) — no
 *     @handle row, glyph + attribution only.
 *   - Missing/failed/rotted thumbnail → typographic fallback at the same size.
 *   - Tap (url-bearing, non-video) → Linking.openURL in try/catch; a dead/private
 *     video shows a non-crashing alert. No pre-flight liveness check (scraping).
 *   - One composed accessibilityLabel; role 'link' when tappable, 'text' otherwise.
 */
import React, { useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Shadow } from '@/constants/theme';
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

const CARD_WIDTH = 104;
const THUMB_HEIGHT = Math.round((CARD_WIDTH * 4) / 3); // 3:4 portrait

function hostGlyph(source: ClippingCardData['source']): Glyph {
    if (source.type === 'tiktok') return 'logo-tiktok';
    if (source.type === 'web' && isInstagramSource(source as any)) return 'logo-instagram';
    if (source.type === 'video') return 'videocam-outline';
    return 'link-outline';
}

/** Lowercase "last {month}" — reuses this page's relationshipLine date grammar. */
function lastMonth(dateStr: string): string {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '';
    return `last ${d.toLocaleDateString('en-US', { month: 'long' }).toLowerCase()}`;
}

interface Props {
    clip: ClippingCardData;
}

export function ClippingCard({ clip }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const [imgFailed, setImgFailed] = useState(false);

    const { saver, relationship, source, thumb_url, also_count } = clip;

    const isVideoType = source.type === 'video';
    // video-type is ALWAYS typographic; a failed/absent thumb falls back too.
    const showPhoto = !!thumb_url && !isVideoType && !imgFailed;

    const isSelf = relationship === 'self';
    const firstName = (saver.display_name ?? 'someone').trim().split(/\s+/)[0] || 'someone';
    const who = isSelf ? 'you' : firstName;

    // @handle row: only when a creator handle exists AND this isn't a video-type.
    const handle = !isVideoType && source.author_handle ? source.author_handle : null;

    const dateLabel = lastMonth(clip.created_at);
    const glyph = hostGlyph(source);

    const url = source.url;
    const tappable = !!url && !isVideoType;

    // One composed a11y label: creator + attribution + action.
    const alsoText = also_count > 0 ? `, and ${also_count} ${also_count === 1 ? 'other' : 'others'}` : '';
    const a11yParts = [
        handle ? `@${handle}` : null,
        `clipped by ${who}${alsoText}${dateLabel ? `, ${dateLabel}` : ''}`,
        tappable ? 'opens the video' : null,
    ].filter(Boolean) as string[];
    const accessibilityLabel = a11yParts.join('. ');

    const handlePress = async () => {
        if (!url) return;
        try {
            await Linking.openURL(url);
        } catch (err) {
            console.error('[ClippingCard] Linking.openURL failed', err);
            Alert.alert("Couldn't open this clip", 'The video may have been removed. Try again later.');
        }
    };

    const body = (
        <>
            {/* Media area — durable thumb, or cream + host glyph at identical size */}
            <View style={[styles.media, { backgroundColor: palette.surfaceJournalLow }]}>
                {showPhoto ? (
                    <ExpoImage
                        source={{ uri: thumb_url as string }}
                        style={styles.thumb}
                        contentFit="cover"
                        recyclingKey={thumb_url}
                        transition={120}
                        onError={() => setImgFailed(true)}
                    />
                ) : (
                    <Ionicons name={glyph} size={26} color={palette.textMuted} />
                )}
            </View>

            {/* Caption block — same footprint in both states */}
            <View style={styles.caption}>
                {handle ? (
                    <View style={styles.handleRow}>
                        <Ionicons name={glyph} size={11} color={palette.textMuted} />
                        <Text style={[styles.handle, { color: palette.textSecondary }]} numberOfLines={1}>
                            @{handle}
                        </Text>
                    </View>
                ) : null}
                <Text style={[styles.attribution, { color: palette.textMuted }]} numberOfLines={2}>
                    clipped by <Text style={{ color: palette.textSecondary }}>{who}</Text>
                    {also_count > 0 ? ` +${also_count}` : ''}
                    {dateLabel ? ` · ${dateLabel}` : ''}
                </Text>
            </View>
        </>
    );

    if (!tappable) {
        return (
            <View
                style={[styles.card, { backgroundColor: palette.surfaceJournalLow }, Shadow.ambient]}
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
            hitSlop={4}
            style={({ pressed }) => [
                styles.card,
                { backgroundColor: palette.surfaceJournalLow, opacity: pressed ? 0.7 : 1 },
                Shadow.ambient,
            ]}
        >
            {body}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: {
        width: CARD_WIDTH,
        borderRadius: Radius.md,
        overflow: 'hidden',
    },
    media: {
        width: CARD_WIDTH,
        height: THUMB_HEIGHT,
        alignItems: 'center',
        justifyContent: 'center',
    },
    thumb: {
        width: CARD_WIDTH,
        height: THUMB_HEIGHT,
    },
    caption: {
        paddingHorizontal: 8,
        paddingTop: 6,
        paddingBottom: 9,
        gap: 2,
    },
    handleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
    },
    handle: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10.5,
        flexShrink: 1,
    },
    attribution: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 10.5,
        lineHeight: 14,
    },
});
