/**
 * MarqueePlate — TICKET-146. The shared Top-4 "poster" plate (the Letterboxd
 * marquee, translated to Heirloom). One 2:3 plate, double-hairline inner border,
 * mark + ground from the engraving registries so the same restaurant reads
 * identically here and on the map. Public profile reuses this component.
 *
 * Two variants, one family:
 *   • typographic (default) — tinted cream ground + engraved mark, upright
 *     editorial name, city in letterspaced caps, rating terracotta italic.
 *   • photo (TICKET-144 pt2) — the owner's own chosen entry photo fills the
 *     plate, warm scrim at the foot, name overlaid, and quiet corner metadata
 *     held legible with a top-edge vignette and soft shadow instead of a
 *     container. Same border,
 *     so a photo plate and a typographic plate sit as one row.
 *
 * The mark chain lives in engraving.ts (never per-item); this component only
 * renders the discriminated `Mark` union at plate scale.
 */
import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { markFor, tintFor, type Mark } from '@/lib/engraving';

interface MarqueePlateProps {
    restaurantId: string; // tint seed
    name: string;
    cuisine?: string | null;
    listEmoji?: string | null;
    city?: string | null;
    rating?: number | null; // italic numeric accent; hidden when null
    /**
     * Ordering position, 1–4. NOT rendered — founder call 2026-07-24: the
     * numeral was dropped from the plate because grid order already states the
     * ranking and the tile reads chicer without it (it also left the score as
     * the only numeral on the plate, which is what the "/5" was compensating
     * for). Still required: it carries the position into the accessibility
     * label, where non-visual users have no grid to read it from.
     */
    rank: number;
    photoUrl?: string | null; // truthy → photo variant; undefined → typographic
    /**
     * TICKET-157: apply the warm Places wash over the photo (borrowed venue photo,
     * not the owner's own). Resolver output — true ONLY on the gated Places tier;
     * a chosen-memory photo is always `false` (never washed).
     */
    placesWash?: boolean;
    /** Compact Profile summary: prioritize the name over decorative mark/city. */
    compact?: boolean;
    onPress?: () => void;
    onPhotoError?: (url: string) => void;
    style?: StyleProp<ViewStyle>;
}

const PLATE_CREAM = '#fef6e6';
// These labels are embedded inside a fixed-ratio artwork. Keep modest scaling
// so the plate remains legible; the Pressable accessibility label carries the
// full restaurant name and rating at every Dynamic Type size.
const PLATE_MAX_FONT_SCALE = 1.2;

function MarkGlyph({ mark, palette, onPhoto }: { mark: Mark; palette: typeof Colors.light; onPhoto?: boolean }) {
    switch (mark.kind) {
        case 'emoji':
            return (
                <Text style={styles.markEmoji} maxFontSizeMultiplier={PLATE_MAX_FONT_SCALE}>
                    {mark.emoji}
                </Text>
            );
        case 'glyph':
            return (
                <Ionicons
                    name={mark.glyph}
                    size={30}
                    color={onPhoto ? PLATE_CREAM : palette.primary}
                    style={styles.markGlyph}
                />
            );
        case 'monogram':
            return (
                <Text
                    style={[styles.markMonogram, { color: onPhoto ? PLATE_CREAM : palette.primary }]}
                    maxFontSizeMultiplier={PLATE_MAX_FONT_SCALE}
                >
                    {mark.letter}
                </Text>
            );
    }
}

