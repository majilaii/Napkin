import React, { useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    Image,
    ScrollView,
    StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import ImageViewing from 'react-native-image-viewing';

interface BentoPhotoGridProps {
    photos: string[];
    onPhotosChange: (photos: string[]) => void;
    maxPhotos?: number;
    theme: {
        card: string;
        border: string;
        textSecondary: string;
    };
}

export function BentoPhotoGrid({
    photos,
    onPhotosChange,
    maxPhotos = 9,
    theme,
}: BentoPhotoGridProps) {
    const GRID_HEIGHT = 140;
    const GAP = 4;

    // State for fullscreen image viewer
    const [isViewerVisible, setIsViewerVisible] = useState(false);
    const [viewerStartIndex, setViewerStartIndex] = useState(0);

    // Convert photos to format expected by ImageViewing
    const imageUrls = photos.map(uri => ({ uri }));

    const openViewer = (index: number) => {
        setViewerStartIndex(index);
        setIsViewerVisible(true);
    };

    const pickImage = async () => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsMultipleSelection: true,
            quality: 0.8,
            selectionLimit: maxPhotos,
        });

        if (!result.canceled && result.assets) {
            const newPhotos = result.assets.map(a => a.uri);
            onPhotosChange([...photos, ...newPhotos].slice(0, maxPhotos));
        }
    };

    const removePhoto = (index: number) => {
        onPhotosChange(photos.filter((_, i) => i !== index));
    };

    const renderPhotoWithRemove = (uri: string, index: number, style: any) => (
        <View key={index} style={[styles.bentoPhotoWrapper, style]}>
            <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => openViewer(index)}
                style={{ flex: 1 }}
            >
                <Image source={{ uri }} style={styles.bentoPhoto} />
            </TouchableOpacity>
            <TouchableOpacity
                style={styles.removePhotoButton}
                onPress={() => removePhoto(index)}
            >
                <Ionicons name="close-circle" size={22} color="#fff" />
            </TouchableOpacity>
        </View>
    );

    const renderAddButton = () => (
        photos.length < maxPhotos && (
            <TouchableOpacity
                style={[styles.addMoreOverlay, { backgroundColor: theme.card + 'CC', borderColor: theme.border }]}
                onPress={pickImage}
            >
                <Ionicons name="add" size={24} color={theme.textSecondary} />
            </TouchableOpacity>
        )
    );

    const count = photos.length;

    // Empty state
    if (count === 0) {
        return (
            <TouchableOpacity
                style={[styles.addPhotoButton, { backgroundColor: theme.card, borderColor: theme.border }]}
                onPress={pickImage}
            >
                <Ionicons name="camera" size={32} color={theme.textSecondary} />
                <Text style={[styles.addPhotoText, { color: theme.textSecondary }]}>
                    Add Photos
                </Text>
            </TouchableOpacity>
        );
    }

    // 1 photo - full width
    if (count === 1) {
        return (
            <>
                <View style={[styles.bentoContainer, { height: GRID_HEIGHT }]}>
                    {renderPhotoWithRemove(photos[0], 0, { flex: 1 })}
                    {renderAddButton()}
                </View>
                <ImageViewing
                    images={imageUrls}
                    imageIndex={viewerStartIndex}
                    visible={isViewerVisible}
                    onRequestClose={() => setIsViewerVisible(false)}
                />
            </>
        );
    }

    // 2 photos - 50/50 split
    if (count === 2) {
        return (
            <>
                <View style={[styles.bentoContainer, { height: GRID_HEIGHT, gap: GAP }]}>
                    {renderPhotoWithRemove(photos[0], 0, { flex: 1 })}
                    {renderPhotoWithRemove(photos[1], 1, { flex: 1 })}
                    {renderAddButton()}
                </View>
                <ImageViewing
                    images={imageUrls}
                    imageIndex={viewerStartIndex}
                    visible={isViewerVisible}
                    onRequestClose={() => setIsViewerVisible(false)}
                />
            </>
        );
    }

    // 3 photos - Hero left (50%), 2 stacked right
    if (count === 3) {
        return (
            <>
                <View style={[styles.bentoContainer, { height: GRID_HEIGHT, gap: GAP }]}>
                    {renderPhotoWithRemove(photos[0], 0, { flex: 1 })}
                    <View style={{ flex: 1, gap: GAP }}>
                        {renderPhotoWithRemove(photos[1], 1, { flex: 1 })}
                        {renderPhotoWithRemove(photos[2], 2, { flex: 1 })}
                    </View>
                    {renderAddButton()}
                </View>
                <ImageViewing
                    images={imageUrls}
                    imageIndex={viewerStartIndex}
                    visible={isViewerVisible}
                    onRequestClose={() => setIsViewerVisible(false)}
                />
            </>
        );
    }

    // 4 photos - Hero left, 2+1 on right
    if (count === 4) {
        return (
            <>
                <View style={[styles.bentoContainer, { height: GRID_HEIGHT, gap: GAP }]}>
                    {renderPhotoWithRemove(photos[0], 0, { flex: 1 })}
                    <View style={{ flex: 1, gap: GAP }}>
                        <View style={{ flex: 1, flexDirection: 'row', gap: GAP }}>
                            {renderPhotoWithRemove(photos[1], 1, { flex: 1 })}
                            {renderPhotoWithRemove(photos[2], 2, { flex: 1 })}
                        </View>
                        {renderPhotoWithRemove(photos[3], 3, { flex: 1 })}
                    </View>
                    {renderAddButton()}
                </View>
                <ImageViewing
                    images={imageUrls}
                    imageIndex={viewerStartIndex}
                    visible={isViewerVisible}
                    onRequestClose={() => setIsViewerVisible(false)}
                />
            </>
        );
    }

    // 5+ photos - Hero left (50%), 4 in 2x2 grid right
    const extraCount = count - 5;

    return (
        <View>
            <View style={[styles.bentoContainer, { height: GRID_HEIGHT, gap: GAP }]}>
                {renderPhotoWithRemove(photos[0], 0, { flex: 1 })}
                <View style={{ flex: 1, gap: GAP }}>
                    <View style={{ flex: 1, flexDirection: 'row', gap: GAP }}>
                        {renderPhotoWithRemove(photos[1], 1, { flex: 1 })}
                        {renderPhotoWithRemove(photos[2], 2, { flex: 1 })}
                    </View>
                    <View style={{ flex: 1, flexDirection: 'row', gap: GAP }}>
                        {renderPhotoWithRemove(photos[3], 3, { flex: 1 })}
                        <View style={{ flex: 1, position: 'relative' }}>
                            {renderPhotoWithRemove(photos[4], 4, { flex: 1 })}
                            {extraCount > 0 && (
                                <View style={styles.morePhotosOverlay}>
                                    <Text style={styles.morePhotosText}>+{extraCount}</Text>
                                </View>
                            )}
                        </View>
                    </View>
                </View>
            </View>
            {/* Extra row for 6+ photos */}
            {count > 5 && (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ marginTop: GAP }}
                >
                    {photos.slice(5).map((photo, i) => (
                        <View key={i + 5} style={[styles.extraPhotoContainer, { marginRight: GAP }]}>
                            <TouchableOpacity
                                activeOpacity={0.9}
                                onPress={() => openViewer(i + 5)}
                                style={{ flex: 1 }}
                            >
                                <Image source={{ uri: photo }} style={styles.extraPhoto} />
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.removePhotoButtonSmall}
                                onPress={() => removePhoto(i + 5)}
                            >
                                <Ionicons name="close-circle" size={18} color="#fff" />
                            </TouchableOpacity>
                        </View>
                    ))}
                    {photos.length < maxPhotos && (
                        <TouchableOpacity
                            style={[styles.addMorePhotoSmall, { backgroundColor: theme.card, borderColor: theme.border }]}
                            onPress={pickImage}
                        >
                            <Ionicons name="add" size={20} color={theme.textSecondary} />
                        </TouchableOpacity>
                    )}
                </ScrollView>
            )}
            <ImageViewing
                images={imageUrls}
                imageIndex={viewerStartIndex}
                visible={isViewerVisible}
                onRequestClose={() => setIsViewerVisible(false)}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    bentoContainer: {
        flexDirection: 'row',
        borderRadius: 12,
        overflow: 'hidden',
    },
    bentoPhotoWrapper: {
        borderRadius: 8,
        overflow: 'hidden',
        position: 'relative',
    },
    bentoPhoto: {
        width: '100%',
        height: '100%',
        borderRadius: 8,
    },
    addPhotoButton: {
        height: 120,
        borderRadius: 12,
        borderWidth: 2,
        borderStyle: 'dashed',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },
    addPhotoText: {
        fontSize: 14,
        fontWeight: '500',
    },
    addMoreOverlay: {
        position: 'absolute',
        bottom: 8,
        right: 8,
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
    },
    morePhotosOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8,
    },
    morePhotosText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    extraPhotoContainer: {
        width: 60,
        height: 60,
        borderRadius: 8,
        overflow: 'hidden',
        position: 'relative',
    },
    extraPhoto: {
        width: '100%',
        height: '100%',
    },
    removePhotoButton: {
        position: 'absolute',
        top: 4,
        right: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.3,
        shadowRadius: 2,
    },
    removePhotoButtonSmall: {
        position: 'absolute',
        top: 2,
        right: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.3,
        shadowRadius: 2,
    },
    addMorePhotoSmall: {
        width: 60,
        height: 60,
        borderRadius: 8,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        alignItems: 'center',
        justifyContent: 'center',
    },
});
