import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    TASTE_EMBLEM_MEAL_FLOOR,
    type TasteEmblem as TasteEmblemDefinition,
    type TasteEmblemKey,
} from '@/lib/tasteEmblem';

type Props = {
    emblem: TasteEmblemDefinition;
    totalMeals: number;
    totalPlaces: number;
    cityCount: number;
    countryCount: number;
    isSelf?: boolean;
};

type PendingProps = {
    totalMeals: number;
    cityCount: number;
    countryCount: number;
    isSelf?: boolean;
};

const ICONS: Record<TasteEmblemKey, React.ComponentProps<typeof Ionicons>['name']> = {
    compass: 'compass-outline',
    atlas: 'map-outline',
    lantern: 'bulb-outline',
    hearth: 'flame-outline',
};

function countLabel(value: number, singular: string, plural = `${singular}s`) {
    return `${value} ${value === 1 ? singular : plural}`;
}

export function TasteEmblem({
    emblem,
    totalMeals,
    totalPlaces,
    cityCount,
    countryCount,
    isSelf = true,
}: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const accents: Record<TasteEmblemKey, string> = {
        compass: palette.primary,
        atlas: palette.tertiary,
        lantern: palette.secondary,
        hearth: palette.sanguine,
    };
    const accent = accents[emblem.key];
    const mark = emblem.title.replace(/^The\s+/, '').toUpperCase();
    const evidence = [
        countLabel(totalMeals, 'meal'),
        countLabel(totalPlaces, 'place'),
        cityCount > 0 ? countLabel(cityCount, 'city', 'cities') : null,
        countryCount > 0 ? countLabel(countryCount, 'country', 'countries') : null,
    ].filter(Boolean).join(' · ');
    const accessibilityLabel = [
        isSelf ? 'Your taste emblem' : 'Taste emblem',
        emblem.title,
        emblem.facets.join(' and '),
        emblem.description.replace(/[.!?]+$/, ''),
        `Formed from ${evidence.replaceAll(' · ', ', ')}`,
    ].join('. ');

    return (
        <View style={styles.hero} accessible accessibilityLabel={accessibilityLabel}>
            <View
                style={[styles.seal, Shadow.ambient, { backgroundColor: accent }]}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
            >
                <View style={[styles.sealInner, { borderColor: `${palette.textInverse}99` }]}>
                    <View style={styles.dotRow}>
                        <View style={[styles.dot, { backgroundColor: palette.textInverse }]} />
                        <View style={[styles.dot, { backgroundColor: palette.textInverse }]} />
                        <View style={[styles.dot, { backgroundColor: palette.textInverse }]} />
                    </View>
                    <View style={[styles.iconRing, { borderColor: `${palette.textInverse}99` }]}>
                        <Ionicons name={ICONS[emblem.key]} size={43} color={palette.textInverse} />
                    </View>
                    <Text
                        style={[Type.labelSmall, styles.sealLabel, { color: palette.textInverse }]}
                        allowFontScaling={false}
                        numberOfLines={1}
                    >
                        {mark}
                    </Text>
                </View>
            </View>

            <Text style={[Type.sectionKicker, styles.kicker, { color: palette.textMuted }]}>
                {isSelf ? 'Your taste emblem' : 'Taste emblem'}
            </Text>
            <Text style={[Type.displayMedium, styles.title, { color: palette.text }]}>{emblem.title}</Text>
            <Text style={[Type.labelSmall, styles.facets, { color: accent }]}>
                {emblem.facets.join(' · ')}
            </Text>
            <Text style={[Type.editorialBody, styles.description, { color: palette.textSecondary }]}>
                {emblem.description}
            </Text>
            <Text style={[Type.metadata, styles.evidence, { color: palette.textMuted }]}>
                {`formed from ${evidence}`}
            </Text>
        </View>
    );
}

