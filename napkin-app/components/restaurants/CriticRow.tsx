/**
 * CriticRow — a single professional critic review row for the ProfessionalTakesBand.
 *
 * Layout (left → right):
 *   Left column:  publication name (Newsreader Medium 14) / kind sublabel (Manrope 9 uppercase)
 *   Right column: value rendering (kind-specific)
 *
 * Below both columns:
 *   Italic excerpt (Newsreader 13 Italic, up to 3 lines)
 *   "— Author, YYYY" attribution caption
 *
 * Tap → openBrowserAsync(source_url) when source_url is a valid https URL.
 * Non-interactive when source_url is null/empty.
 *
 * Accessibility: accessibilityRole="link" with descriptive accessibilityLabel.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { ProfessionalCritic } from '@/hooks/restaurants/useRestaurantPage';
import { getPublicationDisplayName } from './criticPublications';

type Palette = typeof Colors.light;

// ── Kind labels ───────────────────────────────────────────────────────────────

const KIND_LABEL: Record<string, string> = {
    stars: 'STARS',
    score: 'SCORE',
    essential: 'ESSENTIAL',
    feature: 'FEATURE',
};

// ── Value column renderer ─────────────────────────────────────────────────────

function renderValue(
    kind: ProfessionalCritic['kind'],
    row: ProfessionalCritic,
    palette: Palette,
): React.ReactElement {
    if (kind === 'stars') {
        return (
            <Text
                style={[styles.valueStars, { color: palette.star }]}
                accessibilityLabel={`${row.score ?? ''} stars`}
            >
                {row.score ?? ''}
            </Text>
        );
    }

    if (kind === 'score') {
        return (
            <View style={styles.scoreRow}>
                <Text style={[styles.valueScore, { color: palette.text }]}>
                    {row.score ?? ''}
                </Text>
                {row.score_out_of ? (
                    <Text style={[styles.valueDenom, { color: palette.textMuted }]}>
                        {`/${row.score_out_of}`}
                    </Text>
                ) : null}
            </View>
        );
    }

    if (kind === 'essential') {
        const year = row.published_date
            ? new Date(row.published_date).getFullYear().toString()
            : null;
        return (
            <View style={[styles.essentialBadge, { backgroundColor: palette.amberChipHi }]}>
                <Text style={[styles.essentialText, { color: palette.amberInk }]}>ESSENTIAL</Text>
                {year ? (
                    <Text style={[styles.essentialYear, { color: palette.amberInk }]}>
                        {year}
                    </Text>
                ) : null}
            </View>
        );
    }

    // feature — em-dash, no numeric value
    return (
        <Text style={[styles.valueDash, { color: palette.textMuted }]}>—</Text>
    );
}

// ── Attribution caption ───────────────────────────────────────────────────────

function buildAttribution(
    author: string | null,
    publishedDate: string | null,
    publicationDisplayName: string,
): string | null {
    const year = publishedDate
        ? new Date(publishedDate).getFullYear().toString()
        : null;

    if (!author && !year) return null;
    if (!author && year) return `— ${publicationDisplayName}, ${year}`;
    if (author && !year) return `— ${author}`;
    return `— ${author}, ${year}`;
}

// ── Accessibility label ───────────────────────────────────────────────────────

function buildAccessibilityLabel(
    row: ProfessionalCritic,
    displayName: string,
): string {
    const parts: string[] = [];

    if (row.kind === 'stars') {
        parts.push(`${displayName} ${row.score ?? ''}`);
    } else if (row.kind === 'score') {
        const denom = row.score_out_of ? `/${row.score_out_of}` : '';
        parts.push(`${displayName} ${row.score ?? ''}${denom}`);
    } else if (row.kind === 'essential') {
        const year = row.published_date
            ? new Date(row.published_date).getFullYear().toString()
            : '';
        parts.push(`${displayName} Essential${year ? ` ${year}` : ''}`);
    } else {
        parts.push(`${displayName} feature`);
    }

    if (row.excerpt) parts.push(row.excerpt);

    const year = row.published_date
        ? new Date(row.published_date).getFullYear().toString()
        : null;
    if (row.author && year) parts.push(`by ${row.author}, ${year}`);
    else if (row.author) parts.push(`by ${row.author}`);
    else if (year) parts.push(year);

    parts.push('Opens review.');
    return parts.join('. ');
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
    critic: ProfessionalCritic;
}

export function CriticRow({ critic }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const displayName = getPublicationDisplayName(critic.publication);
    const kindLabel = KIND_LABEL[critic.kind] ?? critic.kind.toUpperCase();
    const attribution = buildAttribution(critic.author, critic.published_date, displayName);
    const accessibilityLabel = buildAccessibilityLabel(critic, displayName);

    const isInteractive =
        typeof critic.source_url === 'string' &&
        critic.source_url.startsWith('https://');

    const handlePress = () => {
        if (isInteractive && critic.source_url) {
            WebBrowser.openBrowserAsync(critic.source_url);
        }
    };

    return (
        <Pressable
            onPress={isInteractive ? handlePress : undefined}
            accessibilityRole={isInteractive ? 'link' : 'text'}
            accessibilityLabel={accessibilityLabel}
            style={({ pressed }) => [
                styles.row,
                { borderTopColor: palette.ruleInkSoft },
                isInteractive && pressed && styles.rowPressed,
            ]}
        >
            {/* Main row: left metadata + right value */}
            <View style={styles.mainRow}>
                {/* Left column */}
                <View style={styles.leftCol}>
                    <Text style={[styles.pubName, { color: palette.text }]} numberOfLines={1}>
                        {displayName}
                    </Text>
                    <Text style={[styles.kindLabel, { color: palette.textMuted }]}>
                        {kindLabel}
                    </Text>
                </View>

                {/* Right value column */}
                <View style={styles.rightCol}>
                    {renderValue(critic.kind, critic, palette)}
                </View>
            </View>

            {/* Excerpt (omitted when null or empty) */}
            {critic.excerpt ? (
                <Text
                    style={[styles.excerpt, { color: palette.textSecondary }]}
                    numberOfLines={3}
                >
                    {critic.excerpt}
                </Text>
            ) : null}

            {/* Attribution caption */}
            {attribution ? (
                <Text style={[styles.attribution, { color: palette.textMuted }]}>
                    {attribution}
                </Text>
            ) : null}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    row: {
        paddingVertical: Spacing.md,
        borderTopWidth: 1,
    },
    rowPressed: {
        opacity: 0.7,
    },
    mainRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    leftCol: {
        flex: 1,
        paddingRight: Spacing.sm,
    },
    rightCol: {
        alignItems: 'flex-end',
        justifyContent: 'flex-start',
        flexShrink: 0,
    },
    pubName: {
        fontFamily: 'Newsreader_600SemiBold',
        fontSize: 14,
        lineHeight: 20,
    },
    kindLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        marginTop: 2,
    },
    valueStars: {
        fontFamily: 'Newsreader_600SemiBold',
        fontSize: 15,
        lineHeight: 20,
    },
    scoreRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 1,
    },
    valueScore: {
        fontFamily: 'Newsreader_600SemiBold',
        fontSize: 15,
        lineHeight: 20,
    },
    valueDenom: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 10,
    },
    essentialBadge: {
        borderRadius: Radius.sm,
        paddingHorizontal: Spacing.sm,
        paddingVertical: 3,
        alignItems: 'center',
    },
    essentialText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
    },
    essentialYear: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1,
        marginTop: 1,
    },
    valueDash: {
        fontFamily: 'Newsreader_600SemiBold',
        fontSize: 15,
        lineHeight: 20,
    },
    excerpt: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
        lineHeight: 19,
        marginTop: Spacing.sm,
    },
    attribution: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 10,
        marginTop: Spacing.xs,
    },
});
