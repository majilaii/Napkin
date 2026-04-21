import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type FeedScope = 'tables' | 'town';

interface Props {
    scope: FeedScope;
    onChange: (next: FeedScope) => void;
}

/**
 * Two-pill toggle: "Your tables" vs "Around town".
 * Tables is primary; town is a v1 placeholder (no editorial layer yet).
 */
export function ScopePills({ scope, onChange }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const opts: { id: FeedScope; label: string }[] = [
        { id: 'tables', label: 'Your table' },
        { id: 'town', label: 'Around town' },
    ];

    return (
        <View
            style={{
                paddingHorizontal: Spacing.lg - 2,
                paddingBottom: 12,
                flexDirection: 'row',
                gap: 6,
            }}
        >
            {opts.map((o) => {
                const active = scope === o.id;
                return (
                    <Pressable
                        key={o.id}
                        onPress={() => onChange(o.id)}
                        style={({ pressed }) => ({
                            paddingVertical: 6,
                            paddingHorizontal: 12,
                            borderRadius: 999,
                            backgroundColor: active ? palette.text : 'transparent',
                            borderWidth: 1,
                            borderColor: active ? palette.text : palette.dividerSoft,
                            opacity: pressed ? 0.85 : 1,
                        })}
                    >
                        <Text
                            style={{
                                fontFamily: active ? 'Manrope_600SemiBold' : 'Manrope_500Medium',
                                fontSize: 11,
                                letterSpacing: 0.3,
                                color: active ? palette.cream : palette.textSecondary,
                            }}
                        >
                            {o.label}
                        </Text>
                    </Pressable>
                );
            })}
        </View>
    );
}
