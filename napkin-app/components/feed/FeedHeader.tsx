import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    subtitle?: string;
    location?: string;
    onFilterPress?: () => void;
}

/**
 * Feed masthead — large italic "Feed" + day-and-place subhead, right-side filter.
 * Matches feed-canvas.jsx FeedHeader.
 */
export function FeedHeader({ subtitle, location, onFilterPress }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const today = new Date();
    const dateLabel = today.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
    });
    const defaultSubtitle = location ? `${dateLabel} · ${location}` : dateLabel;

    return (
        <View
            style={{
                paddingHorizontal: Spacing.lg - 2,
                paddingTop: Spacing.sm,
                paddingBottom: 14,
                flexDirection: 'row',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
            }}
        >
            <View>
                <Text
                    style={{
                        fontFamily: 'Newsreader_400Regular_Italic',
                        fontSize: 30,
                        color: palette.text,
                        lineHeight: 30,
                    }}
                >
                    Feed
                </Text>
                <Text
                    style={{
                        fontFamily: 'Manrope_400Regular',
                        fontSize: 11,
                        color: palette.textMuted,
                        marginTop: 4,
                        letterSpacing: 0.3,
                    }}
                >
                    {subtitle ?? defaultSubtitle}
                </Text>
            </View>

            <Pressable
                onPress={onFilterPress}
                hitSlop={12}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingBottom: 3 }}
            >
                <Ionicons name="menu-outline" size={14} color={palette.textMuted} />
                <Text
                    style={{
                        fontFamily: 'Manrope_400Regular',
                        fontSize: 12,
                        color: palette.textMuted,
                    }}
                >
                    Filter
                </Text>
            </Pressable>
        </View>
    );
}
