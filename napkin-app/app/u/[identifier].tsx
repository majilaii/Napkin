/**
 * /u/[identifier] — merged public profile screen.
 * Thin wrapper around ProfileScreenBody with a back-nav top bar.
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

export default function PublicProfileScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();

    const { identifier } = useLocalSearchParams<{ identifier: string }>();

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <View
                style={[
                    styles.container,
                    { backgroundColor: palette.background, paddingTop: insets.top },
                ]}
            >
                <View style={styles.topBar}>
                    <Pressable onPress={() => router.back()} hitSlop={12}>
                        <Text style={[Type.body, { color: palette.primary }]}>
                            {'\u2039 Back'}
                        </Text>
                    </Pressable>
                    <View style={{ width: 40 }} />
                </View>

                <ProfileScreenBody identifier={identifier} />
            </View>
        </>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    topBar: {
        paddingHorizontal: 22,
        paddingVertical: Spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
});
