/**
 * NotifBell — bell glyph entry point for the You tab header.
 *
 * Per `notifications-canvas.jsx` post-its: "Bell lives on the You tab header;
 * a small dot on the YOU nav item is the at-a-distance tell."
 *
 * Renders a 20px outlined bell. When `unread` is true, a 9px terracotta dot
 * sits in the top-right corner with a 2px ring of the surface color so it
 * reads cleanly against the warm paper. No count bubble — counts create the
 * anxiety we don't want.
 */
import React from 'react';
import { Pressable, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    unread?: boolean;
    onPress?: () => void;
    /** Color of the ring around the dot — should match the surface behind the bell. */
    ringColor?: string;
}

export function NotifBell({ unread = false, onPress, ringColor }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <Pressable
            onPress={onPress}
            hitSlop={10}
            style={({ pressed }) => [styles.wrap, { opacity: pressed ? 0.6 : 1 }]}
        >
            <Ionicons name="notifications-outline" size={22} color={palette.text} />
            {unread ? (
                <View
                    style={[
                        styles.dot,
                        {
                            backgroundColor: palette.primary,
                            borderColor: ringColor ?? palette.background,
                        },
                    ]}
                />
            ) : null}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    wrap: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
    },
    dot: {
        position: 'absolute',
        top: 4,
        right: 4,
        width: 9,
        height: 9,
        borderRadius: 4.5,
        borderWidth: 2,
    },
});
