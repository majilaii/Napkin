/**
 * OnboardingProgress — a four-segment rule above each step's kicker.
 *
 * Onboarding is four screens (name → photo → city → people) and, before this,
 * gave no sense of how many were left; each screen read as an open-ended form.
 * A quiet rail turns it into a short, visibly finite arc, which matters more now
 * that the photo step can no longer be skipped — a wall you can see the end of
 * reads as a step, and one you can't reads as a trap.
 *
 * Heirloom grammar: a ghosted warm rule, not a progress BAR and not dots. No
 * numerals, no "step 3 of 4" label — the shape carries it, and copy economy says
 * don't narrate what structure already shows. Screen readers get the count via
 * `accessibilityValue` since the rule itself is decorative.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';

import { Colors, Radius } from '@/constants/theme';

export const ONBOARDING_STEP_COUNT = 4;

interface Props {
    /** 1-based step index. */
    step: number;
    palette: typeof Colors.light;
}

export function OnboardingProgress({ step, palette }: Props) {
    return (
        <View
            style={styles.rail}
            accessibilityRole="progressbar"
            accessibilityLabel="Setup progress"
            accessibilityValue={{ min: 1, max: ONBOARDING_STEP_COUNT, now: step }}
        >
            {Array.from({ length: ONBOARDING_STEP_COUNT }, (_, i) => (
                <View
                    key={i}
                    style={[
                        styles.segment,
                        {
                            backgroundColor:
                                i < step ? palette.primary : palette.ruleInkSoft,
                            // The reached segments carry full weight; the rest
                            // stay a ghosted rule rather than an empty track.
                            opacity: i < step ? 1 : 0.6,
                        },
                    ]}
                />
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    rail: {
        flexDirection: 'row',
        gap: 5,
        marginBottom: 20,
    },
    segment: {
        flex: 1,
        height: 2,
        borderRadius: Radius.full,
    },
});

export default OnboardingProgress;
