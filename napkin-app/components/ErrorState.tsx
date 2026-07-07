/**
 * ErrorState — quiet murmur for a failed primary query (TICKET-121). Shown
 * only when there is no cached data to render; otherwise screens keep showing
 * what they have.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    onRetry: () => void;
    message?: string;
}

export function ErrorState({ onRetry, message = "couldn't load" }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View style={styles.root}>
            <Text style={[styles.murmur, { color: palette.textMuted }]}>{message}</Text>
            <Pressable
                onPress={onRetry}
                hitSlop={12}
                accessibilityRole="button"
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
                <Text style={[styles.retry, { color: palette.primary }]}>try again</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        alignItems: 'center',
        gap: Spacing.sm,
        paddingVertical: Spacing.xl,
        paddingHorizontal: Spacing.lg,
    },
    murmur: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 15,
        lineHeight: 22,
    },
    retry: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
    },
});
