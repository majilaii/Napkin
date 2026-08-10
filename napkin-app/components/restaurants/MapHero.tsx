/**
 * MapHero — the restaurant page hero (design 2a "Dossier, map hero").
 *
 * A faded, warm-paper map with a terracotta pin standing where a photo would
 * (photos are banned — no reliable sourcing). Real geography via Apple Maps'
 * muted style under a cream wash, fading into the page background so the
 * identity block sits on paper:
 *
 *   [ faded map · pin with halo ]         ‹ back floats top-left
 *   CUISINE · CITY · $$$                  (kicker, price in amber)
 *   The Ritz London                       (serif 500, non-italic, 33)
 *   pinned · been 3 times · last april    (italic serif relationship line)
 *
 * No compass, no status chrome. Falls back to a flat paper header when the
 * restaurant has no coordinates (ghosts before Place Details sync). iOS keeps
 * Apple mutedStandard; Android uses the MapTiler raster over mapType none.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import MapView, {
    Marker,
    UrlTile,
    PROVIDER_DEFAULT,
    PROVIDER_GOOGLE,
} from 'react-native-maps';

import { Colors } from '@/constants/theme';
import { MAP_TILE_MODE, MAPTILER_ATTRIBUTION, tileUrlTemplate } from '@/lib/maptiler';

type Palette = typeof Colors.light;

interface Props {
    lat: number | null;
    lng: number | null;
    /** "CUISINE · CITY" — already composed, without price. */
    kicker: string | null;
    /** "$$$" — rendered in amber after the kicker. */
    priceLabel: string | null;
    name: string;
    /** "pinned · been twice · last june" — null hides the line. */
    relationshipLine: string | null;
    onBack: () => void;
    topInset: number;
    palette: Palette;
}

function withAlpha(hex: string, alpha: number): string {
    const aa = Math.round(alpha * 255).toString(16).padStart(2, '0');
    return `${hex}${aa}`;
}

/** Terracotta teardrop with a soft halo — the design's pin, in Views. */
function HeroPin({ palette }: { palette: Palette }) {
    return (
        <View style={pinStyles.wrap}>
            <View style={[pinStyles.halo, { backgroundColor: withAlpha(palette.primary, 0.09) }]} />
            <View style={[pinStyles.haloInner, { backgroundColor: withAlpha(palette.primary, 0.14) }]} />
            <View
                style={[
                    pinStyles.tear,
                    { backgroundColor: palette.primary, borderColor: palette.background },
                ]}
            >
                <View style={[pinStyles.dot, { backgroundColor: palette.background }]} />
            </View>
        </View>
    );
}

const pinStyles = StyleSheet.create({
    wrap: {
        width: 72,
        height: 72,
        alignItems: 'center',
        justifyContent: 'center',
    },
    halo: {
        position: 'absolute',
        width: 64,
        height: 64,
        borderRadius: 32,
    },
    haloInner: {
        position: 'absolute',
        width: 40,
        height: 40,
        borderRadius: 20,
    },
    tear: {
        width: 26,
        height: 26,
        borderRadius: 13,
        borderBottomLeftRadius: 0,
        transform: [{ rotate: '-45deg' }],
        borderWidth: 1.5,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.25,
        shadowRadius: 5,
        elevation: 4,
    },
    dot: {
        width: 9,
        height: 9,
        borderRadius: 4.5,
        transform: [{ rotate: '45deg' }],
    },
});

