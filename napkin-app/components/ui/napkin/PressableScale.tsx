/**
 * PressableScale — tactile wrapper that scales to 0.96 on press with a
 * spring-interruptible animation. Optionally fires a light haptic on press-in.
 *
 * Use for any primary tap target (CTAs, floating buttons, avatars, tiles).
 */
import React from 'react';
import { Pressable, PressableProps, ViewStyle } from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

type HapticKind = 'light' | 'medium' | 'selection' | 'none';

interface Props extends Omit<PressableProps, 'style'> {
    children: React.ReactNode;
    style?: ViewStyle | ViewStyle[];
    scaleTo?: number;
    haptic?: HapticKind;
    disabled?: boolean;
}

const SPRING = { damping: 18, stiffness: 320, mass: 0.6 };

export function PressableScale({
    children,
    style,
    scaleTo = 0.96,
    haptic = 'none',
    disabled,
    onPressIn,
    onPressOut,
    ...rest
}: Props) {
    const scale = useSharedValue(1);

    const animStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));

    const fireHaptic = () => {
        if (haptic === 'none' || disabled) return;
        if (haptic === 'light') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        else if (haptic === 'medium') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        else if (haptic === 'selection') Haptics.selectionAsync();
    };

    return (
        <Pressable
            {...rest}
            disabled={disabled}
            onPressIn={(e) => {
                scale.value = withSpring(scaleTo, SPRING);
                fireHaptic();
                onPressIn?.(e);
            }}
            onPressOut={(e) => {
                scale.value = withSpring(1, SPRING);
                onPressOut?.(e);
            }}
        >
            <Animated.View style={[style, animStyle]}>{children}</Animated.View>
        </Pressable>
    );
}

export default PressableScale;
