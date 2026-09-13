import React, { type ReactNode } from 'react';
import {
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing, Type } from '@/constants/theme';
import { OnboardingProgress } from './OnboardingProgress';
import { onboardingStyles as s } from '@/app/onboarding/styles';

type Props = {
    palette: typeof Colors.light;
    step: number;
    optional?: boolean;
    onBack?: () => void;
    backDisabled?: boolean;
    footer: ReactNode;
    children: ReactNode;
};

export function SetupFrame({ palette, step, optional, onBack, backDisabled, footer, children }: Props) {
    const insets = useSafeAreaInsets();
    return (
        <KeyboardAvoidingView
            style={[s.root, { backgroundColor: palette.background }]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
                <View style={styles.topBar}>
                    {onBack ? (
                        <Pressable
                            onPress={onBack}
                            disabled={backDisabled}
                            accessibilityRole="button"
                            accessibilityLabel="Back"
                            accessibilityState={{ disabled: !!backDisabled }}
                            style={({ pressed }) => [styles.back, { opacity: backDisabled ? 0.5 : pressed ? 0.7 : 1 }]}
                        >
                            <Ionicons name="arrow-back-outline" size={Spacing.lg} color={palette.text} />
                        </Pressable>
                    ) : <View style={styles.back} />}
                    <Text style={[styles.wordmark, { color: palette.text }]}>Napkin</Text>
                    <View style={styles.back} />
                </View>
                <OnboardingProgress step={step} palette={palette} optional={optional} />
            </View>
            <ScrollView
                style={s.root}
                contentContainerStyle={s.body}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                showsVerticalScrollIndicator={false}
                automaticallyAdjustKeyboardInsets={false}
            >
                {children}
            </ScrollView>
            <View style={[s.footer, { backgroundColor: palette.background, paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
                {footer}
            </View>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    header: { paddingHorizontal: Spacing.lg },
    topBar: {
        minHeight: Spacing.xxl,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: Spacing.lg,
    },
    back: {
        width: Spacing.hitTarget,
        minHeight: Spacing.hitTarget,
        alignItems: 'center',
        justifyContent: 'center',
    },
    wordmark: { ...Type.headlineLarge },
});
