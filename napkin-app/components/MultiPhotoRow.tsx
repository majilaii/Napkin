/**
 * MultiPhotoRow — reusable horizontal thumbnail strip for photo upload flows.
 *
 * Purely presentational: renders photo slots with upload state overlays,
 * hero label, error retry, dismiss button, and an add slot.
 * Upload logic stays in the calling screen.
 */
import React from 'react';
import {
    View,
    Text,
    ScrollView,
    Pressable,
    ActivityIndicator,
    StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Radius, Type } from '@/constants/theme';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PhotoSlot {
    id: string;
    localUri: string;
    publicUrl: string | null;
    uploading: boolean;
    /** Can be a string message (create-entry) or boolean (table-night) — treat truthy as error */
    error: string | boolean | null;
    uploadGen: number;
}

interface MultiPhotoRowProps {
    photos: PhotoSlot[];
    maxPhotos: number;
    onAdd: () => void;
    onRemove: (slotId: string) => void;
    onRetry: (slotId: string) => void;
    palette: {
        text: string;
        background: string;
        textMuted: string;
        surfaceContainerLow: string;
        outlineVariant: string;
    };
}

// ── Component ──────────────────────────────────────────────────────────────

export function MultiPhotoRow({
    photos,
    maxPhotos,
    onAdd,
    onRemove,
    onRetry,
    palette,
}: MultiPhotoRowProps) {
    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.photoRow}
        >
            {photos.map((slot, index) => (
                <View key={slot.id} style={styles.photoThumbContainer}>
                    <Image
                        source={{ uri: slot.localUri }}
                        style={styles.photoThumb}
                        contentFit="cover"
                    />

                    {/* Hero label on first photo */}
                    {index === 0 && (
                        <View style={[styles.heroLabel, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
                            <Text style={{ color: Colors.light.textInverse, fontSize: 8, fontFamily: 'Manrope_600SemiBold' }}>
                                HERO
                            </Text>
                        </View>
                    )}

                    {/* Uploading overlay */}
                    {slot.uploading && (
                        <View style={styles.thumbOverlay}>
                            <ActivityIndicator color="#fff" size="small" />
                        </View>
                    )}

                    {/* Error overlay with retry */}
                    {slot.error && !slot.uploading && (
                        <Pressable
                            onPress={() => onRetry(slot.id)}
                            style={[styles.thumbOverlay, { backgroundColor: 'rgba(0,0,0,0.6)' }]}
                        >
                            <Ionicons name="refresh-outline" size={18} color="#fff" />
                        </Pressable>
                    )}

                    {/* Dismiss button */}
                    <Pressable
                        onPress={() => onRemove(slot.id)}
                        style={[styles.photoRemoveButton, { backgroundColor: palette.text }]}
                        hitSlop={8}
                    >
                        <Ionicons name="close" size={10} color={palette.background} />
                    </Pressable>
                </View>
            ))}

            {/* "+" add slot — hidden when at max */}
            {photos.length < maxPhotos && (
                <Pressable
                    onPress={onAdd}
                    style={[
                        styles.photoAddSlot,
                        { backgroundColor: palette.surfaceContainerLow, borderColor: palette.outlineVariant },
                    ]}
                >
                    <Ionicons name="camera-outline" size={22} color={palette.textMuted} />
                    <Text style={[Type.caption, { color: palette.textMuted, marginTop: 2, fontSize: 10 }]}>
                        Add
                    </Text>
                </Pressable>
            )}
        </ScrollView>
    );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    photoRow: {
        flexDirection: 'row',
        gap: Spacing.sm,
        paddingRight: Spacing.sm,
    },
    photoThumbContainer: {
        position: 'relative',
        width: 80,
        height: 80,
    },
    photoThumb: {
        width: 80,
        height: 80,
        borderRadius: Radius.md,
        borderWidth: 1,
        borderColor: 'rgba(0, 0, 0, 0.08)',
    },
    heroLabel: {
        position: 'absolute',
        bottom: 4,
        left: 4,
        paddingHorizontal: 4,
        paddingVertical: 2,
        borderRadius: Radius.sm,
    },
    thumbOverlay: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: Radius.md,
        backgroundColor: 'rgba(0,0,0,0.35)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    photoRemoveButton: {
        position: 'absolute',
        top: 4,
        right: 4,
        width: 20,
        height: 20,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    photoAddSlot: {
        width: 80,
        height: 80,
        borderRadius: Radius.md,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        alignItems: 'center',
        justifyContent: 'center',
    },
});
