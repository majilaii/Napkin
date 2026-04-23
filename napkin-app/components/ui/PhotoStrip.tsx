/**
 * PhotoStrip — 64×64 rounded-8 thumbnail row with trailing `+` placeholder.
 *
 * Canonical Fast Log photo affordance. Visual chrome from `PhotoStrip` in
 * logger-canvas. Behaviour wraps the existing `MultiPhotoRow` interface
 * (onAdd / onRemove / onRetry) — upload logic stays in the caller, we only
 * restyle the tiles.
 *
 * For uploading slots: ActivityIndicator overlay
 * For error slots: Pressable with a refresh glyph
 * For resting slots: image tile + small ✕ dismiss glyph top-right
 * Trailing `+` tile when room remains. Matches canvas 64px tile with radius 8.
 */
import React from 'react';
import {
    View,
    ScrollView,
    Pressable,
    ActivityIndicator,
    StyleSheet,
    Text,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { type PhotoSlot } from '@/components/MultiPhotoRow';

const TILE = 64;
const RADIUS = 8;

interface PhotoStripProps {
    photos: PhotoSlot[];
    maxPhotos: number;
    onAdd: () => void;
    onRemove: (slotId: string) => void;
    onRetry: (slotId: string) => void;
}

export function PhotoStrip({
    photos,
    maxPhotos,
    onAdd,
    onRemove,
    onRetry,
}: PhotoStripProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
        >
            {photos.map((slot) => (
                <View key={slot.id} style={styles.tileWrap}>
                    <Image
                        source={{ uri: slot.localUri }}
                        style={styles.tile}
                        contentFit="cover"
                    />
                    {slot.uploading ? (
                        <View style={styles.overlay}>
                            <ActivityIndicator color="#fff" size="small" />
                        </View>
                    ) : null}
                    {!slot.uploading && slot.error ? (
                        <Pressable
                            onPress={() => onRetry(slot.id)}
                            style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.6)' }]}
                        >
                            <Ionicons name="refresh-outline" size={18} color="#fff" />
                        </Pressable>
                    ) : null}
                    <Pressable
                        onPress={() => onRemove(slot.id)}
                        hitSlop={8}
                        style={[
                            styles.dismissBtn,
                            { backgroundColor: palette.text },
                        ]}
                    >
                        <Ionicons
                            name="close"
                            size={10}
                            color={palette.background}
                        />
                    </Pressable>
                </View>
            ))}

            {photos.length < maxPhotos ? (
                <Pressable
                    onPress={onAdd}
                    style={[
                        styles.addTile,
                        { borderColor: palette.ruleInkSoft },
                    ]}
                >
                    <Text
                        style={{
                            fontSize: 22,
                            fontWeight: '300',
                            color: palette.textMuted,
                            lineHeight: 26,
                        }}
                    >
                        +
                    </Text>
                </Pressable>
            ) : null}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        gap: Spacing.sm,
        paddingRight: Spacing.sm,
    },
    tileWrap: {
        position: 'relative',
        width: TILE,
        height: TILE,
    },
    tile: {
        width: TILE,
        height: TILE,
        borderRadius: RADIUS,
        borderWidth: 1,
        borderColor: 'rgba(0, 0, 0, 0.08)',
    },
    overlay: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: RADIUS,
        backgroundColor: 'rgba(0,0,0,0.35)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    dismissBtn: {
        position: 'absolute',
        top: 4,
        right: 4,
        width: 18,
        height: 18,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
    },
    addTile: {
        width: TILE,
        height: TILE,
        borderRadius: RADIUS,
        borderWidth: 1,
        borderStyle: 'dashed',
        alignItems: 'center',
        justifyContent: 'center',
    },
});
