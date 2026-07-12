/**
 * ProfileIndex — scannable table-of-contents block.
 * TICKET-025
 *
 * Upright functional titles and readable metadata make each destination clear
 * at a glance. Disabled rows retain contrast but omit navigation affordances.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SectionHeader } from './SectionHeader';

export interface IndexSection {
    title: string;
    count: number | null;
    hint: string;
    /** Route to push when tapped. */
    route?: string;
    /** If true, the row is non-interactive but remains legible. */
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
            <SectionHeader title="Explore" />
            <View style={[styles.listContainer, { backgroundColor: palette.surfaceJournalLow }]}>
                {sections.map((section, index) => {
                    const isLast = index === sections.length - 1;
                    const content = (
                        <View
                            style={[
                                styles.row,
                                { borderBottomColor: isLast ? 'transparent' : palette.dividerSoft },
                            ]}
                        >
                            <View style={styles.rowContent}>
                                <View style={styles.titleRow}>
                                    <Text
                                        style={[
                                            styles.rowTitle,
                                            { color: section.disabled ? palette.textMuted : palette.text },
                                        ]}
                                    >
                                        {section.title}
                                    </Text>
                                    {section.count != null ? (
                                        <Text style={[styles.count, { color: palette.textMuted }]}>
                                            {section.count}
                                        </Text>
                                    ) : null}
                                </View>
                                <Text
                                    style={[
                                        styles.hint,
                                        {
                                            color: section.disabled
                                                ? palette.textMuted
                                                : palette.textSecondary,
                                        },
                                    ]}
                                    numberOfLines={2}
                                >
                                    {section.hint}
                                </Text>
                            </View>
                            {!section.disabled ? (
                                <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
                            ) : null}
                        </View>
                    );

                    if (section.disabled || !section.route) {
                        return <View key={section.title}>{content}</View>;
                    }

                    return (
                        <Pressable
                            key={section.title}
                            onPress={() => router.push(section.route as never)}
                            accessibilityRole="button"
                            accessibilityLabel={`${section.title}${section.count != null ? `, ${section.count}` : ''}. ${section.hint}`}
                            style={({ pressed }) => (pressed ? styles.pressed : undefined)}
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
    listContainer: {
        marginHorizontal: Spacing.lg,
        paddingHorizontal: Spacing.md,
        borderRadius: 16,
        overflow: 'hidden',
    },
    row: {
        minHeight: 64,
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
        gap: Spacing.sm,
    },
    rowContent: {
        flex: 1,
        minWidth: 0,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        flexWrap: 'wrap',
        gap: Spacing.sm,
    },
    rowTitle: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 17,
        lineHeight: 22,
    },
    count: {
        ...Type.metadata,
        fontVariant: ['tabular-nums'],
    },
    hint: {
        ...Type.metadata,
        marginTop: 3,
    },
    pressed: {
        opacity: 0.7,
    },
});
