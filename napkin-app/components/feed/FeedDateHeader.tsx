import React from 'react';
import { View, Text } from 'react-native';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    label: string;
}

/** Serif italic date label with a trailing hairline. Replaces DateSectionHeader. */
export function FeedDateHeader({ label }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View
            style={{
                paddingHorizontal: Spacing.lg - 2,
                paddingTop: 18,
                paddingBottom: 10,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
            }}
        >
            <Text
                style={{
                    fontFamily: 'Newsreader_400Regular_Italic',
                    fontSize: 13,
                    color: palette.textMuted,
                    letterSpacing: 0.3,
                }}
            >
                {label}
            </Text>
            <View style={{ flex: 1, height: 1, backgroundColor: palette.dividerSoft }} />
        </View>
    );
}
