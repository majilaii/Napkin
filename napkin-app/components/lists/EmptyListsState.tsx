/**
 * EmptyListsState — shown when the user has no lists yet.
 * Prominent "Create list" CTA.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Palette = typeof Colors.light;

interface Props {
    onCreatePress: () => void;
}

export function EmptyListsState({ onCreatePress }: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;

    return (
        <View style={styles.container}>
            <Ionicons name="list-outline" size={52} color={palette.outlineVariant} />
            <Text
                style={[
                    Type.headlineMedium,
                    {
                        color: palette.text,
                        marginTop: Spacing.lg,
                        textAlign: 'center',
                    },
                ]}
            >
                No lists yet
            </Text>
            <Text
                style={[
                    Type.body,
                    {
                        color: palette.textMuted,
                        marginTop: Spacing.sm,
                        textAlign: 'center',
                    },
                ]}
            >
                Curate your favourites &mdash; &ldquo;Best brunch SF&rdquo;,{'\n'}&ldquo;My Taipei&rdquo;, &ldquo;Top noodle spots&rdquo;.
            </Text>

            <Pressable
                onPress={onCreatePress}
                style={({ pressed }) => [
                    styles.cta,
                    {
                        backgroundColor: palette.primary,
                        opacity: pressed ? 0.8 : 1,
                    },
                ]}
            >
                <Ionicons name="add" size={20} color="#fff" />
                <Text style={[Type.titleMedium, { color: '#fff', marginLeft: Spacing.xs }]}>
                    Create list
                </Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: Spacing.xl,
        paddingVertical: Spacing.xxl,
    },
    cta: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: Spacing.xl,
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.xl,
        borderRadius: Radius.md,
    },
});
