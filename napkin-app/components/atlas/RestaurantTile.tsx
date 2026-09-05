/**
 * RestaurantTile — 2-col masonry tile for Atlas city grid view.
 *
 * Three variants determined by tile_type prop:
 *   solo   — 1 avatar + personal rating + date
 *   round  — avatar stack + group-avg rating + amber "round" chip + "N of us · date"
 *   mixed  — avatar stack + round chip + "1 round · N solos" micro-line
 *
 * Heart glyph (top-left) when wished_by_viewer.
 * Italic Newsreader for restaurant name + rating.
 * Manrope for everything else.
 *
 * Wireframe: atlas-canvas.html .photo-tile
 */
import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    ImageBackground,
} from 'react-native';
import { Colors, Radius, Shadow } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { PressableScale } from '@/components/ui/napkin';
import {
    resolveSourcedPhoto,
    type ResolvedSourcedPhoto,
} from '@/components/ui/PlacesCredit';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/feed/Avatar';
import type { AtlasRestaurantTile } from '@/hooks/tables/useTableAtlasCity';

// Warm gradient fallbacks
const TEXTURES: readonly (readonly [string, string])[] = [
    ['#cc8b4a', '#713617'],
    ['#8c9962', '#4a5531'],
    ['#8f3e2b', '#3b170e'],
    ['#e3b770', '#92621d'],
    ['#d6b894', '#7b5830'],
    ['#7a7d85', '#3d3f47'],
    ['#7c2e34', '#2c0d10'],
    ['#9b6a49', '#4a2918'],
] as const;

function textureFor(id: string): readonly [string, string] {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
        hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
    }
    const t = TEXTURES[Math.abs(hash) % TEXTURES.length];
    return [t[0], t[1]] as const;
}

function formatDate(isoDate: string | null): string {
    if (!isoDate) return 'no date';
    return new Date(isoDate).toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
    });
}

interface Props {
    tile: AtlasRestaurantTile;
    onPress: () => void;
    heroHeight?: number;
    palette?: typeof Colors.light;
    /** AtlasGridView supplies its already-resolved, source-aware photo. */
    resolvedPhoto?: ResolvedSourcedPhoto;
    onPhotoError?: () => void;
}

export function RestaurantTile({
    tile,
    onPress,
    heroHeight = 190,
    palette: paletteProp,
    resolvedPhoto,
    onPhotoError,
}: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = paletteProp ?? Colors[scheme];
    const [gradStart, gradEnd] = textureFor(tile.id);
    const photo = resolvedPhoto ?? resolveSourcedPhoto({
        url: tile.photo_url,
        photoSource: tile.photo_source,
        attributionHtml: tile.places_photo_attribution_html,
        restaurantName: tile.name,
    });

    // Most-recent visit date
    const mostRecentDate = tile.visits[0]?.date ?? null;
    const dateLabel = formatDate(mostRecentDate);

    const isRound = tile.tile_type === 'round' || tile.tile_type === 'mixed';
    const isMixed = tile.tile_type === 'mixed';

    // Micro-line text
    let microLine = '';
    if (isMixed) {
        microLine = `${tile.round_count} round${tile.round_count !== 1 ? 's' : ''} · ${tile.solo_count} solo${tile.solo_count !== 1 ? 's' : ''}`;
    } else if (isRound) {
        microLine = `${tile.member_ids.length} of us · ${dateLabel}`;
    } else {
        // solo: "· Mar 12" — name+avatar rendered separately in Overlays
        microLine = dateLabel ? `· ${dateLabel}` : '';
    }

    // Solo tile: first visitor's name + avatar
    const soloName = !isRound ? (tile.member_names[0] ?? '') : '';
    const soloAvatarUrl = !isRound ? (tile.member_avatar_urls[0] ?? null) : null;

    // Rating string
    const ratingText = tile.rating != null ? tile.rating.toFixed(1) : null;

    return (
        <PressableScale onPress={onPress} haptic="light" scaleTo={0.97}>
            <View style={[styles.tile, Shadow.ambient]}>
                {/* Photo / gradient hero */}
                {photo.url ? (
                    <ImageBackground
                        source={{ uri: photo.url }}
                        style={[styles.img, { height: heroHeight }]}
                        imageStyle={styles.imgInner}
                        resizeMode="cover"
                        onError={onPhotoError}
                    >
                        <View style={styles.imgGradient} />
                        <View style={styles.imgOutline} />
                        <Overlays
                            tile={tile}
                            isRound={isRound}
                            isMixed={isMixed}
                            microLine={microLine}
                            ratingText={ratingText}
                            soloName={soloName}
                            soloAvatarUrl={soloAvatarUrl}
                            palette={palette}
                        />
                    </ImageBackground>
                ) : (
                    <View
                        style={[styles.img, { height: heroHeight, backgroundColor: gradStart }]}
                    >
                        <View
                            style={[
                                StyleSheet.absoluteFillObject,
                                { backgroundColor: gradEnd, opacity: 0.55 },
                            ]}
                        />
                        <View style={styles.imgGradient} />
                        <View style={styles.imgOutline} />
                        <Overlays
                            tile={tile}
                            isRound={isRound}
                            isMixed={isMixed}
                            microLine={microLine}
                            ratingText={ratingText}
                            soloName={soloName}
                            soloAvatarUrl={soloAvatarUrl}
                            palette={palette}
                        />
                    </View>
                )}
            </View>
        </PressableScale>
    );
}

