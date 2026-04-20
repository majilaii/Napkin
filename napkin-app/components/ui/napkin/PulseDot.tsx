/**
 * PulseDot — a small terracotta dot with a pulsing ring.
 *
 * Used on "live" banners (active Round / gathering). The ring scales out and
 * fades, repeating every 1.6s.
 *
 * Canvas reference: primitives.jsx → PulseDot.
 */
import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withRepeat,
    withTiming,
    Easing,
} from 'react-native-reanimated';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    size?: number;
    color?: string;
}

export function PulseDot({ size = 12, color }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const dotColor = color ?? palette.primary;

    const pulse = useSharedValue(0);

    useEffect(() => {
        pulse.value = withRepeat(
            withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }),
            -1,
            false,
        );
    }, [pulse]);

    const ringStyle = useAnimatedStyle(() => ({
        transform: [{ scale: 1 + pulse.value * 0.8 }],
        opacity: 0.75 * (1 - pulse.value),
    }));

    return (
        <View style={[styles.container, { width: size, height: size }]}>
            <Animated.View
                style={[
                    styles.ring,
                    ringStyle,
                    {
                        width: size,
                        height: size,
                        borderRadius: size / 2,
                        backgroundColor: dotColor,
                    },
                ]}
            />
            <View
                style={[
                    styles.dot,
                    {
                        width: size,
                        height: size,
                        borderRadius: size / 2,
                        backgroundColor: dotColor,
                    },
                ]}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        position: 'relative',
    },
    ring: {
        position: 'absolute',
        top: 0,
        left: 0,
    },
    dot: {
        position: 'absolute',
        top: 0,
        left: 0,
    },
});

export default PulseDot;
