/**
 * ErrorBoundary — catches render errors in a screen subtree so a single bad row
 * of data can't hard-crash the whole app ("kicked out"). Shows a warm Heirloom
 * fallback instead.
 *
 * Friend-test affordance: the fallback shows the error message + component stack
 * so a tester can screenshot the actual error — turning a silent crash into a
 * diagnosable one. (Tighten/remove the visible detail before public release.)
 */
import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { router } from 'expo-router';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface Props {
    children: React.ReactNode;
    /** Screen name for the logged context. */
    screen?: string;
}

interface State {
    error: Error | null;
    info: string | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
    state: State = { error: null, info: null };

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        // Surfaced to Metro / device logs for diagnosis.
        console.error(`[ErrorBoundary:${this.props.screen ?? 'screen'}]`, error, info.componentStack);
        this.setState({ info: info.componentStack ?? null });
    }

    render() {
        if (this.state.error) {
            return (
                <ErrorFallback
                    error={this.state.error}
                    info={this.state.info}
                    onBack={() => {
                        this.setState({ error: null, info: null });
                        if (router.canGoBack()) router.back();
                    }}
                />
            );
        }
        return this.props.children;
    }
}

function ErrorFallback({
    error,
    info,
    onBack,
}: {
    error: Error;
    info: string | null;
    onBack: () => void;
}) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View style={[styles.root, { backgroundColor: palette.background }]}>
            <Text style={[Type.headlineItalic, { color: palette.text, textAlign: 'center' }]}>
                couldn’t open this
            </Text>
            <Text style={[Type.bodySmall, { color: palette.textMuted, textAlign: 'center', marginTop: Spacing.sm }]}>
                something went wrong rendering this screen. your data is safe.
            </Text>

            <Pressable
                onPress={onBack}
                style={({ pressed }) => [
                    styles.btn,
                    { backgroundColor: palette.primary, opacity: pressed ? 0.85 : 1 },
                ]}
            >
                <Text style={[Type.titleSmall, { color: '#fffdf8' }]}>go back</Text>
            </Pressable>

            {/* Friend-test diagnostic — screenshot this if it recurs. */}
            <ScrollView style={styles.detail} contentContainerStyle={{ padding: Spacing.md }}>
                <Text style={[Type.caption, { color: palette.textMuted }]}>
                    {String(error?.message ?? error)}
                    {info ? `\n${info.split('\n').slice(0, 6).join('\n')}` : ''}
                </Text>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: Spacing.xl,
    },
    btn: {
        marginTop: Spacing.lg,
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.xl,
        borderRadius: 14,
    },
    detail: {
        maxHeight: 160,
        marginTop: Spacing.xl,
        alignSelf: 'stretch',
    },
});
