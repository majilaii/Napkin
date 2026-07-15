/**
 * OnSocialsBlock — the "on socials" For You module (TICKET-189).
 *
 * What's being saved off TikTok/IG this week, shown as a horizontal rail
 * (cap 6, server-enforced) of portrait clip cards. Every fact on a card is
 * viewer-safe: the server ladder decides rung/window/count/platform (blocks,
 * private flips, and self-exclusion already applied), and no Napkin saver
 * identity ever reaches this component — rung-3 provenance is the platform
 * CREATOR's handle.
 *
 * Imagery — clip-first chain, PINNED at the clip rung by definition (module
 * content IS the clip): durable clip_thumbs copy → mirrored Places hero
 * (attributed) → platform-glyph type plate on chipTint. Never a provider CDN
 * hotlink, never a blank. Cards route OUT to /restaurant/[id] (identity-level
 * "who saved" lives there, already gated).
 *
 * Rail kicker is the deterministic reduction over the visible cards
 * (socialsPresentation.reduceRailKicker — window-honest, never a false
 * "this week"). Self-hides (null) when there are no cards.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';

import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { parsePlacesAttribution } from '@/lib/parsePlacesAttribution';
import { PressableScale } from '@/components/ui/napkin/PressableScale';
import type { SocialsCard } from '@/hooks/feed/useSocials';
import { SectionKicker } from './SectionKicker';
import { chipTint } from './GlyphChip';
import { reduceRailKicker, socialsSignalLine } from './socialsPresentation';

type Palette = typeof Colors.light;
type Glyph = React.ComponentProps<typeof Ionicons>['name'];

const CARD_WIDTH = 136;
const MEDIA_HEIGHT = Math.round((CARD_WIDTH * 4) / 3); // 3:4 portrait

function platformGlyph(platform: SocialsCard['platform']): Glyph {
    if (platform === 'tiktok') return 'logo-tiktok';
    if (platform === 'instagram') return 'logo-instagram';
    return 'share-social-outline';
}

export function OnSocialsBlock({ cards }: { cards: SocialsCard[] }) {
    if (cards.length === 0) return null;

    return (
        <View>
            <SectionKicker>{reduceRailKicker(cards)}</SectionKicker>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.railContent}
            >
                {cards.map((card) => (
                    <SocialsClipCard key={card.restaurant_id} card={card} />
                ))}
            </ScrollView>
        </View>
    );
}

function SocialsClipCard({ card }: { card: SocialsCard }) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;
    const router = useRouter();
    const [thumbFailed, setThumbFailed] = useState(false);
    const [heroFailed, setHeroFailed] = useState(false);

    // Clip-first chain: durable thumb → attributed Places hero → type plate.
    const showThumb = !!card.thumb_url && !thumbFailed;
    const placesAttribution =
        card.photo_source === 'places' ? parsePlacesAttribution(card.attribution_html) : null;
    const showHero = !showThumb && !!card.photo_url && !!placesAttribution && !heroFailed;

    const signal = socialsSignalLine(card);

    return (
        <PressableScale
            onPress={() =>
                router.push({ pathname: '/restaurant/[id]', params: { id: card.restaurant_id } })
            }
            style={[styles.card, { backgroundColor: palette.card }, Shadow.note]}
            haptic="light"
            accessibilityRole="button"
            accessibilityLabel={`${card.name}. ${signal}`}
        >
            <View style={[styles.media, { backgroundColor: chipTint(card.restaurant_id, palette) }]}>
                {showThumb ? (
                    <ExpoImage
                        source={{ uri: card.thumb_url as string }}
                        style={StyleSheet.absoluteFillObject}
                        contentFit="cover"
                        recyclingKey={card.thumb_url}
                        transition={120}
                        onError={() => setThumbFailed(true)}
                    />
                ) : showHero ? (
                    <>
                        <ExpoImage
                            source={{ uri: card.photo_url as string }}
                            style={StyleSheet.absoluteFillObject}
                            contentFit="cover"
                            recyclingKey={card.photo_url}
                            transition={120}
                            onError={() => setHeroFailed(true)}
                        />
                        <LinearGradient
                            colors={['rgba(28, 28, 25, 0)', 'rgba(28, 28, 25, 0.6)']}
                            locations={[0.6, 1]}
                            style={StyleSheet.absoluteFillObject}
                        />
                        <Text
                            style={[styles.credit, { color: palette.textOnImage }]}
                            numberOfLines={1}
                        >
                            {placesAttribution!.label}
                        </Text>
                    </>
                ) : (
                    <Ionicons
                        name={platformGlyph(card.platform)}
                        size={26}
                        color={palette.textMuted}
                    />
                )}
            </View>
            <View style={styles.caption}>
                <Text style={[styles.name, { color: palette.text }]} numberOfLines={2}>
                    {card.name}
                </Text>
                <Text style={[styles.signal, { color: palette.textMuted }]} numberOfLines={1}>
                    {signal}
                </Text>
            </View>
        </PressableScale>
    );
}

const styles = StyleSheet.create({
    railContent: {
        paddingHorizontal: Spacing.lg,
        gap: 12,
    },
    card: {
        width: CARD_WIDTH,
        borderRadius: Radius.lg,
        overflow: 'hidden',
    },
    media: {
        width: CARD_WIDTH,
        height: MEDIA_HEIGHT,
        alignItems: 'center',
        justifyContent: 'center',
    },
    credit: {
        position: 'absolute',
        bottom: 5,
        left: 8,
        right: 8,
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        lineHeight: 14,
        opacity: 0.9,
    },
    caption: {
        paddingHorizontal: 10,
        paddingTop: 8,
        paddingBottom: 10,
        gap: 3,
    },
    name: {
        fontFamily: 'Newsreader_500Medium',
        fontSize: 16,
        lineHeight: 19,
    },
    signal: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        lineHeight: 15,
    },
});
