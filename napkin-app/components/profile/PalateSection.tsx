/**
 * PalateSection — stats strip + public lists + recently logged grid.
 *
 * Empty-state rules:
 *   self with zero logs: stats strip with dashes + single nudge line;
 *                        Public Lists and Recently Logged sections hidden.
 *   stranger with zero logs: stats strip with zeros; no empty-state label;
 *                            Public Lists and Recently Logged hidden.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { PalateStatsStrip } from './PalateStatsStrip';
import { PublicListsSection } from './PublicListsSection';
import { RecentlyLoggedGrid } from './RecentlyLoggedGrid';
import type { UserStats, ProfileListSummary, RestaurantTile } from '@/hooks/users/useUserProfile';

interface Props {
    stats: UserStats;
    publicLists: ProfileListSummary[];
    recentlyLogged: RestaurantTile[];
    isSelf: boolean;
}

export function PalateSection({ stats, publicLists, recentlyLogged, isSelf }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const hasContent = stats.total_logs > 0;

    return (
        <View style={styles.container}>
            {/* Stats strip always renders */}
            <PalateStatsStrip stats={stats} />

            {/* Self empty-state nudge when no logs yet */}
            {isSelf && !hasContent && (
                <Text
                    style={[
                        Type.headlineItalic,
                        styles.nudge,
                        { color: palette.textMuted, fontFamily: 'Newsreader_400Regular_Italic' },
                    ]}
                >
                    Log your first restaurant to see your palate take shape
                </Text>
            )}

            {/* Public Lists and Recently Logged only when there's content */}
            {hasContent && (
                <>
                    <PublicListsSection lists={publicLists} />
                    <RecentlyLoggedGrid restaurants={recentlyLogged} />
                </>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: Spacing.lg,
        marginTop: Spacing.xl,
    },
    nudge: {
        marginTop: Spacing.lg,
        textAlign: 'center',
        fontSize: 15,
        lineHeight: 22,
    },
});
