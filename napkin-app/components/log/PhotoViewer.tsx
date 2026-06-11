/**
 * PhotoViewer — full-screen modal photo viewer (TICKET-070 Phase B).
 *
 * Anatomy:
 *   Black scrim background
 *   Horizontally paged FlatList (contain-fit full-res images)
 *   "{i} of {n}" muted counter (top-center)
 *   "close" button (top-right, Manrope)
 *   "remove" button (bottom-left, terracotta, journal voice)
 *
 * Opens at initialIndex; swipe left/right between photos.
 * Removing the last photo closes the viewer; removing any other photo
 * adjusts the current index and the caller's photos array via onRemove.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    Modal,
    View,
    Image,
    Text,
    Pressable,
    FlatList,
    StyleSheet,
    useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { PhotoMosaicSlot } from './PhotoMosaic';

interface Props {
    visible: boolean;
    photos: PhotoMosaicSlot[];
    initialIndex: number;
    onClose: () => void;
    /** Called with the slot id of the photo the user wants to remove. */
    onRemove: (id: string) => void;
}

export function PhotoViewer({ visible, photos, initialIndex, onClose, onRemove }: Props) {
    const { width: screenWidth, height: screenHeight } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const flatListRef = useRef<FlatList<PhotoMosaicSlot>>(null);
    const [currentIndex, setCurrentIndex] = useState(initialIndex);

    // ── Sync initial index when viewer opens ──────────────────────────────────
    useEffect(() => {
        if (visible) {
            setCurrentIndex(initialIndex);
        }
    }, [visible, initialIndex]);

    // ── Clamp index when photos array shrinks ─────────────────────────────────
    useEffect(() => {
        if (!visible || photos.length === 0) return;
        if (currentIndex >= photos.length) {
            const clamped = photos.length - 1;
            setCurrentIndex(clamped);
            flatListRef.current?.scrollToIndex({ index: clamped, animated: false });
        }
    }, [photos.length, currentIndex, visible]);

    // ── Track page via scroll end ─────────────────────────────────────────────
    const handleMomentumScrollEnd = useCallback(
        (e: { nativeEvent: { contentOffset: { x: number } } }) => {
            const idx = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
            setCurrentIndex(idx);
        },
        [screenWidth],
    );

    // ── Remove current photo ──────────────────────────────────────────────────
    const handleRemove = useCallback(() => {
        const slot = photos[currentIndex];
        if (!slot) return;
        onRemove(slot.id);
        if (photos.length <= 1) {
            onClose();
        }
        // If remaining photos exist, stay open. The index clamp useEffect above
        // will adjust currentIndex if we removed the last item.
    }, [photos, currentIndex, onRemove, onClose]);

    const current = photos[currentIndex];

    return (
        <Modal
            visible={visible}
            animationType="fade"
            transparent={false}
            onRequestClose={onClose}
            statusBarTranslucent
        >
            <View style={styles.root}>
                {/* ── Photo pager ── */}
                {visible && photos.length > 0 && (
                    <FlatList
                        ref={flatListRef}
                        data={photos}
                        horizontal
                        pagingEnabled
                        showsHorizontalScrollIndicator={false}
                        initialScrollIndex={Math.min(initialIndex, photos.length - 1)}
                        keyExtractor={(item) => item.id}
                        getItemLayout={(_data, index) => ({
                            length: screenWidth,
                            offset: screenWidth * index,
                            index,
                        })}
                        onMomentumScrollEnd={handleMomentumScrollEnd}
                        onScrollToIndexFailed={({ index }) => {
                            // Fallback: scroll to closest valid index
                            flatListRef.current?.scrollToIndex({
                                index: Math.min(index, photos.length - 1),
                                animated: false,
                            });
                        }}
                        renderItem={({ item }) => (
                            <View
                                style={{
                                    width: screenWidth,
                                    height: screenHeight,
                                    backgroundColor: '#000',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}
                            >
                                <Image
                                    source={{ uri: item.localUri }}
                                    style={{ width: screenWidth, height: screenHeight }}
                                    resizeMode="contain"
                                    accessibilityRole="image"
                                />
                            </View>
                        )}
                    />
                )}

                {/* ── Counter — "{i} of {n}" ── */}
                <View
                    style={[styles.counterRow, { top: insets.top + 14 }]}
                    pointerEvents="none"
                >
                    <Text style={styles.counter}>
                        {currentIndex + 1} of {photos.length}
                    </Text>
                </View>

                {/* ── Close button (top-right) ── */}
                <Pressable
                    onPress={onClose}
                    hitSlop={16}
                    accessibilityLabel="close"
                    style={[styles.closeBtn, { top: insets.top + 10, right: 20 }]}
                >
                    <Text style={styles.closeBtnLabel}>close</Text>
                </Pressable>

                {/* ── Remove button (bottom-left) ── */}
                {current && (
                    <Pressable
                        onPress={handleRemove}
                        hitSlop={12}
                        accessibilityLabel="remove photo"
                        style={[
                            styles.removeBtn,
                            { bottom: insets.bottom + 28, left: 24 },
                        ]}
                    >
                        <Text style={[styles.removeBtnLabel, { color: palette.primary }]}>
                            remove
                        </Text>
                    </Pressable>
                )}
            </View>
        </Modal>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: '#000',
    },
    counterRow: {
        position: 'absolute',
        left: 0,
        right: 0,
        alignItems: 'center',
    },
    counter: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
        color: 'rgba(255,255,255,0.55)',
        letterSpacing: 0.3,
    },
    closeBtn: {
        position: 'absolute',
    },
    closeBtnLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        color: 'rgba(255,255,255,0.80)',
        letterSpacing: 0.2,
    },
    removeBtn: {
        position: 'absolute',
    },
    removeBtnLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
        letterSpacing: 0.2,
    },
});
