import React from 'react';
import { Text, StyleSheet, View, Pressable } from 'react-native';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface TierHeaderProps {
    label: string;
    /** Places takeover uses terracotta section kickers on the paper page. */
    accent?: boolean;
    /** The first takeover section starts closer to the tab rule. */
    accentFirst?: boolean;
    /**
     * TICKET-097 — optional right-aligned quiet text action in the kicker row
     * (e.g. the recents `clear`). Manrope, muted; no chrome.
     */
    action?: { label: string; onPress: () => void };
}

export function TierHeader({ label, accent = false, accentFirst = false, action }: TierHeaderProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View style={[
            styles.container,
            accent && styles.accentContainer,
            accentFirst && styles.accentFirstContainer,
        ]}>
            <Text
                style={[
                    accent ? Type.sectionKicker : Type.labelSmall,
                    { color: accent ? palette.primary : palette.textMuted },
                ]}
            >
                {label}
            </Text>
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
    accentContainer: {
        paddingHorizontal: Spacing.pageGutter,
        paddingTop: Spacing.md + Spacing.xs / 2,
    },
    accentFirstContainer: {
        paddingTop: Spacing.sm + Spacing.xs,
    },
});
