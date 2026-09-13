/**
 * NotifEmpty — "Nothing yet." empty state with one ringed dot above an italic line.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { Colors, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function NotifEmpty() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    return (
        <View style={styles.container}>
            <View
                style={[
                    styles.ring,
                    { borderColor: palette.dividerSoft },
                ]}
            >
                <View
                    style={[
                        styles.innerHalo,
                        { backgroundColor: palette.terracottaScrim },
                    ]}
                />
                <View
                    style={[
                        styles.dot,
                        { backgroundColor: palette.primaryMuted },
                    ]}
                />
            </View>
            <Text style={[styles.title, { color: palette.text }]}>
                Nothing new yet
            </Text>
            <Text style={[styles.body, { color: palette.textMuted }]}>
                {'Imports and updates will appear here.'}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 40,
        paddingBottom: 80,
        paddingHorizontal: 44,
    },
    ring: {
        width: 64,
        height: 64,
        borderRadius: 32,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 22,
    },
    innerHalo: {
        position: 'absolute',
        width: 24,
        height: 24,
        borderRadius: 12,
    },
    dot: {
        width: 12,
        height: 12,
        borderRadius: 6,
    },
    title: {
        ...Type.headlineMedium,
    },
    body: {
        marginTop: 10,
        ...Type.body,
        textAlign: 'center',
        maxWidth: 240,
    },
});
