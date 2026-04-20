/**
 * VoiceCard — a single voice on the Our Table tab.
 *
 * Layout (per V1 Dossier canvas):
 *   [30px avatar]  [Name]  [stars]  [flex]  [short date]
 *                  "Serif italic quote spanning one or two lines"
 *
 * Pressable — taps navigate to the underlying visit (solo entry or round).
 * Quote falls back to a neutral italic dash when the visit has no note.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { InlineStars } from '@/components/feed/InlineStars';

type Palette = typeof Colors.light;

interface Voice {
    avatarUrl?: string | null;
    displayName: string;
    rating: number | null;
    date: string;
    note?: string | null;
}

interface Props {
    voice: Voice;
    onPress?: () => void;
}

function shortDate(iso: string): string {
    try {
        const d = new Date(iso);
        return d.toLocaleDateString(undefined, { month: 'short' });
    } catch {
        return '';
    }
}

export function VoiceCard({ voice, onPress }: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;

    const firstName = voice.displayName.split(' ')[0] ?? voice.displayName;
    const quote = voice.note?.trim()
        ? voice.note.trim()
        : null;

    return (
        <Pressable
            onPress={onPress}
            disabled={!onPress}
            style={({ pressed }) => [styles.row, { opacity: pressed && onPress ? 0.7 : 1 }]}
        >
            <View
                style={[
                    styles.avatarWrap,
                    { backgroundColor: palette.surfaceContainerHigh },
                ]}
            >
                {voice.avatarUrl ? (
                    <ExpoImage
                        source={{ uri: voice.avatarUrl }}
                        style={styles.avatar}
                        contentFit="cover"
                    />
                ) : (
                    <Ionicons name="person" size={14} color={palette.textMuted} />
                )}
            </View>

            <View style={styles.body}>
                <View style={styles.topLine}>
                    <Text
                        style={[styles.name, { color: palette.text }]}
                        numberOfLines={1}
                    >
                        {firstName}
                    </Text>
                    {voice.rating != null ? (
                        <InlineStars value={voice.rating} size={10} color={palette.star} />
                    ) : null}
                    <View style={{ flex: 1 }} />
                    <Text
                        style={[styles.date, { color: palette.textMuted }]}
                        numberOfLines={1}
                    >
                        {shortDate(voice.date)}
                    </Text>
                </View>

                <Text
                    style={[
                        styles.quote,
                        { color: quote ? palette.text : palette.textMuted },
                    ]}
                    numberOfLines={3}
                >
                    {quote ?? 'No note on this visit.'}
                </Text>
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        gap: 12,
        paddingVertical: 4,
    },
    avatarWrap: {
        width: 30,
        height: 30,
        borderRadius: 15,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    avatar: {
        width: 30,
        height: 30,
    },
    body: {
        flex: 1,
        minWidth: 0,
    },
    topLine: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 4,
    },
    name: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
    },
    date: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 10,
    },
    quote: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 14,
        lineHeight: 21,
    },
});

export type { Voice };
