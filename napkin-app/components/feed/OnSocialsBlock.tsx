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
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Colors, Shadow } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    PlacesCredit,
    resolveSourcedPhoto,
    type PlacesPhotoCredit,
} from '@/components/ui/PlacesCredit';
import { PressableScale } from '@/components/ui/napkin/PressableScale';
import type { SocialsCard } from '@/hooks/feed/useSocials';
import { SectionKicker } from './SectionKicker';
import { chipTint } from './GlyphChip';
import { reduceRailKicker, socialsSignalLine } from './socialsPresentation';

type Palette = typeof Colors.light;
type Glyph = React.ComponentProps<typeof Ionicons>['name'];

const CARD_WIDTH = 136;
const MEDIA_HEIGHT = 118;
const CARD_HEIGHT = 166;

function platformGlyph(platform: SocialsCard['platform']): Glyph {
    if (platform === 'tiktok') return 'logo-tiktok';
    if (platform === 'instagram') return 'logo-instagram';
    return 'share-social-outline';
}

export function OnSocialsBlock({ cards }: { cards: SocialsCard[] }) {
    const [failedPhotoKeys, setFailedPhotoKeys] = useState<Set<string>>(() => new Set());
    const handlePhotoError = useCallback((failureKey: string) => {
        setFailedPhotoKeys((current) => {
            if (current.has(failureKey)) return current;
            return new Set(current).add(failureKey);
        });
    }, []);

    // Resolve the clip-first ladder in the owning render. The chosen Places
    // image and its aggregate credit therefore enter and leave in the same
    // commit, including after either image rung fails.
    const presentations = cards.map((card) => {
        const thumbFailureKey = card.thumb_url
            ? `${card.restaurant_id}:thumb:${card.thumb_url}`
            : null;
        const showThumb = !!thumbFailureKey && !failedPhotoKeys.has(thumbFailureKey);
        const placesHero = resolveSourcedPhoto({
            url: card.photo_url,
            // The clip fallback ladder is specifically mirrored Places imagery;
            // user/Table restaurant heroes are not public-feed fallbacks.
            photoSource: card.photo_source === 'places' ? 'places' : null,
            attributionHtml: card.attribution_html,
            restaurantName: card.name,
        });
        const heroFailureKey = placesHero.url
            ? `${card.restaurant_id}:places:${placesHero.url}`
            : null;
        const showHero = !showThumb
            && !!heroFailureKey
            && !failedPhotoKeys.has(heroFailureKey);

        return {
            card,
            thumbUrl: showThumb ? card.thumb_url : null,
            thumbFailureKey,
            heroUrl: showHero ? placesHero.url : null,
            heroFailureKey,
            credit: showHero ? placesHero.credit : null,
        };
    });
    const renderedPlacesPhotos = presentations.flatMap((presentation) => (
        presentation.heroUrl && presentation.credit
            ? [{ url: presentation.heroUrl, credit: presentation.credit }]
            : []
    ));

    if (cards.length === 0) return null;

    return (
        <View>
            <SectionKicker>{reduceRailKicker(cards)}</SectionKicker>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.railContent}
            >
                {presentations.map((presentation) => (
                    <SocialsClipCard
                        key={presentation.card.restaurant_id}
                        {...presentation}
                        onPhotoError={handlePhotoError}
                    />
                ))}
            </ScrollView>
            <PlacesCredit
                credits={renderedPlacesPhotos.map((photo) => photo.credit)}
                photoCount={renderedPlacesPhotos.length}
                testID="socials-places-credit"
                interactive={false}
                style={styles.aggregateCredit}
            />
        </View>
    );
}

function SocialsClipCard({
    card,
    thumbUrl,
    thumbFailureKey,
    heroUrl,
    heroFailureKey,
    onPhotoError,
}: {
    card: SocialsCard;
    thumbUrl: string | null;
    thumbFailureKey: string | null;
    heroUrl: string | null;
    heroFailureKey: string | null;
    credit: PlacesPhotoCredit | null;
    onPhotoError: (failureKey: string) => void;
}) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme] as Palette;
    const router = useRouter();

    const signal = socialsSignalLine(card);
    const mediaBackground = chipTint(card.restaurant_id, palette);

    return (
        <PressableScale
            onPress={() =>
                router.push({ pathname: '/restaurant/[id]', params: { id: card.restaurant_id } })
            }
            style={styles.card}
            haptic="light"
            accessibilityRole="button"
            accessibilityLabel={`${card.name}. ${signal}`}
            testID="social-card"
        >
            <View
                style={[styles.mediaFrame, { backgroundColor: mediaBackground }, Shadow.ambient]}
                testID="social-media-frame"
            >
                <View
                    style={[
                        styles.media,
                        {
                            backgroundColor: mediaBackground,
                            borderColor: palette.imageOutline,
                        },
                    ]}
                >
                    {thumbUrl ? (
                        <ExpoImage
                            source={{ uri: thumbUrl }}
                            style={StyleSheet.absoluteFillObject}
                            contentFit="cover"
                            recyclingKey={thumbUrl}
                            transition={120}
                            onError={() => thumbFailureKey && onPhotoError(thumbFailureKey)}
                        />
                    ) : heroUrl ? (
                        <ExpoImage
                            source={{ uri: heroUrl }}
                            style={StyleSheet.absoluteFillObject}
                            contentFit="cover"
                            recyclingKey={heroUrl}
                            transition={120}
                            onError={() => heroFailureKey && onPhotoError(heroFailureKey)}
                        />
                    ) : (
                        <Ionicons
                            name={platformGlyph(card.platform)}
                            size={26}
                            color={palette.textMuted}
                        />
                    )}
                </View>
            </View>
            <View style={styles.caption}>
                <Text
                    style={[styles.name, { color: palette.text }]}
                    numberOfLines={1}
                    testID="social-name"
                >
                    {card.name}
                </Text>
                <Text
                    style={[styles.signal, { color: palette.textSecondary }]}
                    numberOfLines={1}
                    testID="social-signal"
                >
                    {signal}
                </Text>
            </View>
        </PressableScale>
    );
}

const styles = StyleSheet.create({
    railContent: {
        paddingHorizontal: 20,
        paddingBottom: 6,
        gap: 12,
    },
    card: {
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
    },
    mediaFrame: {
        width: CARD_WIDTH,
        height: MEDIA_HEIGHT,
        borderRadius: 14,
    },
    media: {
        width: CARD_WIDTH,
        height: MEDIA_HEIGHT,
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    aggregateCredit: {
        marginHorizontal: 20,
        marginTop: 6,
    },
    caption: {
        paddingTop: 9,
    },
    name: {
        fontFamily: 'Newsreader_500Medium',
        fontSize: 15,
        fontWeight: '500',
        lineHeight: 18,
        height: 18,
    },
    signal: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
        lineHeight: 18,
        height: 18,
        marginTop: 3,
    },
});
