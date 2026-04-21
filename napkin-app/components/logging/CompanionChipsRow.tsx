/**
 * CompanionChipsRow — presentational chip row for selected companions.
 *
 * Used on the log composer (editable, with × to remove) and in entry-detail
 * edit mode. Max 5 inline chips; overflow collapses to "+N more" text chip.
 *
 * Props:
 *   companions    Selected companions (user_id + display_name)
 *   onRemove      Called with user_id when × tapped. Omit for read-only.
 *   max           Max chips before overflow (default 5)
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export interface CompanionChip {
    user_id: string;
    display_name: string;
}

interface Props {
    companions: CompanionChip[];
    onRemove?: (userId: string) => void;
    max?: number;
}

export function CompanionChipsRow({ companions, onRemove, max = 5 }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    if (companions.length === 0) return null;

    const shown = companions.slice(0, max);
    const overflow = companions.length - max;

    return (
        <View style={styles.row}>
            {shown.map((c) => (
                <View
                    key={c.user_id}
                    style={[styles.chip, { backgroundColor: palette.surfaceContainerHigh }]}
                >
                    <Text
                        style={[styles.chipName, { color: palette.text }]}
                        numberOfLines={1}
                    >
                        {c.display_name.split(' ')[0]}
                    </Text>
                    {onRemove ? (
                        <Pressable
                            onPress={() => onRemove(c.user_id)}
                            hitSlop={6}
                            accessibilityLabel={`Remove ${c.display_name}`}
                        >
                            <Ionicons name="close" size={13} color={palette.textMuted} />
                        </Pressable>
                    ) : null}
                </View>
            ))}
            {overflow > 0 ? (
                <View style={[styles.chip, { backgroundColor: palette.surfaceContainerLow }]}>
                    <Text style={[styles.chipName, { color: palette.textMuted }]}>
                        +{overflow} more
                    </Text>
                </View>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: Spacing.xs,
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: Spacing.sm,
        paddingVertical: Spacing.xs,
        borderRadius: Radius.full,
    },
    chipName: {
        ...Type.caption,
        fontFamily: 'Manrope_500Medium',
        maxWidth: 72,
    },
});
