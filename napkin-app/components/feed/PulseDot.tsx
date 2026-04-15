/**
 * PulseDot — animated live indicator dot.
 * Extracted from tables.tsx for reuse in TableNightCard and ActiveRoundsShelf.
 */

import React, { useEffect, useRef } from 'react';
import { View, Animated, Easing } from 'react-native';

interface PulseDotProps {
    size?: number;
    color?: string;
}

export function PulseDot({ size = 8, color = '#fff' }: PulseDotProps) {
    const pulse = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        const animation = Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, {
                    toValue: 0.3,
                    duration: 900,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(pulse, {
                    toValue: 1,
                    duration: 900,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ]),
        );
        animation.start();
        return () => animation.stop();
    }, [pulse]);

    return (
        <View
            style={{
                width: size + 8,
                height: size + 8,
                alignItems: 'center',
                justifyContent: 'center',
            }}
        >
            <Animated.View
                style={{
                    position: 'absolute',
                    width: size + 8,
                    height: size + 8,
                    borderRadius: (size + 8) / 2,
                    backgroundColor: color,
                    opacity: pulse,
                    transform: [
                        {
                            scale: pulse.interpolate({
                                inputRange: [0.3, 1],
                                outputRange: [1.4, 0.8],
                            }),
                        },
                    ],
                }}
            />
            <View
                style={{
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    backgroundColor: color,
                }}
            />
        </View>
    );
}
