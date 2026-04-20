/**
 * PhotoCollage — Apple-Journal-style dynamic photo layout.
 *
 * Renders 1 / 2 / 3 / 4+ photos with the layout recipes from `PhotoCollage`
 * in logger-canvas:
 *  - 1  → single 3:2 tile
 *  - 2  → two side-by-side 3:2 tiles (equal)
 *  - 3  → 2:1 split: one large left, two stacked right, 3:2 overall
 *  - 4+ → 2×2 square grid; "+N" overlay on the last tile when >4
 *
 * Purely presentational — takes photo URIs plus callbacks. Radii / gaps match
 * the canvas (radius 8, 6px gap). Used by the Journal composer.
 */
import React from 'react';
import {
    View,
    StyleSheet,
    Pressable,
    Text,
    ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { type PhotoSlot } from '@/components/MultiPhotoRow';

const RADIUS = 8;
const GAP = 6;

interface PhotoCollageProps {
    photos: PhotoSlot[];
    maxPhotos: number;
    onAdd: () => void;
    onRemove: (slotId: string) => void;
    onRetry: (slotId: string) => void;
}

function SlotTile({
    slot,
    onRemove,
    onRetry,
    plusLabel,
    style,
}: {
    slot: PhotoSlot;
    onRemove: (id: string) => void;
    onRetry: (id: string) => void;
    plusLabel?: string;
    style?: any;
}) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View style={[tileStyles.wrap, style]}>
            <Image
                source={{ uri: slot.localUri }}
                style={tileStyles.image}
                contentFit="cover"
            />
            {slot.uploading ? (
                <View style={tileStyles.overlay}>
                    <ActivityIndicator color="#fff" size="small" />
                </View>
            ) : null}
            {!slot.uploading && slot.error ? (
                <Pressable
                    onPress={() => onRetry(slot.id)}
                    style={[tileStyles.overlay, { backgroundColor: 'rgba(0,0,0,0.6)' }]}
                >
                    <Ionicons name="refresh-outline" size={20} color="#fff" />
                </Pressable>
            ) : null}
            <Pressable
                onPress={() => onRemove(slot.id)}
                hitSlop={8}
                style={[tileStyles.dismissBtn, { backgroundColor: palette.text }]}
            >
                <Ionicons name="close" size={11} color={palette.background} />
            </Pressable>
            {plusLabel ? (
                <View style={tileStyles.plusOverlay} pointerEvents="none">
                    <Text style={tileStyles.plusText}>{plusLabel}</Text>
                </View>
            ) : null}
        </View>
    );
}

function AddTile({
    onAdd,
    aspect,
}: {
    onAdd: () => void;
    aspect?: number;
}) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    return (
        <Pressable
            onPress={onAdd}
            style={[
                tileStyles.addWrap,
                aspect ? { aspectRatio: aspect } : { flex: 1 },
                {
                    backgroundColor: palette.surfaceContainerLow,
                    borderColor: palette.ruleInkSoft,
                },
            ]}
        >
            <Ionicons name="camera-outline" size={22} color={palette.textMuted} />
            <Text
                style={{
                    fontFamily: 'Manrope_500Medium',
                    fontSize: 11,
                    letterSpacing: 0.4,
                    textTransform: 'uppercase',
                    color: palette.textMuted,
                    marginTop: Spacing.xs,
                }}
            >
                Add photo
            </Text>
        </Pressable>
    );
}

