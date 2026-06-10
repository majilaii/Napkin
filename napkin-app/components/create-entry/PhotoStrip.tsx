/**
 * PhotoStrip — always-visible horizontal photo strip.
 *
 * A dashed 64×64 "+ add photo" tile is rendered even when photos is empty,
 * keeping the affordance above the fold and eliminating the "invisible photos"
 * bug from the old `{photos.length > 0 && <PhotoCollage>}` pattern.
 *
 * Filled tiles show: thumbnail image, uploading spinner overlay, error/retry
 * overlay, remove (×) button. Upload state is purely reflected via props —
 * all slot-machine state lives in the parent screen.
 *
 * Props are interface-compatible with the existing PhotoCollage usage:
 *   { photos, maxPhotos, onAdd, onRemove, onRetry }
 */
import React from 'react';
import {
    View,
    Image,
    Text,
    Pressable,
    StyleSheet,
    ActivityIndicator,
    ScrollView,
    Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export interface PhotoStripSlot {
    id: string;
    localUri: string;
    publicUrl: string | null;
    uploading: boolean;
    error: string | null;
}

interface Props {
    photos: PhotoStripSlot[];
    maxPhotos: number;
    onAdd: () => void;
    onRemove: (id: string) => void;
    onRetry: (id: string) => void;
}

const TILE_SIZE = 64;
const TILE_RADIUS = Radius.sm + 4; // 8px

export function PhotoStrip({ photos, maxPhotos, onAdd, onRemove, onRetry }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const canAdd = photos.length < maxPhotos;

    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.container}
            style={styles.scroll}
        >
            {photos.map(slot => (
                <View key={slot.id} style={styles.tile}>
                    {/* Thumbnail */}
                    <Image
                        source={{ uri: slot.localUri }}
                        style={styles.tileImage}
                        accessibilityRole="image"
                        accessibilityLabel="Photo"
                    />

                    {/* Uploading overlay */}
                    {slot.uploading ? (
                        <View style={styles.tileOverlay}>
                            <ActivityIndicator size="small" color="#fff" />
                        </View>
                    ) : null}

                    {/* Error overlay — tap to retry */}
                    {slot.error && !slot.uploading ? (
                        <Pressable
                            style={styles.tileOverlay}
                            onPress={() => onRetry(slot.id)}
                            accessibilityLabel="Upload failed. Tap to retry."
                        >
                            <Ionicons name="refresh-outline" size={20} color="#fff" />
                        </Pressable>
                    ) : null}

                    {/* Remove button — hidden while uploading */}
                    {!slot.uploading ? (
                        <Pressable
                            style={styles.removeButton}
                            onPress={() => onRemove(slot.id)}
                            hitSlop={6}
                            accessibilityLabel="Remove photo"
                        >
                            <View style={styles.removeBg}>
                                <Ionicons name="close" size={11} color="#fff" />
                            </View>
                        </Pressable>
                    ) : null}
                </View>
            ))}

            {/* Dashed "+ add photo" tile — always rendered when under max */}
            {canAdd ? (
                <Pressable
                    style={({ pressed }) => [
                        styles.addTile,
                        {
                            borderColor: palette.ruleInkSoft,
                            backgroundColor: pressed
                                ? palette.surfaceContainerLow
                                : 'transparent',
                        },
                    ]}
                    onPress={onAdd}
                    accessibilityLabel="Add photo"
                    accessibilityRole="button"
                >
                    <Ionicons name="add" size={22} color={palette.textMuted} />
                    <Text style={[styles.addLabel, { color: palette.textMuted }]}>
                        photo
                    </Text>
                </Pressable>
            ) : null}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    scroll: {
        flexGrow: 0,
        marginHorizontal: -(Spacing.lg + 2), // bleed to screen edges
    },
    container: {
        flexDirection: 'row',
        gap: Spacing.sm,
        paddingVertical: Spacing.xs,
        paddingHorizontal: Spacing.lg + 2,
    },
    tile: {
        width: TILE_SIZE,
        height: TILE_SIZE,
        borderRadius: TILE_RADIUS,
        overflow: 'hidden',
        position: 'relative',
        flexShrink: 0,
    },
    tileImage: {
        width: TILE_SIZE,
        height: TILE_SIZE,
    },
    tileOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.45)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    removeButton: {
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
    addTile: {
        width: TILE_SIZE,
        height: TILE_SIZE,
        borderRadius: TILE_RADIUS,
        borderWidth: 1,
        // borderStyle: 'dashed' is iOS-only — Android falls back to solid
        borderStyle: Platform.OS === 'ios' ? 'dashed' : 'solid',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        flexShrink: 0,
    },
    addLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 9,
        letterSpacing: 0.5,
        textTransform: 'uppercase',
    },
});
