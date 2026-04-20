/**
 * ProfileIndex — editorial table-of-contents block.
 * TICKET-025
 *
 * Rows: Diary (tappable), Reviews (disabled placeholder), Lists (tappable),
 *       Wishlist (tappable), Likes (disabled placeholder).
 *
 * Disabled rows: muted text, no chevron, no onPress, opacity 0.5.
 * Active rows: serif italic title + count + hint + chevron.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export interface IndexSection {
    title: string;
    count: number | null;
    hint: string;
    /** If true, hint renders in italic serif */
    emphasis?: boolean;
    /** Route to push when tapped */
    route?: string;
    /** If true, row is visually de-emphasized and non-interactive */
    disabled?: boolean;
}

interface Props {
    sections: IndexSection[];
}

export function ProfileIndex({ sections }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    return (
        <View>
            {/* — INDEX label */}
            <View style={styles.indexLabel}>
                <Text style={[Type.labelSmall, { color: palette.textMuted }]}>{'— INDEX'}</Text>
            </View>

            <View style={[styles.listContainer, { borderTopColor: palette.dividerSoft, borderBottomColor: palette.dividerSoft }]}>
                {sections.map((s, i) => {
                    const isLast = i === sections.length - 1;
                    const content = (
                        <View
                            style={[
                                styles.row,
                                {
                                    borderTopColor: palette.dividerSoft,
                                    borderBottomColor: isLast ? palette.dividerSoft : 'transparent',
                                    opacity: s.disabled ? 0.45 : 1,
                                },
                            ]}
                        >
                            <View style={styles.rowContent}>
                                {/* Title + count */}
                                <View style={styles.titleRow}>
                                    <Text
                                        style={[
                                            styles.rowTitle,
                                            { color: s.disabled ? palette.textMuted : palette.text },
                                        ]}
                                    >
                                        {s.title}
                                    </Text>
                                    {s.count != null && (
                                        <Text style={[Type.caption, { color: palette.textMuted, fontSize: 11 }]}>
                                            {s.count}
                                        </Text>
                                    )}
                                </View>
                                {/* Hint */}
                                <Text
                                    style={[
                                        s.emphasis
                                            ? styles.hintEmphasis
                                            : styles.hint,
                                        {
                                            color: s.disabled ? palette.textMuted : palette.textSecondary,
                                            fontFamily: s.emphasis ? 'Newsreader_400Regular_Italic' : 'Manrope_400Regular',
                                        },
                                    ]}
                                    numberOfLines={1}
                                >
                                    {s.hint}
                                </Text>
                            </View>
                            {/* Chevron — only for active rows */}
                            {!s.disabled && (
                                <Text style={[styles.chevron, { color: palette.textMuted }]}>{'›'}</Text>
                            )}
                        </View>
                    );

                    if (s.disabled || !s.route) {
                        return <View key={s.title}>{content}</View>;
                    }

                    return (
                        <Pressable
                            key={s.title}
                            onPress={() => router.push(s.route as any)}
                            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                        >
                            {content}
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    indexLabel: {
        paddingHorizontal: Spacing.lg,
        paddingTop: 28,
        paddingBottom: 10,
    },
    listContainer: {
        paddingHorizontal: Spacing.lg,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: Spacing.md,
        borderTopWidth: 1,
        borderBottomWidth: 0,
        gap: Spacing.sm,
    },
    rowContent: {
        flex: 1,
        minWidth: 0,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: Spacing.sm,
    },
    rowTitle: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 18,
        fontStyle: 'italic',
        fontWeight: '500',
        lineHeight: 22,
    },
    hint: {
        fontSize: 11,
        lineHeight: 16,
        marginTop: 3,
    },
    hintEmphasis: {
        fontSize: 11,
        lineHeight: 16,
        marginTop: 3,
        fontStyle: 'italic',
    },
    chevron: {
        fontSize: 18,
        flexShrink: 0,
    },
});
