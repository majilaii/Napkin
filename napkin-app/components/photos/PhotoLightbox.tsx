/**
 * PhotoLightbox — full-screen, READ-ONLY photo pager.
 *
 * Black scrim, horizontally paged contain-fit images, top-right close, dot
 * indicators. No edit/remove affordances — this is for *reading* a pooled set
 * (supper "the night", review "from the night"), never for managing your own
 * upload (that's PhotoViewer, which carries a remove button). Opens at
 * initialIndex; swipe between photos.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
    Modal,
    View,
    Image,
    Text,
    ScrollView,
    Pressable,
    StyleSheet,
    useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    visible: boolean;
    photos: string[];
    initialIndex: number;
    onClose: () => void;
    caption?: string;
}

export function PhotoLightbox({ visible, photos, initialIndex, onClose, caption }: Props) {
    const { width } = useWindowDimensions();
    const insets = useSafeAreaInsets();
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const [index, setIndex] = useState(initialIndex);
    const scrollRef = useRef<ScrollView>(null);

    useEffect(() => {
        if (visible) setIndex(initialIndex);
    }, [visible, initialIndex]);

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
            <View style={styles.backdrop}>
                <Pressable
                    onPress={onClose}
                    hitSlop={10}
                    style={[styles.close, { top: insets.top + 8 }]}
                    accessibilityRole="button"
                    accessibilityLabel="close photo"
                >
                    <Ionicons name="close" size={24} color="#fff" />
                </Pressable>

                <ScrollView
                    ref={scrollRef}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    contentOffset={{ x: initialIndex * width, y: 0 }}
                    onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
                    style={{ flex: 1 }}
                >
                    {photos.map((url, i) => (
                        <Image
                            key={`${url}-${i}`}
                            source={{ uri: url }}
                            style={{ width, flex: 1 }}
                            resizeMode="contain"
                            accessibilityRole="image"
                        />
                    ))}
                </ScrollView>

                {caption ? (
                    <View style={[styles.caption, { bottom: insets.bottom + 24 }]} pointerEvents="none">
                        <Text style={[Type.caption, { color: palette.textOnImage }]}>{index + 1} / {photos.length}</Text>
                        <Text style={[Type.caption, { color: palette.textOnImageMuted, textAlign: 'center' }]}>{caption}</Text>
                    </View>
                ) : photos.length > 1 ? (
                    <View style={[styles.dots, { bottom: insets.bottom + 24 }]}>
                        {photos.map((_, i) => (
                            <View
                                key={i}
                                style={[styles.dot, { backgroundColor: i === index ? palette.tertiary : 'rgba(255,255,255,0.4)' }]}
                            />
                        ))}
                    </View>
                ) : null}
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: '#000' },
    close: {
        position: 'absolute',
        right: 18,
        zIndex: 10,
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    dots: {
        position: 'absolute',
        left: 0,
        right: 0,
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 6,
    },
    caption: { position: 'absolute', left: 24, right: 24, alignItems: 'center', gap: 8 },
    dot: { width: 6, height: 6, borderRadius: 3 },
});
