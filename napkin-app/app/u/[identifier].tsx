/**
 * /u/[identifier] — public/stranger profile screen.
 * TICKET-025: Replaced hand-rolled scroll with ProfileScreenBody.
 *
 * Identifier is either a uuid (in-app taps) or a username (external links).
 * Relationship gating is handled entirely by ProfileScreenBody.
 */
import React from 'react';
import {
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ProfileScreenBody } from '@/components/profile';

export default function ProfileScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();

    const { identifier } = useLocalSearchParams<{ identifier: string }>();

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <View style={[styles.container, { backgroundColor: palette.background }]}>
                {/* Back nav */}
                <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
                    <Pressable onPress={() => router.back()} hitSlop={12}>
                        <Text style={[Type.body, { color: palette.primary }]}>{'← Back'}</Text>
                    </Pressable>
                    <View style={{ width: 40 }} />
                </View>

                <ProfileScreenBody identifier={identifier} />
            </View>
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    topBar: {
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
});
