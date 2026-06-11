/**
 * PhotoMosaic — Apple Journal adaptive photo layout (TICKET-070 Phase B).
 *
 * Uses chooseMosaicLayout() from lib/photoMosaic.ts as the single layout
 * authority. Per-tile upload state (spinner / retry text) preserved from
 * the slot machinery. Add-photo affordance:
 *   0 photos → 72 px dashed tile (the whole component is the add affordance)
 *   ≥1 photos, under cap → small 48 px dashed + tile below the mosaic
 *   at maxPhotos → no add tile
 *
 * Overflow (count 5–6):
 *   2×2 grid; 4th tile shows photo[3] dimmed with +{count-3} scrim.
 *   Tap → viewer opens at index 3.
 *
 * Photos keep native aspect inside tiles via cover-fit. Cropping is layout
 * only, never destructive at pick time.
 */
import React, { useState, useCallback } from 'react';
import {
    View,
    Image,
    Text,
    Pressable,
    StyleSheet,
    ActivityIndicator,
    LayoutChangeEvent,
    Platform,
    useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { chooseMosaicLayout } from '@/lib/photoMosaic';

export interface PhotoMosaicSlot {
    id: string;
    localUri: string;
    publicUrl: string | null;
    uploading: boolean;
    error: string | null;
}

interface Props {
    photos: PhotoMosaicSlot[];
    maxPhotos: number;
    onAdd: () => void;
    onRemove: (id: string) => void;
    onRetry: (id: string) => void;
    onTapPhoto: (index: number) => void;
}

const GAP = 6;
const TILE_RADIUS = 12;
// Horizontal inset of the parent scroll content (24 px each side).
const DEFAULT_H_INSET = 48;

// ── Tile ──────────────────────────────────────────────────────────────────────

interface TileProps {
    slot: PhotoMosaicSlot;
    width: number;
    height: number;
    onPress: () => void;
    onRemove: (id: string) => void;
    onRetry: (id: string) => void;
    /** When set, renders a dimmed scrim with this label (+N text). */
    overflowLabel?: string;
}

function MosaicTile({ slot, width, height, onPress, onRemove, onRetry, overflowLabel }: TileProps) {
    return (
        <Pressable
            onPress={onPress}
            style={{ width, height, borderRadius: TILE_RADIUS, overflow: 'hidden' }}
            accessibilityLabel={overflowLabel ? 'View all photos' : 'View photo'}
            accessibilityRole="button"
        >
            <Image
                source={{ uri: slot.localUri }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
                accessibilityRole="image"
            />

            {/* Overflow scrim + count label */}
            {!!overflowLabel && (
                <View style={[StyleSheet.absoluteFill, tileStyles.scrim, tileStyles.centered]}>
                    <Text style={tileStyles.overflowText}>{overflowLabel}</Text>
                </View>
            )}

            {/* Upload spinner (skip on overflow tile) */}
            {slot.uploading && !overflowLabel && (
                <View style={[StyleSheet.absoluteFill, tileStyles.scrim, tileStyles.centered]}>
                    <ActivityIndicator size="small" color="#fff" />
                </View>
            )}

            {/* Error / retry overlay */}
            {slot.error && !slot.uploading && !overflowLabel && (
                <Pressable
                    style={[StyleSheet.absoluteFill, tileStyles.scrim, tileStyles.centered]}
                    onPress={() => onRetry(slot.id)}
                    accessibilityLabel="Upload failed. Tap to retry."
                >
                    <Text style={tileStyles.retryText}>retry</Text>
                </Pressable>
            )}

            {/* Remove × (hidden while uploading and on overflow tile) */}
            {!slot.uploading && !overflowLabel && (
                <Pressable
                    style={tileStyles.removeBtn}
                    onPress={() => onRemove(slot.id)}
                    hitSlop={6}
                    accessibilityLabel="Remove photo"
                >
                    <View style={tileStyles.removeBg}>
                        <Ionicons name="close" size={11} color="#fff" />
                    </View>
                </Pressable>
            )}
        </Pressable>
    );
}

const tileStyles = StyleSheet.create({
    scrim: {
        // Ink-based, never pure black (brand rule).
        backgroundColor: 'rgba(28,28,25,0.45)',
    },
    centered: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    overflowText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 22,
        color: '#fff',
    },
    retryText: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
        color: '#fff',
        letterSpacing: 0.5,
    },
    removeBtn: {
        position: 'absolute',
        top: 3,
        right: 3,
    },
    removeBg: {
        width: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: 'rgba(28,28,25,0.65)',
        alignItems: 'center',
        justifyContent: 'center',
    },
});

