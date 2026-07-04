import React from 'react';
import { Text, StyleSheet, View, Pressable } from 'react-native';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface TierHeaderProps {
    label: string;
    /**
     * TICKET-097 — optional right-aligned quiet text action in the kicker row
     * (e.g. the recents `clear`). Manrope, muted; no chrome.
     */
    action?: { label: string; onPress: () => void };
}

export function TierHeader({ label, action }: TierHeaderProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View style={styles.container}>
            <Text style={[Type.labelSmall, { color: palette.textMuted }]}>{label}</Text>
            {action ? (
                <Pressable
                    onPress={action.onPress}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={action.label}
                >
                    {({ pressed }) => (
                        <Text
                            style={[
                                Type.caption,
                                { color: palette.textMuted, opacity: pressed ? 0.6 : 1 },
                            ]}
                        >
                            {action.label}
                        </Text>
                    )}
                </Pressable>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.md,
        paddingTop: Spacing.md,
        paddingBottom: Spacing.xs,
    },
});
