import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native';
import React from 'react';

import { Colors, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Four-tab nav matching the Stitch wireframe bottom bar.
 * Journal | Tables | Friends | Settings.
 *
 * No hard top border (design system rule). Tab bar sits on the warm paper
 * background with a subtle surface-container-low fill.
 */
export default function TabsLayout() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <Tabs
            screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: palette.tabIconSelected,
                tabBarInactiveTintColor: palette.tabIconDefault,
                tabBarStyle: [
                    styles.tabBar,
                    { backgroundColor: palette.surfaceContainerLow },
                ],
                tabBarLabelStyle: [Type.labelSmall, { marginTop: 2 }],
            }}
        >
            <Tabs.Screen
                name="journal"
                options={{
                    title: 'Journal',
                    tabBarIcon: ({ color, size }) => (
                        <Ionicons name="book-outline" size={size} color={color} />
                    ),
                }}
            />
            <Tabs.Screen
                name="tables"
                options={{
                    title: 'Tables',
                    tabBarIcon: ({ color, size }) => (
                        <Ionicons name="restaurant-outline" size={size} color={color} />
                    ),
                }}
            />
            <Tabs.Screen
                name="friends"
                options={{
                    title: 'Friends',
                    tabBarIcon: ({ color, size }) => (
                        <Ionicons name="people-outline" size={size} color={color} />
                    ),
                }}
            />
            <Tabs.Screen
                name="settings"
                options={{
                    title: 'Settings',
                    tabBarIcon: ({ color, size }) => (
                        <Ionicons name="settings-outline" size={size} color={color} />
                    ),
                }}
            />
        </Tabs>
    );
}

const styles = StyleSheet.create({
    tabBar: {
        borderTopWidth: 0, // no hard line per design system
        elevation: 0,
        height: 72,
        paddingTop: 8,
        paddingBottom: 12,
    },
});