// ── Main ─────────────────────────────────────────────────────────────────────

export function PhotoMosaic({ photos, maxPhotos, onAdd, onRemove, onRetry, onTapPhoto }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const { width: screenWidth } = useWindowDimensions();

    // Start with a sensible estimate; refine on first layout pass.
    const [containerWidth, setContainerWidth] = useState(
        Math.max(screenWidth - DEFAULT_H_INSET, 1),
    );

    const handleLayout = useCallback((e: LayoutChangeEvent) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0) setContainerWidth(w);
    }, []);

    const layout = chooseMosaicLayout(photos.length);
    const canAdd = photos.length < maxPhotos;

    // ── Empty (0 photos) ──────────────────────────────────────────────────────
    if (layout === 'empty') {
        return (
            <Pressable
                onPress={onAdd}
                style={[
                    styles.emptyTile,
                    {
                        backgroundColor: palette.surfaceJournalHi,
                        borderColor: palette.ruleInkSoft,
                    },
                ]}
                accessibilityLabel="add a photo"
                accessibilityRole="button"
            >
                <Ionicons name="add-outline" size={16} color={palette.textMuted} />
                <Text style={[styles.emptyLabel, { color: palette.textMuted }]}>
                    add a photo
                </Text>
            </Pressable>
        );
    }

    // ── Tile size pre-calculations ────────────────────────────────────────────
    const W = containerWidth;

    // single (1): full-width 4:3 hero
    const heroW1 = W;
    const heroH1 = Math.round(W * 3 / 4);

    // two (2): two equal 1:1 columns
    const tileW2 = Math.floor((W - GAP) / 2);
    const tileH2 = tileW2;

    // three (3): 2/3 1:1 hero left + stacked pair right
    const heroW3 = Math.floor((W - GAP) * 2 / 3);
    const heroH3 = heroW3; // 1:1 square
    const rightW3 = W - GAP - heroW3;
    const rightH3 = Math.floor((heroH3 - GAP) / 2);

    // four / overflow: 2×2 grid of equal 1:1 tiles
    const tileW4 = Math.floor((W - GAP) / 2);
    const tileH4 = tileW4;

    // overflow scrim label: +{count-3}
    const overflowCount = photos.length > 4 ? photos.length - 3 : 0;

    return (
        <View onLayout={handleLayout}>
            {/* ── single ── */}
            {layout === 'single' && (
                <MosaicTile
                    slot={photos[0]}
                    width={heroW1}
                    height={heroH1}
                    onPress={() => onTapPhoto(0)}
                    onRemove={onRemove}
                    onRetry={onRetry}
                />
            )}

            {/* ── two ── */}
            {layout === 'two' && (
                <View style={{ flexDirection: 'row', gap: GAP }}>
                    {photos.slice(0, 2).map((slot, i) => (
                        <MosaicTile
                            key={slot.id}
                            slot={slot}
                            width={tileW2}
                            height={tileH2}
                            onPress={() => onTapPhoto(i)}
                            onRemove={onRemove}
                            onRetry={onRetry}
                        />
                    ))}
                </View>
            )}

            {/* ── three ── */}
            {layout === 'three' && (
                <View style={{ flexDirection: 'row', gap: GAP }}>
                    <MosaicTile
                        slot={photos[0]}
                        width={heroW3}
                        height={heroH3}
                        onPress={() => onTapPhoto(0)}
                        onRemove={onRemove}
                        onRetry={onRetry}
                    />
                    <View style={{ gap: GAP }}>
                        {photos.slice(1, 3).map((slot, i) => (
                            <MosaicTile
                                key={slot.id}
                                slot={slot}
                                width={rightW3}
                                height={rightH3}
                                onPress={() => onTapPhoto(i + 1)}
                                onRemove={onRemove}
                                onRetry={onRetry}
                            />
                        ))}
                    </View>
                </View>
            )}

            {/* ── four / overflow ── */}
            {(layout === 'four' || layout === 'overflow') && (
                <View style={{ gap: GAP }}>
                    {/* Row 1 — tiles 0, 1 */}
                    <View style={{ flexDirection: 'row', gap: GAP }}>
                        {photos.slice(0, 2).map((slot, i) => (
                            <MosaicTile
                                key={slot.id}
                                slot={slot}
                                width={tileW4}
                                height={tileH4}
                                onPress={() => onTapPhoto(i)}
                                onRemove={onRemove}
                                onRetry={onRetry}
                            />
                        ))}
                    </View>
                    {/* Row 2 — tiles 2, 3 (3 may carry overflow scrim) */}
                    <View style={{ flexDirection: 'row', gap: GAP }}>
                        {photos[2] && (
                            <MosaicTile
                                slot={photos[2]}
                                width={tileW4}
                                height={tileH4}
                                onPress={() => onTapPhoto(2)}
                                onRemove={onRemove}
                                onRetry={onRetry}
                            />
                        )}
                        {photos[3] && (
                            <MosaicTile
                                slot={photos[3]}
                                width={tileW4}
                                height={tileH4}
                                onPress={() => onTapPhoto(3)}
                                onRemove={onRemove}
                                onRetry={onRetry}
                                overflowLabel={
                                    layout === 'overflow'
                                        ? `+${overflowCount}`
                                        : undefined
                                }
                            />
                        )}
                    </View>
                </View>
            )}

            {/* ── Add-photo tile (≥1 photo, under cap) ── */}
            {canAdd && (
                <Pressable
                    onPress={onAdd}
                    style={[styles.addTileSmall, { borderColor: palette.ruleInkSoft }]}
                    accessibilityLabel="Add photo"
                    accessibilityRole="button"
                >
                    <Ionicons name="add" size={16} color={palette.textMuted} />
                </Pressable>
            )}

            {/* ── Aggregate upload-state murmur ──
                Tiles hidden under the +N overflow scrim carry no visible
                spinner/error; this line keeps every slot's state honest. */}
            {photos.some(p => p.uploading) && (
                <Text style={[styles.stateMurmur, { color: palette.textMuted }]}>
                    — uploading…
                </Text>
            )}
            {!photos.some(p => p.uploading) && photos.some(p => p.error) && (
                <Pressable
                    onPress={() => photos.filter(p => p.error).forEach(p => onRetry(p.id))}
                    accessibilityLabel="A photo failed to upload. Tap to retry."
                >
                    <Text style={[styles.stateMurmur, { color: palette.primary }]}>
                        — a photo failed to upload · tap to retry
                    </Text>
                </Pressable>
            )}
        </View>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    emptyTile: {
        height: 72,
        borderRadius: TILE_RADIUS,
        borderWidth: 1,
        // dashed only on iOS — Android falls back to solid
        borderStyle: Platform.OS === 'ios' ? 'dashed' : 'solid',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    emptyLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
    addTileSmall: {
        width: 48,
        height: 48,
        marginTop: GAP,
        borderRadius: 10,
        borderWidth: 1,
        borderStyle: Platform.OS === 'ios' ? 'dashed' : 'solid',
        alignItems: 'center',
        justifyContent: 'center',
    },
    stateMurmur: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
        lineHeight: 18,
        marginTop: 8,
    },
});
