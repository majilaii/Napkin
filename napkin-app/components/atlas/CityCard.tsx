/**
 * CityCard — photo-backed city tile in the Atlas city masonry.
 *
 * Design: Radius.lg (14px), inset image outline, ambient shadow,
 * dark gradient overlay, italic Newsreader city name bottom-left,
 * meta line with tabular-nums below the photo.
 *
 * Wireframe: atlas-canvas.html .city-card
 */
import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    ImageBackground,
    useWindowDimensions,
} from 'react-native';
import { Colors, Radius, Shadow } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { PressableScale } from '@/components/ui/napkin';
import type { AtlasCityRow } from '@/hooks/tables/useTableAtlas';

// Warm gradient textures — rotated per city deterministically
const TEXTURES: ReadonlyArray<readonly [string, string]> = [
    ['#cc8b4a', '#713617'],
    ['#c9946f', '#7a4a30'],
    ['#d48a3f', '#8e3c16'],
    ['#9fa88a', '#5a624a'],
    ['#5a6a85', '#29354a'],
    ['#d5a172', '#8c5127'],
    ['#c47a6a', '#6b2a1e'],
    ['#8c9962', '#4a5531'],
] as const;

function textureForCity(cityName: string): readonly [string, string] {
    let hash = 0;
    for (let i = 0; i < cityName.length; i++) {
        hash = ((hash << 5) - hash + cityName.charCodeAt(i)) | 0;
    }
    const t = TEXTURES[Math.abs(hash) % TEXTURES.length];
    return [t[0], t[1]] as const;
}

function formatLastVisit(isoDate: string): string {
    const d = new Date(isoDate);
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

interface Props {
    city: AtlasCityRow;
    onPress: () => void;
    /** Height for the photo hero area. Stagger between columns */
    heroHeight?: number;
    palette?: typeof Colors.light;
}

export function CityCard({ city, onPress, heroHeight = 180, palette: paletteProp }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = paletteProp ?? Colors[scheme];
    const [gradStart, gradEnd] = textureForCity(city.name);

    const meta = `${city.spot_count} spot${city.spot_count !== 1 ? 's' : ''} · ${city.member_count} of us · last ${formatLastVisit(city.last_visit_at)}`;

    return (
        <PressableScale onPress={onPress} haptic="light" scaleTo={0.97}>
            <View style={[styles.card, Shadow.ambient]}>
                {/* Photo hero */}
                {city.hero_photo_url ? (
                    <ImageBackground
                        source={{ uri: city.hero_photo_url }}
                        style={[styles.hero, { height: heroHeight }]}
                        imageStyle={styles.heroImage}
                        resizeMode="cover"
                    >
                        <View style={styles.gradient} />
                        <View style={styles.imageOutline} />
                        <Text style={styles.cityName}>{city.name}</Text>
                    </ImageBackground>
                ) : (
                    <View
                        style={[
                            styles.hero,
                            {
                                height: heroHeight,
                                backgroundColor: gradStart,
                            },
                        ]}
                    >
                        {/* Faux gradient via second layer */}
                        <View
                            style={[
                                StyleSheet.absoluteFillObject,
                                {
                                    backgroundColor: gradEnd,
                                    opacity: 0.5,
                                },
                            ]}
                        />
                        <View style={styles.gradient} />
                        <View style={styles.imageOutline} />
                        <Text style={styles.cityName}>{city.name}</Text>
                    </View>
                )}

                {/* Meta line */}
                <View style={[styles.body, { backgroundColor: palette.surfaceJournalLow }]}>
                    <Text
                        style={[styles.metaText, { color: palette.textMuted }]}
                        numberOfLines={1}
                    >
                        {meta}
                    </Text>
                </View>
            </View>
        </PressableScale>
    );
}

const styles = StyleSheet.create({
    card: {
        borderRadius: Radius.lg,
        overflow: 'hidden',
    },
    hero: {
        position: 'relative',
        justifyContent: 'flex-end',
    },
    heroImage: {
        borderRadius: 0,
    },
    gradient: {
        ...StyleSheet.absoluteFillObject,
        // Dark gradient from transparent (top) to 62% opacity (bottom)
        backgroundColor: 'transparent',
        // We simulate the gradient with a bottom overlay
        justifyContent: 'flex-end',
    },
    imageOutline: {
        ...StyleSheet.absoluteFillObject,
        borderWidth: 1,
        borderColor: 'rgba(0, 0, 0, 0.10)',
        borderRadius: 0,
    },
    cityName: {
        position: 'absolute',
        left: 12,
        bottom: 10,
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 22,
        color: '#ffffff',
        letterSpacing: -0.2,
        textShadowColor: 'rgba(0, 0, 0, 0.4)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 4,
    },
    body: {
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: 10,
    },
    metaText: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 10.5,
        letterSpacing: 0.1,
        fontVariant: ['tabular-nums'],
    },
});

export default CityCard;
