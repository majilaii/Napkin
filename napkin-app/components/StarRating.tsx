import React from 'react';
import { View, TouchableOpacity, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface StarRatingProps {
  rating: number;
  onRatingChange: (rating: number) => void;
  maxStars?: number;
  size?: number;
  style?: ViewStyle;
}

export function StarRating({
  rating,
  onRatingChange,
  maxStars = 5,
  size = 32,
  style,
}: StarRatingProps) {
  const colorScheme = useColorScheme();
  const activeColor = "black"
  const inactiveColor = 'grey';

  const handlePress = (starIndex: number, isHalf: boolean) => {
    const newRating = starIndex + (isHalf ? 0.5 : 1);
    onRatingChange(newRating);
  };

  return (
    <View style={[styles.container, style]}>
      {Array.from({ length: maxStars }).map((_, index) => {
        const filled = rating >= index + 1;
        const halfFilled = rating >= index + 0.5 && rating < index + 1;

        return (
          <View key={index} style={styles.starContainer}>
            {/* Left half tap target */}
            <TouchableOpacity
              activeOpacity={0.7}
              style={[styles.tapTarget, styles.leftTap]}
              onPress={() => handlePress(index, true)}
            />
            {/* Right half tap target */}
            <TouchableOpacity
              activeOpacity={0.7}
              style={[styles.tapTarget, styles.rightTap]}
              onPress={() => handlePress(index, false)}
            />

            <Ionicons
              name={filled ? 'star' : halfFilled ? 'star-half' : 'star-outline'}
              size={size}
              color={filled || halfFilled ? activeColor : inactiveColor}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center', // Center the stars
  },
  starContainer: {
    position: 'relative',
    marginHorizontal: 4,
  },
  tapTarget: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '50%',
    zIndex: 1,
  },
  leftTap: {
    left: 0,
  },
  rightTap: {
    right: 0,
  },
});