export function PhotoCollage({
    photos,
    maxPhotos,
    onAdd,
    onRemove,
    onRetry,
}: PhotoCollageProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const n = photos.length;

    if (n === 0) {
        // Empty state — show an add tile at collage scale (3/2 aspect)
        return (
            <View style={{ aspectRatio: 3 / 2 }}>
                <AddTile onAdd={onAdd} />
            </View>
        );
    }

    if (n === 1) {
        return (
            <View style={{ aspectRatio: 3 / 2 }}>
                <SlotTile slot={photos[0]} onRemove={onRemove} onRetry={onRetry} />
            </View>
        );
    }

    if (n === 2) {
        return (
            <View
                style={{
                    aspectRatio: 3 / 2,
                    flexDirection: 'row',
                    gap: GAP,
                }}
            >
                <View style={{ flex: 1 }}>
                    <SlotTile slot={photos[0]} onRemove={onRemove} onRetry={onRetry} />
                </View>
                <View style={{ flex: 1 }}>
                    <SlotTile slot={photos[1]} onRemove={onRemove} onRetry={onRetry} />
                </View>
            </View>
        );
    }

    if (n === 3) {
        return (
            <View
                style={{
                    aspectRatio: 3 / 2,
                    flexDirection: 'row',
                    gap: GAP,
                }}
            >
                <View style={{ flex: 2 }}>
                    <SlotTile slot={photos[0]} onRemove={onRemove} onRetry={onRetry} />
                </View>
                <View style={{ flex: 1, flexDirection: 'column', gap: GAP }}>
                    <View style={{ flex: 1 }}>
                        <SlotTile slot={photos[1]} onRemove={onRemove} onRetry={onRetry} />
                    </View>
                    <View style={{ flex: 1 }}>
                        <SlotTile slot={photos[2]} onRemove={onRemove} onRetry={onRetry} />
                    </View>
                </View>
            </View>
        );
    }

    // 4+ — 2×2 square grid
    const visible = photos.slice(0, 4);
    const extra = n - 4;

    return (
        <View>
            <View style={{ aspectRatio: 1 }}>
                <View style={{ flex: 1, flexDirection: 'row', gap: GAP }}>
                    <View style={{ flex: 1 }}>
                        <SlotTile slot={visible[0]} onRemove={onRemove} onRetry={onRetry} />
                    </View>
                    <View style={{ flex: 1 }}>
                        <SlotTile slot={visible[1]} onRemove={onRemove} onRetry={onRetry} />
                    </View>
                </View>
                <View style={{ height: GAP }} />
                <View style={{ flex: 1, flexDirection: 'row', gap: GAP }}>
                    <View style={{ flex: 1 }}>
                        <SlotTile slot={visible[2]} onRemove={onRemove} onRetry={onRetry} />
                    </View>
                    <View style={{ flex: 1 }}>
                        <SlotTile
                            slot={visible[3]}
                            onRemove={onRemove}
                            onRetry={onRetry}
                            plusLabel={extra > 0 ? `+${extra}` : undefined}
                        />
                    </View>
                </View>
            </View>
            {photos.length < maxPhotos ? (
                <View style={styles.addRow}>
                    <Pressable
                        onPress={onAdd}
                        style={({ pressed }) => [
                            styles.addLink,
                            { opacity: pressed ? 0.6 : 1 },
                        ]}
                    >
                        <Text
                            style={{
                                fontFamily: 'Manrope_500Medium',
                                fontSize: 12,
                                color: palette.primary,
                            }}
                        >
                            + Add photo
                        </Text>
                    </Pressable>
                </View>
            ) : null}
        </View>
    );
}

const tileStyles = StyleSheet.create({
    wrap: {
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        borderRadius: RADIUS,
    },
    image: {
        width: '100%',
        height: '100%',
    },
    overlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.35)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    dismissBtn: {
        position: 'absolute',
        top: 6,
        right: 6,
        width: 20,
        height: 20,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    plusOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(28,28,25,0.5)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    plusText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 24,
        fontWeight: '500',
        color: '#fff',
    },
    addWrap: {
        flex: 1,
        borderRadius: RADIUS,
        borderWidth: 1,
        borderStyle: 'dashed',
        alignItems: 'center',
        justifyContent: 'center',
    },
});

const styles = StyleSheet.create({
    addRow: {
        marginTop: Spacing.sm,
        alignItems: 'flex-start',
    },
    addLink: {
        paddingVertical: Spacing.xs,
    },
});
