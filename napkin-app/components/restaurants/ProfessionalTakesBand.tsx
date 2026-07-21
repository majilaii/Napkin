/**
 * ProfessionalTakesBand — "Professional takes" section on the Visits tab.
 *
 * Renders a labeled band with hairline-flanked header and one CriticRow per
 * critic review. Self-hides entirely when the filtered critic list is empty
 * (no header, no spacer) per the spec's "honest absence = silence" doctrine.
 *
 * Client-side filtering (defense against server regressions):
 *  - Drop rows missing publication
 *  - Drop rows with excerpt present but source_url missing (licensing defense)
 *
 * Client-side ordering (per architecture decision: rank lives in client constant):
 *  - Primary: PUBLICATION_RANK (NYT → Infatuation → Eater → unknowns)
 *  - Secondary within a publication: published_date descending
 *  - Tertiary for unknown publications: alphabetical by display name
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { ProfessionalCritic } from '@/hooks/restaurants/useRestaurantPage';
import { CriticRow } from './CriticRow';
import {
    getPublicationDisplayName,
    getPublicationRank,
} from './criticPublications';

interface Props {
    critics: ProfessionalCritic[];
}

export function ProfessionalTakesBand({ critics }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const filtered = useMemo(() => {
        return critics
            // Drop rows missing publication
            .filter((r) => !!r.publication)
            // Drop rows with excerpt but no source_url (licensing defense)
            .filter((r) => !(r.excerpt && !r.source_url))
            // Sort by publication rank, then published_date desc, then alpha display name
            .slice()
            .sort((a, b) => {
                const rankA = getPublicationRank(a.publication);
                const rankB = getPublicationRank(b.publication);
                if (rankA !== rankB) return rankA - rankB;

                // Same rank: sort by published_date desc
                const dateA = a.published_date ?? '';
                const dateB = b.published_date ?? '';
                if (dateA !== dateB) return dateB.localeCompare(dateA);

                // Tiebreak: alphabetical by display name
                const nameA = getPublicationDisplayName(a.publication);
                const nameB = getPublicationDisplayName(b.publication);
                return nameA.localeCompare(nameB);
            });
    }, [critics]);

    // Self-hide when nothing to show — per AC: no header, no spacer
    if (filtered.length === 0) return null;

    return (
        <View style={styles.band}>
            {/* Hairline rule above band (separator between VoicesStream and this section) */}
            <View style={[styles.topSeparator, { backgroundColor: palette.ruleInkSoft }]} />

            {/* Section header: hairline · "PROFESSIONAL TAKES" · hairline */}
            <View style={styles.headerRow}>
                <View style={[styles.headerRule, { backgroundColor: palette.ruleInkSoft }]} />
                <Text
                    style={[styles.headerLabel, { color: palette.textMuted }]}
                    accessibilityRole="header"
                >
                    PROFESSIONAL TAKES
                </Text>
                <View style={[styles.headerRule, { backgroundColor: palette.ruleInkSoft }]} />
            </View>

            {/* Critic rows */}
            {filtered.map((critic) => (
                <CriticRow key={`critic-${critic.id}`} critic={critic} />
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    band: {
        paddingHorizontal: 22,
        paddingBottom: Spacing.xl,
        marginTop: Spacing.xl,
    },
    topSeparator: {
        height: 1,
        marginBottom: Spacing.xl,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        marginBottom: Spacing.md,
    },
    headerRule: {
        flex: 1,
        height: 1,
    },
    headerLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        lineHeight: 15,
        letterSpacing: 1.5,
        textTransform: 'uppercase',
    },
});
