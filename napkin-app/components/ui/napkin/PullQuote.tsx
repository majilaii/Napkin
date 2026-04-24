/**
 * PullQuote — serif-italic body text with em-dash prefix + 2px terracotta left rule.
 * Used on memory-card feed entries and entry-detail for the user's own writing.
 *
 * Heirloom Journal grammar: em-dash before the text, left rule in terracotta.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Size = 'card' | 'detail';

interface Props {
    text: string;
    numberOfLines?: number;
    size?: Size;
}

export function PullQuote({ text, numberOfLines, size = 'card' }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const fontSize = size === 'detail' ? 20 : 17;
    const lineHeight = size === 'detail' ? 32 : 26;

    return (
        <View style={[styles.container, { borderLeftColor: palette.primary }]}>
            <Text
                style={[styles.text, { color: palette.text, fontSize, lineHeight }]}
                numberOfLines={numberOfLines}
            >
                {'— '}{text}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        borderLeftWidth: 2,
        paddingLeft: 14,
        paddingVertical: 4,
    },
    text: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontWeight: '400',
    },
});
