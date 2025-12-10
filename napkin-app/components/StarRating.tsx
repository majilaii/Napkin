import React, { useRef, useCallback } from 'react';
import { View, StyleSheet, ViewStyle, GestureResponderEvent } from 'react-native';
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
  const activeColor = "black";
  const inactiveColor = 'grey';

  // Store container layout info
  const containerLayout = useRef({ x: 0, width: 0 });

  // Calculate rating from touch position
  const getRatingFromTouch = useCallback((pageX: number): number => {
    const { x, width } = containerLayout.current;
    if (width === 0) return rating;

    const relativeX = pageX - x;
    const starWidth = width / maxStars;

    if (relativeX <= 0) return 0; // Allow 0 stars
    if (relativeX >= width) return maxStars;

    // Calculate which star and whether it's left or right half
    const starIndex = Math.floor(relativeX / starWidth);
    const positionInStar = (relativeX % starWidth) / starWidth;

    // Left half = 0.5, Right half = 1.0
    const halfValue = positionInStar < 0.5 ? 0.5 : 1;
    return Math.min(starIndex + halfValue, maxStars);
  }, [maxStars, rating]);

  // Handle touch start (tap or drag start)
  const handleTouchStart = useCallback((event: GestureResponderEvent) => {
    const newRating = getRatingFromTouch(event.nativeEvent.pageX);
    onRatingChange(newRating);
  }, [getRatingFromTouch, onRatingChange]);

  // Handle drag movement
  const handleTouchMove = useCallback((event: GestureResponderEvent) => {
    const newRating = getRatingFromTouch(event.nativeEvent.pageX);
    onRatingChange(newRating);
  }, [getRatingFromTouch, onRatingChange]);

  // Measure container on layout
  const handleLayout = useCallback(() => {
    containerRef.current?.measureInWindow((x, _y, width) => {
      containerLayout.current = { x, width };
    });
  }, []);

  const containerRef = useRef<View>(null);

  return (
    <View
      ref={containerRef}
      style={[styles.container, style]}
      onLayout={handleLayout}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={handleTouchStart}
      onResponderMove={handleTouchMove}
    >
      {Array.from({ length: maxStars }).map((_, index) => {
        const filled = rating >= index + 1;
        const halfFilled = rating >= index + 0.5 && rating < index + 1;

        return (
          <View key={index} style={styles.starContainer}>
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
    justifyContent: 'center',
  },
  starContainer: {
    marginHorizontal: 4,
  },
});
