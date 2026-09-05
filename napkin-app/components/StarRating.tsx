/**
 * StarRating — half-star rating component (display + input).
 * Renders 5 stars using Ionicons. When editable, tap left/right half
 * of each star for X.5 / X.0 precision.
 */
import React from 'react';
import { View, Pressable, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface StarRatingProps {
    value: number;
    size?: number;
    editable?: boolean;
    onChange?: (value: number) => void;
    color?: string;
    showValue?: boolean;
}

export function StarRating({
    value,
    size = 20,
    editable = false,
    onChange,
    color,
    showValue = false,
}: StarRatingProps) {
    const scheme = useColorScheme() ?? 'light';
    const starColor = color ?? Colors[scheme].star;
    const emptyColor = Colors[scheme].surfaceContainerHigh;

    const handlePress = (starIndex: number, isLeftHalf: boolean) => {
        if (!editable || !onChange) return;
        const newValue = isLeftHalf ? starIndex + 0.5 : starIndex + 1;
        onChange(newValue);
    };

    const stars = [];
    for (let i = 0; i < 5; i++) {
        const filled = value - i;
        let iconName: 'star' | 'star-half' | 'star-outline';
        let iconColor: string;

        if (filled >= 1) {
            iconName = 'star';
            iconColor = starColor;
        } else if (filled >= 0.5) {
            iconName = 'star-half';
            iconColor = starColor;
        } else {
            iconName = 'star-outline';
            iconColor = emptyColor;
        }

        if (editable) {
            stars.push(
                <View key={i} style={{ width: size, height: size, position: 'relative' }}>
                    <Ionicons name={iconName} size={size} color={iconColor} />
                    {/* Left half tap target */}
                    <Pressable
                        onPress={() => handlePress(i, true)}
                        accessibilityRole="button"
                        accessibilityLabel={`Rate ${i + 0.5} out of 5 stars`}
                        accessibilityState={{ selected: value === i + 0.5 }}
                        style={[StyleSheet.absoluteFill, { width: size / 2 }]}
                        hitSlop={{ top: 8, bottom: 8, left: 4, right: 0 }}
                    />
                    {/* Right half tap target */}
                    <Pressable
                        onPress={() => handlePress(i, false)}
                        accessibilityRole="button"
                        accessibilityLabel={`Rate ${i + 1} out of 5 stars`}
                        accessibilityState={{ selected: value === i + 1 }}
                        style={[StyleSheet.absoluteFill, { left: size / 2, width: size / 2 }]}
                        hitSlop={{ top: 8, bottom: 8, left: 0, right: 4 }}
                    />
                </View>
            );
        } else {
            stars.push(
                <Ionicons key={i} name={iconName} size={size} color={iconColor} />
            );
        }
    }

    return (
        <View style={styles.container}>
            <View style={[styles.starsRow, { gap: size * 0.1 }]}>
                {stars}
            </View>
            {showValue && (
                <Text style={[Type.rating, { color: starColor, marginLeft: Spacing.sm }]}>
                    {value.toFixed(1)}
                </Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    starsRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
});