export function MapHero({
    lat,
    lng,
    kicker,
    priceLabel,
    name,
    relationshipLine,
    onBack,
    topInset,
    palette,
}: Props) {
    const hasMap = lat != null && lng != null;
    const bg = palette.background;
    const tilesOn = MAP_TILE_MODE === 'maptiler';

    return (
        <View style={[styles.hero, { height: (hasMap ? 250 : 96) + topInset, backgroundColor: bg }]}>
            {hasMap ? (
                <>
                    <MapView
                        style={StyleSheet.absoluteFillObject}
                        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
                        mapType={
                            tilesOn && Platform.OS === 'android'
                                ? 'none'
                                : Platform.OS === 'ios'
                                  ? 'mutedStandard'
                                  : 'standard'
                        }
                        // Maps never go dark — Apple tiles follow the SYSTEM
                        // appearance, not the light-forced palette (2026-07-08).
                        userInterfaceStyle="light"
                        pointerEvents="none"
                        initialRegion={{
                            latitude: lat!,
                            longitude: lng!,
                            latitudeDelta: 0.006,
                            longitudeDelta: 0.006,
                        }}
                        scrollEnabled={false}
                        zoomEnabled={false}
                        pitchEnabled={false}
                        rotateEnabled={false}
                        showsPointsOfInterest={false}
                        showsCompass={false}
                        showsBuildings={false}
                        toolbarEnabled={false}
                        // Android lite mode does not provide the full overlay
                        // surface needed by UrlTile. iOS ignores this prop.
                        liteMode={!tilesOn}
                    >
                        {tilesOn ? (
                            <UrlTile
                                urlTemplate={tileUrlTemplate()}
                                shouldReplaceMapContent={Platform.OS === 'ios'}
                                tileSize={512}
                                maximumZ={20}
                            />
                        ) : null}
                        <Marker
                            coordinate={{ latitude: lat!, longitude: lng! }}
                            anchor={{ x: 0.5, y: 0.6 }}
                            tracksViewChanges={false}
                        >
                            <HeroPin palette={palette} />
                        </Marker>
                    </MapView>
                    {/* Warm-paper wash — light enough that real streets stay legible */}
                    <View
                        pointerEvents="none"
                        style={[StyleSheet.absoluteFillObject, { backgroundColor: bg, opacity: 0.32 }]}
                    />
                    {/* Fade into the page so the identity block sits on paper */}
                    <LinearGradient
                        pointerEvents="none"
                        colors={[withAlpha(bg, 0), withAlpha(bg, 0.45), bg]}
                        locations={[0.38, 0.66, 0.96]}
                        style={StyleSheet.absoluteFillObject}
                    />
                    {tilesOn ? (
                        <Text
                            pointerEvents="none"
                            style={[
                                styles.attribution,
                                { top: topInset + 8, color: palette.textMuted },
                            ]}
                        >
                            {MAPTILER_ATTRIBUTION}
                        </Text>
                    ) : null}
                </>
            ) : null}

            {/* ‹ back — frosted circle floating over the map */}
            <Pressable
                onPress={onBack}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="back"
                style={[
                    styles.backBtn,
                    { top: topInset + 6, backgroundColor: withAlpha(palette.surfaceNote, 0.88) },
                ]}
            >
                <Ionicons name="chevron-back" size={17} color={palette.text} />
            </Pressable>

            {/* Identity block */}
            <View style={styles.identity}>
                {kicker || priceLabel ? (
                    <Text style={styles.kicker} numberOfLines={1}>
                        <Text style={{ color: palette.textMuted }}>{kicker ?? ''}</Text>
                        {priceLabel ? (
                            <Text style={{ color: palette.tertiary }}>{`${kicker ? ' · ' : ''}${priceLabel}`}</Text>
                        ) : null}
                    </Text>
                ) : null}
                <Text style={[styles.name, { color: palette.text }]} numberOfLines={2}>
                    {name}
                </Text>
                {relationshipLine ? (
                    <Text style={[styles.relationship, { color: palette.textSecondary }]} numberOfLines={1}>
                        {relationshipLine}
                    </Text>
                ) : null}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    hero: {
        position: 'relative',
    },
    backBtn: {
        position: 'absolute',
        left: 16,
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2,
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 2,
    },
    identity: {
        position: 'absolute',
        left: 20,
        right: 20,
        bottom: 8,
    },
    attribution: {
        position: 'absolute',
        right: 8,
        fontFamily: 'Manrope_500Medium',
        fontSize: 9,
        letterSpacing: 0.2,
        zIndex: 1,
    },
    kicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 2,
        textTransform: 'uppercase',
    },
    name: {
        fontFamily: 'Newsreader_500Medium',
        fontSize: 33,
        lineHeight: 36,
        letterSpacing: -0.8,
        marginTop: 6,
    },
    relationship: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13.5,
        marginTop: 6,
    },
});

export default MapHero;
