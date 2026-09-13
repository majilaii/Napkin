/** Three setup steps; people suggestions are a conditional optional extra. */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';

export const ONBOARDING_STEP_COUNT = 3;

interface Props {
    step: number;
    palette: typeof Colors.light;
    optional?: boolean;
}

export function OnboardingProgress({ step, palette, optional = false }: Props) {
    const current = Math.min(Math.max(step, 1), ONBOARDING_STEP_COUNT);
    return (
        <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={optional ? 'Optional people suggestions' : 'Profile setup'}
            accessibilityValue={{ min: 1, max: ONBOARDING_STEP_COUNT, now: current }}
        >
            <View style={styles.labels}>
                <Text style={[styles.label, { color: palette.textSecondary }]}>
                    {optional ? 'People you know' : 'Make yourself at home'}
                </Text>
                <Text style={[styles.count, { color: palette.textMuted }]}>
                    {optional ? 'Optional' : `${current} of ${ONBOARDING_STEP_COUNT}`}
                </Text>
            </View>
            <View style={styles.rail}>
                {Array.from({ length: ONBOARDING_STEP_COUNT }, (_, i) => (
                    <View
                        key={i}
                        style={[
                            styles.segment,
                            { backgroundColor: i < current ? palette.primary : palette.ruleInkSoft },
                        ]}
                    />
                ))}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    labels: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: Spacing.sm,
        marginBottom: Spacing.md,
    },
    label: { ...Type.metadata, flexShrink: 1 },
    count: { ...Type.metadata, fontVariant: ['tabular-nums'] },
    rail: { flexDirection: 'row', gap: Spacing.sm },
    segment: { flex: 1, height: Spacing.xs / 2, borderRadius: Radius.full },
});

export default OnboardingProgress;
