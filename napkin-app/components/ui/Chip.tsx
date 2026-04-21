/**
 * Chip — pill / block variants from the Heirloom kit primitives.
 *
 * Two variants:
 *  - 'pill' (default): rounded-full capsule, 12px Manrope 500, no transform
 *  - 'block': radius-sm, 10px Manrope 500 uppercase tracked (0.25)
 *
 * When `active`, the chip inverts to terracotta fill / white text. Otherwise
 * it ghosts with a 1px ruleInkSoft border on a transparent fill. Press state
 * is softened via opacity only (no shrink, no colour flip).
 */
import React from 'react';
import { Pressable, Text, ViewStyle, StyleProp, View } from 'react-native';

import { Colors, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface ChipProps {
    children: React.ReactNode;
    variant?: 'pill' | 'block';
    active?: boolean;
    onPress?: () => void;
    disabled?: boolean;
    style?: StyleProp<ViewStyle>;
}

export function Chip({
    children,
    variant = 'pill',
    active = false,
    onPress,
    disabled = false,
    style,
}: ChipProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const isPill = variant === 'pill';
    const padding = isPill
        ? { paddingHorizontal: 12, paddingVertical: 6 }
        : { paddingHorizontal: 9, paddingVertical: 3 };

    const textStyle = isPill
        ? {
              fontFamily: 'Manrope_500Medium',
              fontSize: 12,
              letterSpacing: 0.2,
          }
        : {
              fontFamily: 'Manrope_500Medium',
              fontSize: 10,
              letterSpacing: 0.25,
              textTransform: 'uppercase' as const,
          };

    const containerStyle: ViewStyle = {
        alignSelf: 'flex-start',
        borderRadius: isPill ? Radius.full : Radius.sm,
        borderWidth: active ? 0 : 1,
        borderColor: active ? 'transparent' : palette.ruleInkSoft,
        backgroundColor: active ? palette.primary : 'transparent',
        ...padding,
    };

    const textColor = active ? palette.textInverse : palette.textSecondary;

    const body = (
        <Text style={[textStyle, { color: textColor }]} numberOfLines={1}>
            {children}
        </Text>
    );

    if (onPress) {
        return (
            <Pressable
                onPress={onPress}
                disabled={disabled}
                style={({ pressed }) => [
                    containerStyle,
                    { opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
                    style,
                ]}
            >
                {body}
            </Pressable>
        );
    }
    return <View style={[containerStyle, style]}>{body}</View>;
}

/**
 * Utility: non-interactive filled chip for cases like "Clara, Thomas, + tag"
 * friend rows where taps arent wired yet (visual placeholder).
 */
export function GhostChip({
    children,
    style,
}: {
    children: React.ReactNode;
    style?: StyleProp<ViewStyle>;
}) {
    return (
        <Chip variant="pill" active={false} style={style}>
            {children}
        </Chip>
    );
}

