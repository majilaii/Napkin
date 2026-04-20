/**
 * RecentSearchesList — shown in the empty state when no query is typed.
 * Displays last 5 searches from the session-only LRU cache.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    queries: readonly string[];
    onSelect: (query: string) => void;
}

export function RecentSearchesList({ queries, onSelect }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    if (queries.length === 0) return null;

    return (
        <View style={styles.container}>
            <Text style={[Type.label, styles.heading, { color: palette.textMuted }]}>
                Recent
            </Text>
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
    container: {
        marginTop: Spacing.sm,
    },
    heading: {
        paddingHorizontal: Spacing.md,
        paddingBottom: Spacing.xs,
    },
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
