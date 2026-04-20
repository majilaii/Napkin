import React from 'react';
import { View, Text } from 'react-native';

interface Props {
    value: number;
    size?: number;
    color?: string;
}

/**
 * Simple inline stars — 5 glyphs, each full/half/empty via opacity.
 * Half-step precision. Used in FriendLogCard and FastLogRow.
 */
export function InlineStars({ value, size = 12, color = '#b8842a' }: Props) {
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {Array.from({ length: 5 }).map((_, i) => {
                const full = i < Math.floor(value);
                const half = !full && value - i >= 0.5;
                const opacity = full ? 1 : half ? 0.55 : 0.22;
                return (
                    <Text
                        key={i}
                        style={{
                            fontSize: size,
                            color,
                            opacity,
                            marginRight: 1,
                            lineHeight: size * 1.05,
                        }}
                    >
                        ★
                    </Text>
                );
            })}
        </View>
    );
}
