import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRouter } from 'expo-router';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    windowDays?: number;
}

/** "You're all caught up." end-of-feed card. No infinite scroll. */
export function FeedTerminus(_: Props = {}) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    return (
        <View style={{ paddingHorizontal: 28, paddingTop: 60, paddingBottom: 32, alignItems: 'center' }}>
            <Text
                style={{
                    fontFamily: 'Newsreader_400Regular_Italic',
                    fontSize: 28,
                    color: palette.text,
                    lineHeight: 34,
                    textAlign: 'center',
                }}
            >
                You&rsquo;re all caught up.
            </Text>
            <Text
                style={{
                    marginTop: 14,
                    fontFamily: 'Newsreader_400Regular_Italic',
                    fontSize: 14,
                    color: palette.textMuted,
                    textAlign: 'center',
                    lineHeight: 21,
                }}
            >
                Come back tomorrow. Or log something — your turn.
            </Text>

            <Pressable
                onPress={() => router.push('/create-entry')}
                style={({ pressed }) => ({
                    marginTop: 26,
                    paddingHorizontal: 20,
                    paddingVertical: 10,
                    borderRadius: 999,
                    backgroundColor: palette.primary,
                    opacity: pressed ? 0.85 : 1,
                })}
            >
                <Text
                    style={{
                        fontFamily: 'Manrope_600SemiBold',
                        fontSize: 12,
                        color: palette.textInverse,
                        letterSpacing: 0.3,
                    }}
                >
                    Log a visit
                </Text>
            </Pressable>
        </View>
    );
}