function pendingExplanation(
    totalMeals: number,
    cityCount: number,
    countryCount: number,
    isSelf: boolean,
): string {
    if (!isSelf) return 'More public journal activity will reveal it.';

    const remainingMeals = Math.max(0, TASTE_EMBLEM_MEAL_FLOOR - totalMeals);
    const needsGeography = cityCount === 0 && countryCount === 0;
    const mealCopy = `${remainingMeals} more ${remainingMeals === 1 ? 'meal' : 'meals'}`;

    if (remainingMeals > 0 && needsGeography) {
        return `Log ${mealCopy}, including one with a known location, to reveal it.`;
    }
    if (remainingMeals > 0) return `Log ${mealCopy} to reveal it.`;
    return 'Log a place with a known location to reveal it.';
}

export function TasteEmblemPending({
    totalMeals,
    cityCount,
    countryCount,
    isSelf = true,
}: PendingProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const kicker = isSelf ? 'Your taste emblem' : 'Taste emblem';
    const explanation = pendingExplanation(totalMeals, cityCount, countryCount, isSelf);

    return (
        <View
            style={[styles.pendingCard, { backgroundColor: palette.surfaceJournalLow }]}
            accessible
            accessibilityLabel={`${kicker}. Taking shape. ${explanation}`}
        >
            <View
                style={[styles.pendingMark, { backgroundColor: palette.surfaceJournalHi }]}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
            >
                <Ionicons name="sparkles-outline" size={22} color={palette.secondary} />
            </View>
            <Text style={[Type.sectionKicker, { color: palette.textMuted }]}>{kicker}</Text>
            <Text style={[Type.headlineMedium, styles.pendingTitle, { color: palette.text }]}>Taking shape</Text>
            <Text style={[Type.metadata, styles.pendingCopy, { color: palette.textMuted }]}>
                {explanation}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    hero: {
        alignItems: 'center',
        paddingTop: Spacing.sm,
        paddingBottom: Spacing.lg,
        paddingHorizontal: Spacing.md,
    },
    seal: {
        width: 108,
        height: 128,
        padding: 8,
        borderTopLeftRadius: 54,
        borderTopRightRadius: 54,
        borderBottomLeftRadius: 34,
        borderBottomRightRadius: 34,
    },
    sealInner: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: StyleSheet.hairlineWidth,
        borderTopLeftRadius: 46,
        borderTopRightRadius: 46,
        borderBottomLeftRadius: 26,
        borderBottomRightRadius: 26,
    },
    dotRow: {
        position: 'absolute',
        top: 9,
        flexDirection: 'row',
        gap: 7,
        opacity: 0.72,
    },
    dot: {
        width: 3,
        height: 3,
        borderRadius: 2,
    },
    iconRing: {
        width: 64,
        height: 64,
        marginTop: -4,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 32,
    },
    sealLabel: {
        position: 'absolute',
        right: 4,
        bottom: 9,
        left: 4,
        textAlign: 'center',
    },
    kicker: {
        marginTop: 20,
        textAlign: 'center',
    },
    title: {
        marginTop: 5,
        textAlign: 'center',
    },
    facets: {
        marginTop: 7,
        textAlign: 'center',
    },
    description: {
        maxWidth: 300,
        marginTop: 12,
        textAlign: 'center',
    },
    evidence: {
        marginTop: 7,
        textAlign: 'center',
    },
    pendingCard: {
        alignItems: 'center',
        marginHorizontal: Spacing.lg,
        marginTop: Spacing.sm,
        marginBottom: Spacing.lg,
        paddingHorizontal: Spacing.lg,
        paddingVertical: 20,
        borderRadius: Radius.lg,
    },
    pendingMark: {
        width: 48,
        height: 48,
        marginBottom: 14,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: Radius.xl,
    },
    pendingTitle: {
        marginTop: Spacing.xs,
        textAlign: 'center',
    },
    pendingCopy: {
        maxWidth: 280,
        marginTop: Spacing.xs,
        textAlign: 'center',
    },
});
