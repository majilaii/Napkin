import React from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StarRating } from '@/components/StarRating';

interface RatingSectionProps {
    rating: number;
    onRatingChange: (rating: number) => void;
    isLiked: boolean;
    onLikedChange: (liked: boolean) => void;
    theme: {
        border: string;
        textSecondary: string;
        primary: string;
    };
}

export function RatingSection({
    rating,
    onRatingChange,
    isLiked,
    onLikedChange,
    theme,
}: RatingSectionProps) {
    return (
        <View style={[styles.ratingSection, { borderBottomColor: theme.border }]}>
            <Text style={[styles.ratingRowLabel, { color: theme.textSecondary }]}>
                Rating
            </Text>
            <View style={styles.ratingRow}>
                <View style={styles.ratingStars}>
                    <StarRating
                        rating={rating}
                        onRatingChange={onRatingChange}
                        size={28}
                    />
                </View>
                <TouchableOpacity
                    style={[
                        styles.likeBadge,
                        isLiked && styles.likeBadgeActive,
                        { borderColor: isLiked ? theme.primary : theme.border }
                    ]}
                    onPress={() => onLikedChange(!isLiked)}
                >
                    <Ionicons
                        name={isLiked ? "heart" : "heart-outline"}
                        size={20}
                        color={isLiked ? '#ff3b5c' : theme.textSecondary}
                    />
                    <Text style={[
                        styles.likeBadgeText,
                        { color: isLiked ? '#ff3b5c' : theme.textSecondary }
                    ]}>
                        Loved it
                    </Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    ratingSection: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    ratingRowLabel: {
        fontSize: 13,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 10,
    },
    ratingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    ratingStars: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    likeBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 20,
        borderWidth: 1.5,
    },
    likeBadgeActive: {
        backgroundColor: 'rgba(255, 59, 92, 0.1)',
    },
    likeBadgeText: {
        fontSize: 13,
        fontWeight: '600',
    },
});
