/**
 * /wishlist — personal wishlist, grouped by city (Heirloom Journal wireframe).
 * Reached from Settings → "My Wishlist".
 */
import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { WishlistByCity, ImportLinkSheet } from '@/components/wishlist';

export default function WishlistScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const { user } = useAuth();
    const insets = useSafeAreaInsets();

    // Entry point A (AC#3): "add from link" text button in wishlist header
    const [importSheetVisible, setImportSheetVisible] = useState(false);

    return (
        <View style={{ flex: 1, backgroundColor: palette.background }}>
            <Stack.Screen options={{ headerShown: false }} />
            <View
                style={[
                    styles.header,
                    {
                        backgroundColor: palette.background,
                        paddingTop: insets.top + Spacing.sm,
                    },
                ]}
            >
                <Pressable
                    onPress={() => router.back()}
                    hitSlop={12}
                    style={styles.headerSide}
                >
                    <Ionicons name="chevron-back" size={22} color={palette.textMuted} />
                </Pressable>
                <Text
                    style={[
                        Type.headlineItalic,
                        { color: palette.text, fontSize: 18 },
                    ]}
                >
                    Wishlist
                </Text>
                {/* Replaces the old + icon (OQ (a) resolved: single text button) */}
                <Pressable
                    onPress={() => setImportSheetVisible(true)}
                    hitSlop={12}
                    style={[styles.headerSide, { alignItems: 'flex-end' }]}
                    accessibilityLabel="add from link"
                >
                    <Text style={[Type.body, { color: palette.textMuted }]}>add from link</Text>
                </Pressable>
            </View>

            {user ? <WishlistByCity userId={user.id} /> : null}

            <ImportLinkSheet
                visible={importSheetVisible}
                onDismiss={() => setImportSheetVisible(false)}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    header: {
        paddingBottom: Spacing.md,
        paddingHorizontal: 22,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    headerSide: {
        width: 80,
    },
});