export function MarqueePlate({
    restaurantId,
    name,
    cuisine,
    listEmoji,
    city,
    rating,
    rank,
    photoUrl,
    placesWash,
    compact = false,
    onPress,
    onPhotoError,
    style,
}: MarqueePlateProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const mark = markFor({ name, cuisine, listEmoji });
    // TICKET-157 [ARCH-REVIEW W3]: a failed image load falls to typographic; reset
    // the sticky error when the source changes (in-place slot swaps reuse this node).
    const [imgError, setImgError] = useState(false);
    useEffect(() => setImgError(false), [photoUrl]);
    const isPhoto = !!photoUrl && !imgError;

    return (
        <Pressable
            onPress={onPress}
            disabled={!onPress}
            style={({ pressed }) => [
                styles.plate,
                { backgroundColor: isPhoto ? palette.surfaceContainerHigh : tintFor(restaurantId, palette) },
                pressed && onPress ? { opacity: 0.9 } : null,
                style,
            ]}
            accessibilityRole={onPress ? 'button' : undefined}
            accessibilityLabel={
                onPress
                    ? `${rank}. ${name}${rating != null ? `, rated ${rating.toFixed(1)} out of 5` : ''}`
                    : undefined
            }
        >
            {isPhoto ? (
                <>
                    <Image
                        source={{ uri: photoUrl! }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        transition={200}
                        recyclingKey={photoUrl ?? restaurantId}
                        onError={() => {
                            setImgError(true);
                            onPhotoError?.(photoUrl!);
                        }}
                    />
                    {/* TICKET-157: warm Places wash — layered between the photo and the
                        bottom scrim so borrowed venue photos read distinct from the
                        owner's chosen-memory shots. Never applied to chosen-memory
                        (placesWash is false for the custom tier). */}
                    {placesWash ? (
                        <View
                            style={[
                                StyleSheet.absoluteFill,
                                {
                                    backgroundColor: palette.placesOverlayTint,
                                    opacity: palette.placesOverlayOpacity,
                                },
                            ]}
                            pointerEvents="none"
                        />
                    ) : null}
                    <LinearGradient
                        testID="top-four-photo-vignette"
                        colors={[
                            'rgba(28,28,25,0.70)',
                            'rgba(28,28,25,0.62)',
                            'transparent',
                        ]}
                        locations={[0, 0.55, 1]}
                        style={styles.topScrim}
                        pointerEvents="none"
                    />
                    <LinearGradient
                        colors={['transparent', 'rgba(28,28,25,0.62)']}
                        style={styles.scrim}
                        pointerEvents="none"
                    />
                    {rating != null ? (
                        <Text
                            style={styles.ratingPhoto}
                            maxFontSizeMultiplier={PLATE_MAX_FONT_SCALE}
                        >
                            {rating.toFixed(1)}
                            <Text style={styles.ratingDenominatorPhoto}>/5</Text>
                        </Text>
                    ) : null}
                    <View style={styles.photoFooter} pointerEvents="none">
                        <Text
                            style={styles.namePhoto}
                            numberOfLines={2}
                            maxFontSizeMultiplier={PLATE_MAX_FONT_SCALE}
                        >
                            {name}
                        </Text>
                    </View>
                </>
            ) : (
                <>
                    <View style={[styles.typoBody, compact ? styles.typoBodyCompact : null]}>
                        {!compact ? (
                            <View style={styles.markWrap}>
                                <MarkGlyph mark={mark} palette={palette} />
                            </View>
                        ) : null}
                        <Text
                            style={[styles.name, { color: palette.text }]}
                            numberOfLines={compact ? 3 : 2}
                            maxFontSizeMultiplier={PLATE_MAX_FONT_SCALE}
                        >
                            {name}
                        </Text>
                        {city && !compact ? (
                            <Text
                                style={[styles.city, { color: palette.textMuted }]}
                                numberOfLines={1}
                                maxFontSizeMultiplier={PLATE_MAX_FONT_SCALE}
                            >
                                {city.toUpperCase()}
                            </Text>
                        ) : null}
                    </View>
                    {rating != null ? (
                        <Text
                            style={[
                                styles.rating,
                                compact ? styles.ratingCompactPosition : null,
                                { color: palette.primary },
                            ]}
                            maxFontSizeMultiplier={PLATE_MAX_FONT_SCALE}
                        >
                            {rating.toFixed(1)}
                            <Text style={styles.ratingDenominator}>/5</Text>
                        </Text>
                    ) : null}
                </>
            )}

            {/* Double hairline inner border — the house-plate specimen. Overlays
                both variants so photo + typographic read as one family. */}
            <View style={styles.hairlineOuter} pointerEvents="none" />
            <View style={styles.hairlineInner} pointerEvents="none" />
        </Pressable>
    );
}

const styles = StyleSheet.create({
    plate: {
        aspectRatio: 2 / 3,
        borderRadius: Radius.md,
        overflow: 'hidden',
        paddingHorizontal: 8,
        paddingVertical: 10,
    },
    // ── typographic variant ──────────────────────────────────────────────
    typoBody: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingTop: '16%',
    },
    typoBodyCompact: {
        justifyContent: 'center',
        paddingTop: 22,
        paddingBottom: 8,
    },
    markWrap: {
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 9,
    },
    markGlyph: {
        opacity: 0.8,
    },
    markEmoji: {
        fontSize: 26,
        includeFontPadding: false,
    },
    markMonogram: {
        fontFamily: 'Newsreader_600SemiBold',
        fontSize: 30,
        includeFontPadding: false,
    },
    name: {
        fontFamily: 'Newsreader_600SemiBold',
        fontSize: 14.5,
        lineHeight: 17.5,
        textAlign: 'center',
    },
    city: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11,
        letterSpacing: 0.8,
        marginTop: 4,
        textAlign: 'center',
    },
    rating: {
        position: 'absolute',
        bottom: 8,
        right: 9,
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 20,
        fontVariant: ['tabular-nums'],
        zIndex: 2,
    },
    /**
     * Denominator on the Top 4 score (founder call 2026-07-24, option A).
     * A bare "4.5" beside a bare rank numeral read as two unlabelled numbers —
     * neither declaring its scale. The "/5" resolves both at once: the scored
     * one is the one carrying a denominator. Upright Manrope, deliberately NOT
     * the italic serif — the italic is the scarce accent reserved for the
     * numeral itself, and keeping the unit upright is what makes it read as a
     * unit rather than part of the number. 11pt = the uppercase-label floor.
     */
    ratingDenominator: {
        fontFamily: 'Manrope_500Medium',
        fontStyle: 'normal',
        fontSize: 11,
        opacity: 0.75,
    },
    ratingCompactPosition: {
        top: 7,
        bottom: undefined,
    },
    // ── photo variant ────────────────────────────────────────────────────
    topScrim: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '32%',
    },
    scrim: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: '55%',
    },
    photoFooter: {
        position: 'absolute',
        left: 9,
        right: 9,
        bottom: 8,
    },
    namePhoto: {
        fontFamily: 'Newsreader_600SemiBold',
        fontSize: 14.5,
        lineHeight: 17.5,
        color: PLATE_CREAM,
    },
    ratingPhoto: {
        position: 'absolute',
        top: 7,
        right: 9,
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 20,
        color: PLATE_CREAM,
        fontVariant: ['tabular-nums'],
        textShadowColor: 'rgba(28,28,25,0.72)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 3,
        zIndex: 2,
    },
    /** Photo-variant denominator — see `ratingDenominator`. Inherits the
     *  parent's cream + text shadow so it stays legible on any hero. */
    ratingDenominatorPhoto: {
        fontFamily: 'Manrope_500Medium',
        fontStyle: 'normal',
        fontSize: 11,
        opacity: 0.8,
    },
    // ── double hairline (both variants) ──────────────────────────────────
    hairlineOuter: {
        position: 'absolute',
        top: 4,
        left: 4,
        right: 4,
        bottom: 4,
        borderRadius: Radius.md - 3,
        borderWidth: 1,
        borderColor: 'rgba(160,63,40,0.22)',
    },
    hairlineInner: {
        position: 'absolute',
        top: 6,
        left: 6,
        right: 6,
        bottom: 6,
        borderRadius: Radius.md - 5,
        borderWidth: 1,
        borderColor: 'rgba(160,63,40,0.10)',
    },
});
