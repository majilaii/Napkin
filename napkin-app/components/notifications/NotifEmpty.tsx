/**
 * NotifEmpty — "Nothing yet." empty state with one ringed dot above an italic line.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { Colors } from '@/constants/theme';
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
                Nothing yet.
            </Text>
            <Text style={[styles.body, { color: palette.textMuted }]}>
                {'When your friends log a meal\nor pin a place — it lands here.'}
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
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 22,
        fontStyle: 'italic',
        fontWeight: '500',
        lineHeight: 28,
    },
    body: {
        marginTop: 10,
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 12,
        fontStyle: 'italic',
        lineHeight: 19,
        textAlign: 'center',
        maxWidth: 240,
    },
});
