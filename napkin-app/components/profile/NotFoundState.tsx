/**
 * NotFoundState — "This profile isn't available." full-screen state.
 *
 * Matches the private-list not-found pattern from TICKET-018.
 * No retry, no "report". Intentionally terse — doesn't confirm whether
 * the user exists at all.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function NotFoundState() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View style={styles.container}>
            <Text style={[Type.headlineMedium, { color: palette.text, textAlign: 'center' }]}>
                {"This profile isn\u2019t available."}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: Spacing.xl,
    },
});
