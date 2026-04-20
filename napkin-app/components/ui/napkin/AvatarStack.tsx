/**
 * AvatarStack — overlapping circular avatars with optional +N overflow chip.
 *
 * Canvas reference: primitives.jsx → AvatarStack; tables-screens.jsx → TTableHeader.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Avatar } from '@/components/feed/Avatar';

interface Props {
    names: string[];
    urls?: (string | null)[];
    /** Max avatars to render before collapsing into +N chip. Default 3 */
    max?: number;
    /** Avatar diameter. Default 22 */
    size?: number;
    /** Overlap in px (amount each avatar overlaps the previous). Default 6 */
    overlap?: number;
    /** Border color — usually matches screen background. Default palette.background */
    borderColor?: string;
}

export function AvatarStack({
    names,
    urls,
    max = 3,
    size = 22,
    overlap = 6,
    borderColor,
}: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const border = borderColor ?? palette.background;

    const visible = names.slice(0, max);
    const extra = Math.max(names.length - max, 0);
    const cells = visible.length + (extra > 0 ? 1 : 0);
    const width = cells > 0 ? size + (cells - 1) * (size - overlap) : 0;

    if (cells === 0) return null;

    return (
        <View style={[styles.container, { height: size, width }]}>
            {visible.map((name, i) => (
                <View
                    key={i}
                    style={[
                        styles.cell,
                        {
                            left: i * (size - overlap),
                            width: size,
                            height: size,
                            borderRadius: size / 2,
                            borderWidth: 2,
                            borderColor: border,
                            zIndex: max - i,
                        },
                    ]}
                >
                    <Avatar
                        name={name}
                        url={urls?.[i] ?? null}
                        size={size}
                        palette={palette}
                    />
                </View>
            ))}
            {extra > 0 && (
                <View
                    style={[
                        styles.cell,
                        styles.overflow,
                        {
                            left: visible.length * (size - overlap),
                            width: size,
                            height: size,
                            borderRadius: size / 2,
                            borderWidth: 2,
                            borderColor: border,
                            backgroundColor: palette.surfaceContainerHigh,
                        },
                    ]}
                >
                    <Text style={[styles.overflowText, { color: palette.textSecondary }]}>
                        +{extra}
                    </Text>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        position: 'relative',
    },
    cell: {
        position: 'absolute',
        top: 0,
        overflow: 'hidden',
    },
    overflow: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    overflowText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
    },
});

export default AvatarStack;
