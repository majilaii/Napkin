/**
 * RecentSearchesList — shown in the empty state when no query is typed.
 * Displays the last 8 searches (AsyncStorage-persisted, TICKET-097).
 * Kicker rendered via TierHeader for continuity with result tiers; when
 * `onClear` is provided the kicker row gains a quiet right-aligned `clear`.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { TierHeader } from './TierHeader';

interface Props {
    queries: readonly string[];
    onSelect: (query: string) => void;
    /** When provided, the kicker row shows a right-aligned `clear` action. */
    onClear?: () => void;
}

export function RecentSearchesList({ queries, onSelect, onClear }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    if (queries.length === 0) return null;

    return (
        <View>
            <TierHeader
                label="Recent"
                action={onClear ? { label: 'clear', onPress: onClear } : undefined}
            />
            {queries.map((q) => (
                <Pressable
                    key={q}
                    style={({ pressed }) => [
                        styles.row,
                        { borderBottomColor: palette.divider },
                        pressed && { backgroundColor: palette.surfaceContainer },
                    ]}
                    onPress={() => onSelect(q)}
                >
                    <Ionicons name="time-outline" size={16} color={palette.textMuted} />
                    <Text
                        style={[Type.body, styles.queryText, { color: palette.text }]}
                        numberOfLines={1}
                    >
                        {q}
                    </Text>
                </Pressable>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm + 2,
        borderBottomWidth: StyleSheet.hairlineWidth,
        gap: Spacing.sm,
    },
    queryText: {
        flex: 1,
    },
});
