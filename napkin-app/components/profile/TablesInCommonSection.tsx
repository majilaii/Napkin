/**
 * TablesInCommonSection — preview cards for shared Tables (or own Tables for self).
 *
 * Section header: "Tables in common" for non-self, "Your Tables" for self.
 * Self empty state: a single card-style empty state linking to /tables.
 * Non-self empty state: section hidden entirely.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { TablePreviewCard } from './TablePreviewCard';
import { SectionHeader } from './SectionHeader';
import type { TablePreview } from '@/hooks/users/useUserProfile';

interface Props {
    previews: TablePreview[];
    targetUserId: string;
    isSelf: boolean;
}

export function TablesInCommonSection({ previews, targetUserId, isSelf }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    // Non-self with no shared tables: section is entirely hidden
    // (relationship routing already prevents this path in practice)
    if (!isSelf && previews.length === 0) return null;

    const sectionTitle = isSelf ? 'Your Tables' : 'Tables in common';

    return (
        <View>
            <SectionHeader title={sectionTitle} />

            {previews.length === 0 && isSelf ? (
                // Self empty state
                <Pressable
                    onPress={() => router.push('/tables')}
                    style={[styles.emptyCard, { backgroundColor: palette.surfaceContainerLow }]}
                    accessibilityRole="button"
                    accessibilityLabel="Go to Tables"
                >
                    <Text style={[Type.body, { color: palette.textSecondary, textAlign: 'center' }]}>
                        Join or create a Table to get started
                    </Text>
                    <Text style={[Type.bodySmall, { color: palette.primary, marginTop: Spacing.xs }]}>
                        Go to Tables →
                    </Text>
                </Pressable>
            ) : (
                <View style={styles.cards}>
                    {previews.map((preview) => (
                        <TablePreviewCard
                            key={preview.table_id}
                            preview={preview}
                            targetUserId={targetUserId}
                            isSelf={isSelf}
                        />
                    ))}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    cards: {
        marginHorizontal: Spacing.lg,
        gap: Spacing.sm,
    },
    emptyCard: {
        marginHorizontal: Spacing.lg,
        borderRadius: Radius.lg,
        padding: Spacing.lg,
        alignItems: 'center',
    },
});
