/**
 * /wishlist — full-screen personal wishlist grid.
 * Reached from Settings → "My Wishlist".
 */
import React from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { WishlistGrid } from '@/components/wishlist';

export default function WishlistScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View style={{ flex: 1, backgroundColor: palette.background }}>
            <Stack.Screen
                options={{
                    title: 'My Wishlist',
                    headerStyle: { backgroundColor: palette.background },
                    headerTintColor: palette.text,
                    headerTitleStyle: {
                        fontFamily: 'Newsreader_400Regular_Italic',
                        fontSize: 20,
                        color: palette.text,
                    },
                }}
            />
            <WishlistGrid mode="personal" />
        </View>
    );
}