// ── Overlays ──────────────────────────────────────────────────────────────────

interface OverlayProps {
    tile: AtlasRestaurantTile;
    isRound: boolean;
    isMixed: boolean;
    microLine: string;
    ratingText: string | null;
    /** Solo tile: visitor's name */
    soloName: string;
    /** Solo tile: visitor's avatar URL */
    soloAvatarUrl: string | null;
    palette: typeof Colors.light;
}

function Overlays({
    tile,
    isRound,
    isMixed,
    microLine,
    ratingText,
    soloName,
    soloAvatarUrl,
    palette,
}: OverlayProps) {
    const visibleMembers = tile.member_names.slice(0, 3);
    const extraMembers = Math.max(tile.member_names.length - 3, 0);

    return (
        <>
            {/* Wished heart — top-left */}
            {tile.wished_by_viewer && (
                <View style={styles.wishedHeart}>
                    <Ionicons
                        name="heart"
                        size={14}
                        color={palette.primary}
                    />
                </View>
            )}

            {/* Round chip — top-right */}
            {isRound && (
                <View style={styles.roundChip}>
                    <Text style={[styles.roundChipText, { color: palette.tertiary }]}>
                        round
                    </Text>
                </View>
            )}

            {/* Bottom overlay: name + who-line + rating */}
            <View style={styles.overlay}>
                <Text style={styles.rName} numberOfLines={2}>
                    {tile.name}
                </Text>

                <View style={styles.whoRow}>
                    {/* Round/mixed: avatar stack of blanks */}
                    {isRound ? (
                        <View style={styles.avStack}>
                            {visibleMembers.map((_, i) => (
                                <View
                                    key={i}
                                    style={[
                                        styles.miniAv,
                                        { marginRight: i < visibleMembers.length - 1 ? -5 : 0 },
                                        { backgroundColor: 'rgba(212,196,176,0.9)' },
                                    ]}
                                />
                            ))}
                            {extraMembers > 0 && (
                                <View
                                    style={[
                                        styles.miniAv,
                                        styles.avPlus,
                                        { marginLeft: -5 },
                                    ]}
                                >
                                    <Text style={styles.avPlusText}>+{extraMembers}</Text>
                                </View>
                            )}
                        </View>
                    ) : (
                        /* Solo: mini avatar + display name */
                        soloName ? (
                            <View style={styles.soloWho}>
                                <Avatar
                                    name={soloName}
                                    url={soloAvatarUrl}
                                    size={14}
                                    palette={palette}
                                />
                                <Text style={styles.soloName} numberOfLines={1}>
                                    {soloName}
                                </Text>
                            </View>
                        ) : null
                    )}

                    <Text style={styles.microText} numberOfLines={1}>
                        {microLine}
                    </Text>

                    {/* Rating — right-aligned */}
                    {ratingText != null && (
                        <Text style={styles.tileRating}>{ratingText}</Text>
                    )}
                </View>
            </View>
        </>
    );
}

const styles = StyleSheet.create({
    tile: {
        borderRadius: Radius.lg,
        overflow: 'hidden',
    },
    img: {
        position: 'relative',
        justifyContent: 'flex-end',
    },
    imgInner: {
        borderRadius: 0,
    },
    imgGradient: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'transparent',
        // Bottom overlay darkening effect simulated via background
        // Real gradient would need expo-linear-gradient; keep it simple
    },
    imgOutline: {
        ...StyleSheet.absoluteFillObject,
        borderWidth: 1,
        borderColor: 'rgba(0, 0, 0, 0.10)',
    },
    wishedHeart: {
        position: 'absolute',
        top: 10,
        left: 10,
        zIndex: 3,
        width: 18,
        height: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    roundChip: {
        position: 'absolute',
        top: 10,
        right: 10,
        zIndex: 3,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: Radius.sm,
        backgroundColor: 'rgba(255, 237, 213, 0.92)',
    },
    roundChipText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1.6,
    },
    overlay: {
        position: 'absolute',
        left: 10,
        right: 10,
        bottom: 9,
        zIndex: 2,
    },
    rName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
        lineHeight: 18,
        color: '#ffffff',
        marginBottom: 4,
        textShadowColor: 'rgba(0, 0, 0, 0.5)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 3,
    },
    whoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    avStack: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    miniAv: {
        width: 14,
        height: 14,
        borderRadius: 7,
        backgroundColor: 'rgba(212,196,176,0.9)',
        borderWidth: 1,
        borderColor: 'rgba(28,28,25,0.4)',
    },
    avPlus: {
        backgroundColor: 'rgba(253,246,236,0.9)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    avPlusText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 7,
        color: '#56423d',
    },
    soloWho: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    soloName: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 10,
        color: 'rgba(255,255,255,0.92)',
        textShadowColor: 'rgba(0,0,0,0.55)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 3,
        maxWidth: 60,
    },
    microText: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 10,
        color: 'rgba(255,255,255,0.88)',
        letterSpacing: 0.15,
        fontVariant: ['tabular-nums'],
        flex: 1,
        textShadowColor: 'rgba(0,0,0,0.55)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 3,
    },
    tileRating: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
        color: '#f9e2b5',
        fontVariant: ['tabular-nums'],
        textShadowColor: 'rgba(0,0,0,0.5)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 3,
        marginLeft: 'auto',
    },
});

export default RestaurantTile;
