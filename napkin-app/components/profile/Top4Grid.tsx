import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Dimensions,
    Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_PADDING = 16;
const CARD_GAP = 8;
// 4 cards in a row: total width - padding - 3 gaps between cards
const CARD_WIDTH = (SCREEN_WIDTH - GRID_PADDING * 2 - CARD_GAP * 3) / 4;
const CARD_HEIGHT = CARD_WIDTH * 1.3; // Taller aspect ratio for small cards

export interface Top4Restaurant {
    id: string;
    position: number;
    restaurant: {
        id: string;
        name: string;
        city?: string | null;
    };
    custom_photo_url?: string | null;
}

interface Top4GridProps {
    restaurants: (Top4Restaurant | null)[];
    isEditing?: boolean;
    onPress?: (restaurant: Top4Restaurant) => void;
    onAdd?: (position: number) => void;
    onRemove?: (position: number) => void;
}

export function Top4Grid({
    restaurants,
    isEditing = false,
    onPress,
    onAdd,
    onRemove,
}: Top4GridProps) {
    const colorScheme = useColorScheme();
    const colors = Colors[colorScheme ?? 'light'];

    // Ensure we always have 4 slots
    const slots = [0, 1, 2, 3].map((position) =>
        restaurants.find((r) => r?.position === position + 1) ?? null
    );

    const renderCard = (item: Top4Restaurant | null, position: number) => {
        const isEmpty = !item;

        if (isEmpty) {
            // Empty slot
            return (
                <TouchableOpacity
                    key={position}
                    style={[
                        styles.card,
                        styles.emptyCard,
                        {
                            borderColor: colors.icon,
                            borderWidth: isEditing ? 2 : 1,
                            borderStyle: isEditing ? 'dashed' : 'solid',
                        },
                    ]}
                    onPress={() => {
                        console.log('Top4Grid: Add pressed at position', position + 1);
                        onAdd?.(position + 1);
                    }}
                    disabled={!isEditing}
                    activeOpacity={isEditing ? 0.7 : 1}
                >
                    {isEditing && (
                        <Ionicons name="add" size={24} color={colors.icon} />
                    )}
                </TouchableOpacity>
            );
        }

        // Filled card
        return (
            <TouchableOpacity
                key={position}
                style={[styles.card, { backgroundColor: colors.background }]}
                onPress={() => {
                    console.log('Top4Grid: Card pressed', item.restaurant.name);
                    onPress?.(item);
                }}
                activeOpacity={0.7}
            >
                {/* Photo or placeholder */}
                <View style={[styles.imageContainer, { backgroundColor: colors.icon + '20' }]}>
                    {item.custom_photo_url ? (
                        <Image
                            source={{ uri: item.custom_photo_url }}
                            style={styles.image}
                            resizeMode="cover"
                        />
                    ) : (
                        <Ionicons name="restaurant" size={28} color={colors.icon} />
                    )}
                </View>

                {/* Restaurant name */}
                <View style={styles.cardContent}>
                    <Text
                        style={[styles.restaurantName, { color: colors.text }]}
                        numberOfLines={2}
                    >
                        {item.restaurant.name}
                    </Text>
                    {item.restaurant.city && (
                        <Text
                            style={[styles.cityName, { color: colors.icon }]}
                            numberOfLines={1}
                        >
                            {item.restaurant.city}
                        </Text>
                    )}
                </View>

                {/* Remove button (edit mode) */}
                {isEditing && (
                    <TouchableOpacity
                        style={[styles.removeButton, { backgroundColor: colors.background }]}
                        onPress={() => {
                            console.log('Top4Grid: Remove pressed at position', position + 1);
                            onRemove?.(position + 1);
                        }}
                    >
                        <Ionicons name="close" size={16} color={colors.text} />
                    </TouchableOpacity>
                )}
            </TouchableOpacity>
        );
    };

    return (
        <View style={styles.container}>
            <View style={styles.grid}>
                {slots.map((item, index) => renderCard(item, index))}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        // No padding - parent ScrollView already provides it
    },
    grid: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: CARD_GAP,
    },
    card: {
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        borderRadius: 8,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    emptyCard: {
        backgroundColor: 'transparent',
        justifyContent: 'center',
        alignItems: 'center',
        shadowOpacity: 0,
        elevation: 0,
    },
    imageContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    image: {
        width: '100%',
        height: '100%',
    },
    cardContent: {
        padding: 6,
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: 'rgba(255,255,255,0.95)',
    },
    restaurantName: {
        fontSize: 11,
        fontWeight: '600',
        lineHeight: 14,
    },
    cityName: {
        fontSize: 10,
        marginTop: 1,
    },
    removeButton: {
        position: 'absolute',
        top: 4,
        right: 4,
        width: 20,
        height: 20,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.2,
        shadowRadius: 2,
        elevation: 2,
    },
});
